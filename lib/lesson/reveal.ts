// The reveal screen's comparison (PLAN §7.6): each hunk of the AI's diff is
// marked "match" (green) where the contributor's own plan or code reached the
// same place, else "miss" (amber). Deterministic and cheap, so it can run in
// the browser on the diff the reveal unlocked.
//
//   path A (plan)  the plan (s4/s7/s8 answers) names the hunk's file, or a
//                  code name on one of the hunk's changed lines
//   path B (code)  the contributor's own diff changes the same file

import type { SplitHunk } from "../diff-view";

export type HunkVerdict = "match" | "miss";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole name: `sessions.py` matches "src/sessions.py," but not "mysessions.py". */
const named = (text: string, name: string) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w-])`, "i").test(text);

/** Code-shaped names on the hunk's changed rows: snake_case, camelCase, or
 *  called. Plain words (`return`, `session`) are too common to count. */
export function changedNames(hunk: SplitHunk): string[] {
  const names = new Set<string>();
  const rows = Math.max(hunk.before.length, hunk.after.length);
  for (let i = 0; i < rows; i++) {
    const before = hunk.before[i] ?? null;
    const after = hunk.after[i] ?? null;
    if (before === after) continue;
    for (const line of [before, after]) {
      for (const m of (line ?? "").matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}(\s*\()?/g)) {
        const word = m[0].replace(/\s*\($/, "");
        if (m[1] || word.includes("_") || /[a-z][A-Z]/.test(word)) names.add(word);
      }
    }
  }
  return [...names];
}

/** Files a unified diff changes. */
export function diffFiles(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((m) => m[1]).filter((f) => f !== "/dev/null"))];
}

export function hunkVerdicts(hunks: SplitHunk[], theirs: { plan: string } | { diff: string }): HunkVerdict[] {
  if ("diff" in theirs) {
    const files = new Set(diffFiles(theirs.diff));
    return hunks.map((h) => (files.has(h.file) ? "match" : "miss"));
  }
  return hunks.map((h) => {
    const base = h.file.slice(h.file.lastIndexOf("/") + 1);
    const hit = named(theirs.plan, h.file) || named(theirs.plan, base) || changedNames(h).some((n) => named(theirs.plan, n));
    return hit ? "match" : "miss";
  });
}
