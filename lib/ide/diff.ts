// The contributor's edits as one git-style unified diff, computed in the
// browser (components/ide/fs.ts getDiff) and sent with Run and the checkpoint.
// The server applies it with `git apply` (lib/apply-diff.ts), so the format
// follows git: `diff --git` headers, a/ b/ prefixes, /dev/null for new files.

import { createTwoFilesPatch } from "diff";

export interface FileEdit {
  path: string;
  /** The file at the pinned commit, or null for a file the contributor created. */
  base: string | null;
  current: string;
}

function fileDiff({ path, base, current }: FileEdit): string {
  const created = base === null;
  const patch = createTwoFilesPatch(created ? "/dev/null" : `a/${path}`, `b/${path}`, base ?? "", current, undefined, undefined, { headerOptions: { includeIndex: false, includeUnderline: false, includeFileHeaders: true } });
  return `diff --git a/${path} b/${path}\n${created ? "new file mode 100644\n" : ""}${patch}`;
}

/** Unchanged files are left out; files come in path order so the same edits
 *  always give the same diff. Empty string when nothing changed. */
export function gitDiff(edits: FileEdit[]): string {
  return edits
    .filter((edit) => edit.base !== edit.current)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(fileDiff)
    .join("");
}
