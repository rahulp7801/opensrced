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
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
  if (!rel || rel.includes("\0")) return null;
  const root = resolve(dir);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
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

/** Repair the two things LLMs most often get wrong about diff framing:
 *  missing `a/` / `b/` path prefixes, and a missing trailing newline
 *  (which `git apply` rejects outright with "corrupt patch"). */
export function normalizeDiff(raw: string): string {
  let diff = raw;

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

/** Every file path the diff claims to touch. */
export function diffTouchedFiles(diff: string): string[] {
  return [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)]
    .map((m) => m[1])
    .filter((p) => p !== "/dev/null");
}

async function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  return execFileAsync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? childEnv(),
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
}

/**
 * Apply `diff` inside the git working tree at `dir`.
 *
 * On success the touched files are staged, so the caller can commit
 * directly without a separate `git add`.
 */
export async function applyDiff(
  dir: string,
  diff: string,
  patchPath: string,
  opts: ApplyOpts = {},
): Promise<ApplyResult> {
  const env = opts.env;
  const normalized = normalizeDiff(diff);
  await writeFile(patchPath, normalized);

  const files = diffTouchedFiles(normalized);
  const errors: string[] = [];

  const base = ["-C", dir, "apply", "--index", "--recount", "--whitespace=nowarn"];
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
    }
  }

  // GNU patch slides hunks to find their match, which handles the very
  // common case of Claude writing the right change with a wrong @@ line
  // number. -p0 covers diffs whose paths never had a/ b/ prefixes.
  for (const strip of ["-p1", "-p0"]) {
    try {
      await run("patch", [strip, "--fuzz=3", "--no-backup-if-mismatch", "-i", patchPath], {
        cwd: dir,
        env,
      });
      // GNU patch writes the working tree but not the index; stage so the
      // caller's commit picks the changes up.
      await stage(dir, files, env);
      return { ok: true, tier: `patch ${strip} --fuzz=3`, files };
    } catch (e) {
      errors.push(`patch ${strip}: ${msg(e)}`);
    }
  }

  // Last resort: treat the block as "replace these lines with those" and
  // edit the file directly. Handles output that never was a unified diff.
  try {
    const edited = await tryDirectEdit(dir, normalized);
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

// ── Direct file edit fallback ─────────────────────────────────────────
// When the payload isn't a valid unified diff, parse it as removed/added
// line pairs and splice them into the target file. Four escalating match
// strategies, exact first.

async function tryDirectEdit(dir: string, rawDiff: string): Promise<boolean> {
  // Find the target file — try multiple patterns.
  let filePath: string | null = null;
  const filePatterns = [
    /^\+\+\+ (?:b\/)?(\S+)/m,
    /^--- (?:a\/)?(\S+)/m,
    /^diff --git a\/(\S+)/m,
    // Claude sometimes just mentions the file path in text before the diff
    /(?:in|file|modify|change)\s+[`"']?([^\s`"']+\.\w{1,5})[`"']?/im,
  ];
  let absPath: string | null = null;
  for (const pat of filePatterns) {
    const m = rawDiff.match(pat);
    if (m && m[1] !== "/dev/null") {
      const candidate = m[1].replace(/^[ab]\//, "");
      // Containment check before existsSync, not after: a path that escapes
      // the worktree must never be probed, let alone written.
      const abs = containedPath(dir, candidate);
      if (abs && existsSync(abs)) {
        filePath = candidate;
        absPath = abs;
        break;
      }
    }
  }
  if (!filePath || !absPath) return false;

  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch {
    return false;
  }

  const removals: string[] = [];
  const additions: string[] = [];
  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---") && !line.startsWith("--")) {
      removals.push(line.slice(1));
    } else if (line.startsWith("+") && !line.startsWith("+++") && !line.startsWith("++")) {
      additions.push(line.slice(1));
    }
  }
  if (removals.length === 0 && additions.length === 0) return false;

  // 1. Exact block match.
  const oldBlock = removals.join("\n");
  const newBlock = additions.join("\n");
  if (oldBlock && content.includes(oldBlock)) {
    const updated = content.replace(oldBlock, newBlock);
    if (updated !== content) {
      await writeFile(absPath, updated);
      return true;
    }
  }

  const contentLines = content.split("\n");

  // 2. Trimmed block match — same lines, different indentation.
  const trimmedRemovals = removals.map((l) => l.trim());
  if (trimmedRemovals.length > 0 && trimmedRemovals[0]) {
    for (let i = 0; i <= contentLines.length - removals.length; i++) {
      let match = true;
      for (let j = 0; j < trimmedRemovals.length; j++) {
        if (contentLines[i + j].trim() !== trimmedRemovals[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        const baseIndent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
        const newLines = additions.map((l) => {
          const trimmed = l.trimStart();
          const origIndent = l.match(/^(\s*)/)?.[1] ?? "";
          return origIndent || trimmed === "" ? l : baseIndent + trimmed;
        });
        contentLines.splice(i, removals.length, ...newLines);
        await writeFile(absPath, contentLines.join("\n"));
        return true;
      }
    }
  }

  // 3. Single-line fuzzy replacement.
  if (removals.length === 1 && additions.length === 1) {
    const oldTrimmed = removals[0].trim();
    if (oldTrimmed.length > 5) {
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() === oldTrimmed) {
          const indent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
          contentLines[i] = indent + additions[0].trim();
          await writeFile(absPath, contentLines.join("\n"));
          return true;
        }
      }
    }
  }

  // 4. Multi-line fuzzy — anchor on the first and last removed lines.
  if (removals.length >= 2) {
    const firstTrimmed = removals[0].trim();
    const lastTrimmed = removals[removals.length - 1].trim();
    if (firstTrimmed.length > 5 && lastTrimmed.length > 5) {
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() !== firstTrimmed) continue;
        for (let j = i + 1; j < Math.min(i + removals.length + 5, contentLines.length); j++) {
          if (contentLines[j].trim() !== lastTrimmed) continue;
          const indent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
          const newLines = additions.map((l) => {
            const trimmed = l.trimStart();
            return trimmed === "" ? "" : indent + trimmed;
          });
          contentLines.splice(i, j - i + 1, ...newLines);
          await writeFile(absPath, contentLines.join("\n"));
          return true;
        }
      }
    }
  }

  return false;
}
