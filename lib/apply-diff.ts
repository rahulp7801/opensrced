// One diff-apply ladder, shared by every caller.
//
// LLM-generated diffs fail in predictable ways, so applying them is a
// sequence of increasingly forgiving strategies rather than a single
// `git apply`. This used to exist twice — lib/agentic-pr.ts had five tiers
// with `--index --recount`, app/api/prs/push had four different tiers plus
// `patch -p0` plus a hand-rolled direct-edit fallback. Two ladders meant a
// diff that shipped through one path could fail through the other, and a
// fix to either only helped half the callers.
//
// This is the union: everything both had, in escalating order of fuzz.
//
//   1. git apply (strict)                      clean, accurate diffs
//   2. + --ignore-whitespace                   spacing/tabs paraphrased
//   3. + --3way (after optional deepen)        context drifted since clone
//   4. + --3way --ignore-whitespace            both at once
//   5. GNU patch -p1 --fuzz=3                  wrong hunk header line numbers
//   6. GNU patch -p0 --fuzz=3                  paths without a/ b/ prefixes
//   7. direct edit                             not a real unified diff at all
//
// Tier 3 needs history a shallow clone doesn't have. Callers that can
// deepen pass `deepen`; it runs at most once, and if it fails the 3-way
// tiers are skipped rather than failing the whole apply.

import { execFile } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { childEnv } from "./child-env";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Resolve `rel` inside `dir`, or null if it escapes.
 *
 *  Every path here comes out of a model-generated diff — a `+++ b/…` header
 *  or a filename mentioned in prose. `git apply` refuses paths containing
 *  `..` on its own, but the direct-edit fallback below does its own file I/O
 *  and had no such check: a diff claiming to patch `../../../.env` would be
 *  joined onto the worktree and written, outside the throwaway checkout the
 *  whole design assumes as its blast radius. */
function containedPath(dir: string, rel: string): string | null {
  if (!rel || /[\0:"]/.test(rel)) return null;
  const parts = rel.replaceAll("\\", "/").split("/");
  if (parts.some(part => /^\.git[ .]*$/i.test(part))) return null;
  const root = resolve(dir);
  const abs = resolve(root, rel);
  if (abs === root || !abs.startsWith(root + sep)) return null;
  // A lexically contained path can still escape through a repository symlink.
  let current = root;
  for (const part of abs.slice(root.length + 1).split(sep)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) return null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null; }
  }
  return abs;
}

export type ApplyResult =
  | { ok: true; tier: string; files: string[] }
  | { ok: false; errors: string[] };

export type ApplyOpts = {
  env?: NodeJS.ProcessEnv;
  /** Fetch more history so `git apply --3way` can resolve blob parents.
   *  Return false (or throw) to skip the 3-way tiers. Runs at most once. */
  deepen?: () => Promise<boolean>;
};

/** Rewrite every hunk header's line counts from the hunk body. Models
 *  miscount them, and in a multi-file diff without `diff --git` separators a
 *  wrong count (or `git apply --recount`) reads the next file's `---` header
 *  as a removed line, so the whole patch fails and only the direct-edit
 *  fallback is left. A hunk ends at the next `@@`, `diff --git`, or
 *  `---`/`+++` header pair; blank lines inside it are empty context lines. */
/** A `---`/`+++` file-header pair at line i. It must be followed by a hunk, so a
 *  removed `-- x` line next to an added `++ y` line (SQL or Lua comments) is not
 *  mistaken for a new file. */
function headerPairAt(lines: string[], i: number): boolean {
  return lines[i].startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ") && (lines[i + 2] ?? "").startsWith("@@");
}

/** Line i starts something other than a hunk body line. */
function endsHunk(lines: string[], i: number): boolean {
  return lines[i].startsWith("@@") || lines[i].startsWith("diff --git ") || headerPairAt(lines, i);
}

/** The repo-relative name a `+++` line (or, for a deletion, its `---` line) names. */
function headerFile(minus: string, plus: string): string {
  const name = (line: string) => line.slice(4).split("\t")[0].trimEnd().replace(/^[ab]\//, "");
  return plus === "+++ /dev/null" || plus.startsWith("+++ /dev/null\t") ? name(minus) : name(plus);
}

function recountHunks(diff: string): string {
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[i]);
    if (!header) continue;
    let oldCount = 0, newCount = 0, blanks = 0;
    for (let j = i + 1; j < lines.length && !endsHunk(lines, j); j++) {
      const c = lines[j][0];
      // Blank lines count only once a later line shows they sit inside the hunk.
      if (c === undefined) { blanks++; continue; }
      if (c !== " " && c !== "-" && c !== "+" && c !== "\\") break;
      oldCount += blanks; newCount += blanks; blanks = 0;
      if (c === " " || c === "-") oldCount++;
      if (c === " " || c === "+") newCount++;
    }
    lines[i] = `@@ -${header[1]},${oldCount} +${header[2]},${newCount} @@${header[3]}`;
  }
  return lines.join("\n");
}

/** Repair what LLMs most often get wrong about diff framing: missing
 *  `a/` / `b/` path prefixes, miscounted hunk headers, and a missing trailing
 *  newline (which `git apply` rejects outright with "corrupt patch"). */
export function normalizeDiff(raw: string): string {
  // LF throughout; files that use CRLF get it back per file in matchLineEndings.
  let diff = recountHunks(raw.replace(/\r\n/g, "\n"));

  diff = diff.replace(
    /^--- ([^/\n][^\n]*)/gm,
    (_, path: string) => `--- a/${path.replace(/^a\//, "")}`,
  );
  diff = diff.replace(
    /^\+\+\+ ([^/\n][^\n]*)/gm,
    (_, path: string) => `+++ b/${path.replace(/^b\//, "")}`,
  );

  if (!diff.endsWith("\n")) diff += "\n";
  return diff;
}

/** Every file path the diff claims to touch: header names read to the end of
 *  the line (so names with spaces are checked whole, minus a tab-separated
 *  timestamp), plus both names on `diff --git` lines, which git and GNU patch
 *  also honour. */
export function diffTouchedFiles(diff: string): string[] {
  const headers = [...diff.matchAll(/^(?:\+\+\+|---) (?:[ab]\/)?([^\t\n]+)/gm)].map((m) => m[1].trimEnd());
  const gitNames = [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)\s*$/gm)].flatMap((m) => [m[1], m[2]]);
  return [...new Set([...headers, ...gitNames].filter((p) => p !== "/dev/null"))];
}

/** Renames and copies name a second path the header checks would miss; an
 *  issue fix never needs them, so they are refused outright. */
export function hasRenameOrCopy(diff: string): boolean {
  return /^(?:rename|copy) (?:from|to) /m.test(diff);
}

async function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  return execFileAsync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? childEnv(),
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    timeout: 30_000,
  });
}

/**
 * Apply `diff` inside the git working tree at `dir`.
 *
 * On success the touched files are staged, so the caller can commit
 * directly without a separate `git add`.
 */
/** A patch may only create or keep regular files. git reads modes with
 *  strtoul (accepting `+`, leading \v \f \r, and any 012xxxx value as a
 *  symlink, 0160000 as a submodule) from mode lines AND from the trailing
 *  field of `index a..b <mode>` lines, so an allowlist is the only safe check. */
export function hasUnsafeMode(diff: string): boolean {
  for (const m of diff.matchAll(/^(?:(?:new|deleted) file mode|(?:old|new) mode)(.*)$/gm)) {
    if (!/^ 100(?:644|755)[ \t]*$/.test(m[1])) return true;
  }
  for (const m of diff.matchAll(/^index [0-9a-f]+\.\.[0-9a-f]+(.*)$/gm)) {
    if (!/^(?: 100(?:644|755))?[ \t]*$/.test(m[1])) return true;
  }
  return false;
}

export async function applyDiff(
  dir: string,
  diff: string,
  patchPath: string,
  opts: ApplyOpts = {},
): Promise<ApplyResult> {
  const env = opts.env;
  const normalized = normalizeDiff(diff);
  const files = diffTouchedFiles(normalized);
  if (files.some(file => !containedPath(dir, file)) || hasUnsafeMode(normalized) || hasRenameOrCopy(normalized)) {
    return { ok: false, errors: ["Patch contains an unsafe path, Git metadata, or a symbolic link."] };
  }
  await writeFile(patchPath, await matchLineEndings(dir, normalized, files), { mode: 0o600 });
  const errors: string[] = [];

  // No --recount: normalizeDiff already recounted, and git's own recount
  // runs a hunk on into the next file when `diff --git` lines are missing.
  const base = ["-C", dir, "apply", "--index", "--whitespace=nowarn"];
  const gitTiers: Array<{ name: string; args: string[]; threeWay?: boolean }> = [
    { name: "git apply (strict)", args: [...base, patchPath] },
    { name: "git apply --ignore-whitespace", args: [...base, "--ignore-whitespace", patchPath] },
    { name: "git apply --3way", args: [...base, "--3way", patchPath], threeWay: true },
    {
      name: "git apply --3way --ignore-whitespace",
      args: [...base, "--3way", "--ignore-whitespace", patchPath],
      threeWay: true,
    },
  ];

  let deepened: boolean | null = null; // null = not attempted yet
  for (const tier of gitTiers) {
    if (tier.threeWay) {
      if (deepened === null && opts.deepen) {
        deepened = await opts.deepen().catch(() => false);
      } else if (deepened === null) {
        deepened = false;
      }
      // No history to 3-way against — these tiers cannot succeed.
      if (!deepened) continue;
    }
    try {
      await run("git", tier.args, { env });
      return { ok: true, tier: tier.name, files };
    } catch (e) {
      errors.push(`${tier.name}: ${msg(e)}`);
      // A failed 3-way apply leaves conflict markers and unmerged index entries.
      if (tier.threeWay) await restore(dir, files, env);
    }
  }

  // GNU patch slides hunks to find their match, which handles the very
  // common case of Claude writing the right change with a wrong @@ line
  // number. Only -p1: normalizeDiff gives every header an a/ or b/ prefix,
  // and -p0 would write a path other than the one checked above.
  for (const strip of ["-p1"]) {
    const patchArgs = [strip, "--batch", "--forward", "--fuzz=3", "--no-backup-if-mismatch", "-i", patchPath];
    try {
      // Dry run first: a real run writes every hunk that matches and leaves the
      // rest in .rej files, and later tiers would then edit a half-patched file.
      await run("patch", ["--dry-run", ...patchArgs], { cwd: dir, env });
    } catch (e) {
      errors.push(`patch ${strip}: ${msg(e)}`);
      continue;
    }
    try {
      await run("patch", patchArgs, {
        cwd: dir,
        env,
      });
      // GNU patch writes the working tree but not the index; stage so the
      // caller's commit picks the changes up.
      await stage(dir, files, env);
      return { ok: true, tier: `patch ${strip} --fuzz=3`, files };
    } catch (e) {
      errors.push(`patch ${strip}: ${msg(e)}`);
      await restore(dir, files, env);
    }
  }

  // Last resort: edit the file directly, hunk by hunk (see tryDirectEdit).
  // Single-file only; a multi-file diff that git and patch refuse is refused.
  if (files.length > 1) {
    errors.push("direct edit: skipped for a multi-file diff");
    return { ok: false, errors };
  }
  try {
    const edited = await tryDirectEdit(dir, normalized, files);
    if (edited) {
      await stage(dir, files, env);
      return { ok: true, tier: "direct edit", files };
    }
    errors.push("direct edit: no matching content found");
  } catch (e) {
    errors.push(`direct edit: ${msg(e)}`);
  }

  return { ok: false, errors };
}

function msg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

async function stage(dir: string, files: string[], env?: NodeJS.ProcessEnv) {
  for (const f of files) {
    // Skip anything that resolves outside the worktree — `git add` would
    // reject it anyway, but not staging it is the honest outcome and keeps
    // the caller from committing a half-applied patch it thinks is whole.
    if (!containedPath(dir, f)) continue;
    await run("git", ["-C", dir, "add", "--", f], { env }).catch(() => {});
  }
}

// ── Line endings and rollback ─────────────────────────────────────────

/** Models write LF. For a file the repo stores with CRLF, give that file's
 *  hunk lines a CR so context matches and added lines keep the file's style. */
async function matchLineEndings(dir: string, diff: string, files: string[]): Promise<string> {
  const crlf = new Set<string>();
  for (const f of files) {
    const abs = containedPath(dir, f);
    if (abs && existsSync(abs) && (await readFile(abs, "utf8")).includes("\r\n")) crlf.add(f);
  }
  if (!crlf.size) return diff;
  const lines = diff.split("\n");
  let file: string | null = null;
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    if (headerPairAt(lines, i)) { file = headerFile(lines[i], lines[i + 1]); inHunk = false; i++; continue; }
    if (lines[i].startsWith("diff --git ")) { inHunk = false; continue; }
    if (lines[i].startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk || !file || !crlf.has(file) || i === lines.length - 1) continue;
    if (lines[i] === "") lines[i] = " \r"; // a blank context line
    else if (/^[ +-]/.test(lines[i])) lines[i] += "\r";
  }
  return lines.join("\n");
}

/** Put the touched files back to HEAD after a tier that can fail half-way. */
async function restore(dir: string, files: string[], env?: NodeJS.ProcessEnv) {
  for (const f of files) {
    const abs = containedPath(dir, f);
    if (!abs) continue;
    const inHead = await run("git", ["-C", dir, "cat-file", "-e", `HEAD:${f}`], { env }).then(() => true, () => false);
    if (inHead) {
      await run("git", ["-C", dir, "checkout", "-q", "HEAD", "--", f], { env }).catch(() => {});
    } else {
      await run("git", ["-C", dir, "rm", "-q", "-f", "--cached", "--ignore-unmatch", "--", f], { env }).catch(() => {});
      await rm(abs, { force: true }).catch(() => {});
    }
  }
}

// ── Direct file edit fallback ─────────────────────────────────────────
// For hunks git and patch both refuse (placeholder `@@ ... @@` headers, a
// lost header line). Each hunk's context and removed lines must match exactly
// one place in the file, exactly or ignoring indentation, and every hunk must
// match or nothing is written. Anything looser silently edits the wrong code.

/** The body lines of each hunk (a header pair with no `@@` after it is one
 *  implicit hunk), or null when any hunk is malformed: skipping that hunk and
 *  applying the rest would report a partial change as a whole one. */
function hunkBodies(diff: string): string[][] | null {
  const lines = diff.split("\n");
  const hunks: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const implicit = lines[i].startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ") && !(lines[i + 2] ?? "").startsWith("@@");
    if (!lines[i].startsWith("@@") && !implicit) continue;
    let j = implicit ? i + 2 : i + 1;
    const body: string[] = [];
    for (; j < lines.length && !endsHunk(lines, j); j++) {
      const c = lines[j][0];
      if (c === "\\") continue;
      if (c !== undefined && c !== " " && c !== "-" && c !== "+") return null;
      body.push(lines[j]);
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    if (!body.length) return null;
    hunks.push(body);
    i = j - 1;
  }
  return hunks;
}

/** `lines` with one hunk applied, or null unless its old side matches exactly one place. */
function applyHunk(lines: string[], body: string[]): string[] | null {
  const oldSide = body.filter((l) => l[0] !== "+").map((l) => l.slice(1));
  if (!oldSide.length || oldSide.every((l) => !l.trim())) return null;
  const matches = (same: (a: string, b: string) => boolean) => {
    const at: number[] = [];
    for (let i = 0; i + oldSide.length <= lines.length; i++) {
      if (oldSide.every((l, k) => same(lines[i + k], l))) at.push(i);
    }
    return at;
  };
  let at = matches((a, b) => a === b);
  const loose = at.length !== 1;
  if (loose) at = matches((a, b) => a.trim() === b.trim());
  if (at.length !== 1) return null;
  const start = at[0];
  const baseIndent = lines[start].match(/^\s*/)?.[0] ?? "";
  const replacement: string[] = [];
  let k = 0; // position on the old side
  for (const l of body) {
    if (l[0] === "-") { k++; continue; }
    if (l[0] === "+") {
      const text = l.slice(1);
      replacement.push(loose && text.trim() && !/^\s/.test(text) ? baseIndent + text : text);
      continue;
    }
    replacement.push(lines[start + k]); // context keeps the file's own text
    k++;
  }
  return [...lines.slice(0, start), ...replacement, ...lines.slice(start + oldSide.length)];
}

async function tryDirectEdit(dir: string, diff: string, files: string[]): Promise<boolean> {
  const abs = files.length === 1 ? containedPath(dir, files[0]) : null;
  if (!abs || !existsSync(abs)) return false;
  const content = await readFile(abs, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  let lines: string[] | null = content.split(/\r?\n/);
  // Creating or deleting a file is all-or-nothing; a line-level fallback would
  // turn a partly listed deletion into a partial edit.
  if (/^(?:---|\+\+\+) \/dev\/null/m.test(diff)) return false;
  const hunks = hunkBodies(diff);
  if (!hunks?.length) return false;
  for (const body of hunks) {
    lines = applyHunk(lines, body);
    if (!lines) return false;
  }
  const updated = lines.join(eol);
  if (updated === content) return false;
  await writeFile(abs, updated);
  return true;
}
