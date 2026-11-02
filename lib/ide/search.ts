// Search across the repo in the in-browser IDE (the workbench's search view).
// Text search reads files through the same file system as the editor (the
// IndexedDB cache, else raw.githubusercontent.com), so it is bounded: which
// files are read, how big, and how many matches come back.
// components/ide/search.ts is the workbench adapter; this part is pure and
// covered by lib/__tests__/ide-search.test.ts.

import type { RepoFile } from "./repo-tree";

export const SEARCH_LIMITS = {
  /** Files read per text search, in path order; the rest are reported as not searched. */
  maxFiles: 2_000,
  /** Larger files are skipped (minified bundles, fixtures, lockfiles). */
  maxFileBytes: 512_000,
  /** Matches per search, the workbench's own default cap. */
  maxResults: 20_000,
  /** Files fetched at once. */
  concurrency: 8,
};

// Binary formats a text search can't match in; skipped without fetching.
const BINARY = /\.(?:png|jpe?g|gif|bmp|ico|webp|avif|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|whl|egg|so|dll|dylib|exe|bin|o|a|class|pyc|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|ogg|wav|flac|psd|sqlite|db)$/i;

/** The files a text search reads, and how many it leaves out for the caps.
 *  `included` applies the search view's include/exclude globs. */
export function searchCandidates(
  files: RepoFile[], included: (path: string) => boolean, maxFileBytes: number, limits = SEARCH_LIMITS,
): { paths: string[]; skipped: number } {
  const wanted = files
    .filter((file) => !BINARY.test(file.path) && included(file.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const small = wanted.filter((file) => file.size <= Math.min(maxFileBytes, limits.maxFileBytes));
  const paths = small.slice(0, limits.maxFiles).map((file) => file.path);
  return { paths, skipped: wanted.length - paths.length };
}

/** One match: 0-based lines and columns (the workbench's search ranges), plus the text of the lines it spans. */
export interface TextMatch { startLine: number; startColumn: number; endLine: number; endColumn: number; preview: string }

/** Every match of a global regexp in `text`, at most `max`. Line starts are
 *  indexed once, so a file with many matches stays linear. */
export function findMatches(text: string, regexp: RegExp, max: number): TextMatch[] {
  if (!regexp.global) throw new Error("findMatches needs a global regexp");
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const lineText = (from: number, to: number) => text.slice(starts[from], to + 1 < starts.length ? starts[to + 1] - 1 : text.length).replace(/\r$/gm, "");
  const matches: TextMatch[] = [];
  regexp.lastIndex = 0;
  for (let m = regexp.exec(text); m && matches.length < max; m = regexp.exec(text)) {
    if (m[0].length === 0) { regexp.lastIndex++; continue; }
    const end = m.index + m[0].length;
    const startLine = lineOf(m.index);
    const endLine = lineOf(end);
    matches.push({ startLine, startColumn: m.index - starts[startLine], endLine, endColumn: end - starts[endLine], preview: lineText(startLine, endLine) });
  }
  return matches;
}
