// Split-view diff parsing.
//
// Lives here rather than beside the component because it is the part that can
// be silently wrong: a side-by-side view whose two panes have drifted out of
// step still renders perfectly and still says the wrong thing about what
// changed. Pure input → output, so it gets a test (lib/__tests__).

/** One row of one pane. `null` is padding — the other side has a line here
 *  and this one does not. */
export type DiffRow = string | null;

export type SplitHunk = {
  file: string;
  before: DiffRow[];
  after: DiffRow[];
};

/**
 * Parse a unified diff into per-hunk before/after panes of equal height.
 *
 * The alignment is the whole point. Deletions and additions accumulate on
 * their own sides, and the two sides are padded back to the same length at
 * every point where they are known to be describing the same line again — a
 * context line, a hunk header, a new file, or end of input. Without that, a
 * hunk removing 2 lines and adding 5 pushes everything below it three rows
 * out of step, and each pane's row N stops corresponding to the other's.
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

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("+++ ")) {
      flush();
      file = line.slice(4).replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("@@")) {
      flush();
      continue;
    }
    if (line.startsWith("-")) {
      before.push(line.slice(1));
    } else if (line.startsWith("+")) {
      after.push(line.slice(1));
    } else {
      // Context: both sides have this line, so they are back in sync here.
      realign();
      const ctx = line.startsWith(" ") ? line.slice(1) : line;
      before.push(ctx);
      after.push(ctx);
    }
  }
  flush();

  return hunks;
}
