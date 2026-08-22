// Unified-diff parsing, for both the side-by-side and the inline renderers.
//
// Lives here rather than beside the components because it is the part that can
// be silently wrong: a diff view whose panes have drifted out of step, or that
// has quietly dropped a line, still renders perfectly and still says the wrong
// thing about what changed. Pure input → output, so it gets tests
// (lib/__tests__).

/** What a single line of a unified diff is. */
export type UnifiedKind = "meta" | "hunk" | "add" | "del" | "context";

/** One line of a diff, with its raw text — markers included, since the inline
 *  view shows them. */
export type UnifiedRow = { text: string; kind: UnifiedKind };

/** One row of one pane of a split view. `null` is padding — the other side has
 *  a line here and this one does not. */
export type DiffRow = string | null;

export type SplitHunk = {
  file: string;
  before: DiffRow[];
  after: DiffRow[];
};

/**
 * Classify every line of a unified diff.
 *
 * The state is the point. `---` and `+++` mean "file header" only in a file's
 * header block, before its first `@@`. Inside a hunk they are ordinary source
 * with a diff marker glued on: deleting the SQL comment `-- note` emits
 * `--- note`, and adding the C++ statement `++i;` emits `+++i;`. Classifying
 * those by prefix alone — the obvious `line.startsWith("+") &&
 * !line.startsWith("+++")` — greys them out as headers, so a real deletion
 * silently reads as diff furniture.
 */
export function parseUnifiedRows(body: string): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  const lines = body.split(/\r?\n/);
  let inHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      inHunk = false;
      rows.push({ text: line, kind: "meta" });
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      rows.push({ text: line, kind: "hunk" });
      continue;
    }
    // `---`, `+++`, `@@` in that order is a file header wherever it appears:
    // that run is how a concatenated multi-file diff with no `diff --git`
    // lines marks its section breaks. All three are required — two of them
    // cannot be told apart from a deletion of `-- x` followed by an addition
    // of `++ y`, and a header triple always leads into a hunk, since git emits
    // no `---`/`+++` at all for a file with no hunks.
    if (
      line.startsWith("--- ") &&
      lines[i + 1]?.startsWith("+++ ") &&
      lines[i + 2]?.startsWith("@@")
    ) {
      rows.push({ text: line, kind: "meta" });
      rows.push({ text: lines[i + 1], kind: "meta" });
      i++;
      continue;
    }
    if (!inHunk) {
      // Header block: index, mode, similarity, and the `---`/`+++` pair.
      rows.push({ text: line, kind: "meta" });
      continue;
    }
    // "\ No newline at end of file" annotates the diff; it is not a line of
    // either version of the file.
    if (line.startsWith("\\")) {
      rows.push({ text: line, kind: "meta" });
      continue;
    }
    if (line.startsWith("-")) rows.push({ text: line, kind: "del" });
    else if (line.startsWith("+")) rows.push({ text: line, kind: "add" });
    else rows.push({ text: line, kind: "context" });
  }

  return rows;
}

/**
 * Group a unified diff into per-hunk before/after panes of equal height.
 *
 * The alignment is the whole point. Deletions and additions accumulate on
 * their own sides, and the two are padded back to the same length at every
 * point where they are known to be describing the same line again — a context
 * line, a hunk header, a new file, or end of input. Without that, a hunk
 * removing 2 lines and adding 5 pushes everything below it three rows out of
 * step, and each pane's row N stops corresponding to the other's.
 */
export function parseSplitHunks(body: string): SplitHunk[] {
  const hunks: SplitHunk[] = [];
  let file = "";
  let before: DiffRow[] = [];
  let after: DiffRow[] = [];

  const realign = () => {
    while (before.length < after.length) before.push(null);
    while (after.length < before.length) after.push(null);
  };

  const flush = () => {
    realign();
    if (file && (before.length || after.length)) {
      hunks.push({ file, before, after });
    }
    before = [];
    after = [];
  };

  for (const row of parseUnifiedRows(body)) {
    switch (row.kind) {
      case "meta":
        // Only two metadata lines name a file, and neither reaches a pane.
        if (row.text.startsWith("+++ ")) {
          flush();
          file = row.text.slice(4).replace(/^b\//, "");
        } else if (row.text.startsWith("diff --git ")) {
          flush();
          // Fallback name, for a file section with no `+++` line of its own.
          file = / b\/(.+)$/.exec(row.text)?.[1] ?? "";
        }
        break;
      case "hunk":
        flush();
        break;
      case "del":
        before.push(row.text.slice(1));
        break;
      case "add":
        after.push(row.text.slice(1));
        break;
      case "context": {
        // Both sides have this line, so they are back in sync here.
        realign();
        const ctx = row.text.startsWith(" ") ? row.text.slice(1) : row.text;
        before.push(ctx);
        after.push(ctx);
        break;
      }
    }
  }
  flush();

  return hunks;
}
