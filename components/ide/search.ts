// Search across the repo (the workbench's search view and Ctrl+P), over the
// same files as the explorer (PLAN §8.0). Replaces the search override's
// default provider, which walks the explorer and reads every file one by one
// with no cap, so a search in a large repo fetched the whole repository.
//
//   file search   matched against the tree in memory, no fetches
//   text search   the files the include/exclude globs allow, in path order,
//                 under lib/ide/search.ts SEARCH_LIMITS; open editors are
//                 searched by the workbench itself
//
// Results come back as files finish, like ripgrep's in desktop VS Code.

import { getService, ISearchService } from "@codingame/monaco-vscode-api/services";
import { createRegExp } from "@codingame/monaco-vscode-api/vscode/vs/base/common/strings";
import { match } from "@codingame/monaco-vscode-api/vscode/vs/base/common/glob";
import {
  FileMatch, pathIncludedInQuery, SearchProviderType, TextSearchMatch,
  type IFileMatch, type IFileQuery, type ISearchComplete, type ISearchProgressItem, type ISearchResultProvider, type ITextQuery,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { TextSearchCompleteMessageType } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/searchExtTypes";
import type { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import { monaco } from "@codingame/monaco-editor-wrapper";
import { RepoFs, WORKSPACE_ROOT } from "./fs";
import { findMatches, searchCandidates, SEARCH_LIMITS } from "@/lib/ide/search";

type Query = ITextQuery | IFileQuery;

/** The query's include/exclude globs (search view fields plus files.exclude/search.exclude). */
function includedBy(query: Query): (path: string) => boolean {
  return (path) => {
    const fsPath = `${WORKSPACE_ROOT}/${path}`;
    if (!pathIncludedInQuery(query, fsPath)) return false;
    return query.folderQueries.every((folder) => {
      if (folder.includePattern && !match(folder.includePattern, path)) return false;
      return !folder.excludePattern?.some((exclude) => match(exclude.pattern, path));
    });
  };
}

function repoProvider(fs: RepoFs): ISearchResultProvider {
  const uri = (path: string) => monaco.Uri.file(`${WORKSPACE_ROOT}/${path}`);
  return {
    async getAIName() { return undefined; },
    async clearCache() {},

    async fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
      const pattern = (query.filePattern ?? "").toLowerCase().replace(/\\/g, "/").replace(/\s/g, "");
      const included = includedBy(query);
      const max = query.maxResults ?? SEARCH_LIMITS.maxResults;
      // Quick open's fuzzy rule: the pattern's characters appear in order in the path.
      const fuzzy = (path: string) => {
        let at = 0;
        for (const ch of path.toLowerCase()) if (ch === pattern[at]) at++;
        return at === pattern.length;
      };
      const found = token?.isCancellationRequested ? [] : fs.files().map((file) => file.path).filter((path) => fuzzy(path) && included(path));
      // Over the cap, keep the likeliest: the pattern inside the file name, then shorter paths.
      const rank = (path: string) => (path.slice(path.lastIndexOf("/") + 1).toLowerCase().includes(pattern) ? 0 : 1e6) + path.length;
      if (found.length > max) found.sort((a, b) => rank(a) - rank(b));
      return { results: found.slice(0, max).map((path): IFileMatch => ({ resource: uri(path) })), limitHit: found.length > max, messages: [] };
    },

    async textSearch(query: ITextQuery, onProgress?: (item: ISearchProgressItem) => void, token?: CancellationToken): Promise<ISearchComplete> {
      const { contentPattern: p } = query;
      const regexp = createRegExp(p.pattern, !!p.isRegExp, { wholeWord: p.isWordMatch, matchCase: p.isCaseSensitive, multiline: true, global: true, unicode: true });
      const { paths, skipped } = searchCandidates(fs.files(), includedBy(query), query.maxFileSize ?? Infinity);
      const max = query.maxResults ?? SEARCH_LIMITS.maxResults;
      const decoder = new TextDecoder();
      const results: FileMatch[] = [];
      let found = 0;
      let next = 0;
      const worker = async () => {
        while (next < paths.length && found < max && !token?.isCancellationRequested) {
          const path = paths[next++];
          let text: string;
          try { text = decoder.decode(await fs.readFile(path)); } catch { continue; } // a file that won't fetch isn't a match
          const matches = findMatches(text, regexp, max - found);
          if (!matches.length || found >= max) continue;
          found += matches.length;
          const file = new FileMatch(uri(path));
          file.results = matches.map((m) => new TextSearchMatch(m.preview, { startLineNumber: m.startLine, startColumn: m.startColumn, endLineNumber: m.endLine, endColumn: m.endColumn }, query.previewOptions));
          results.push(file);
          onProgress?.(file);
        }
      };
      // The fetches overlap; findMatches is synchronous, so the shared regexp's lastIndex never interleaves.
      await Promise.all(Array.from({ length: SEARCH_LIMITS.concurrency }, worker));
      const messages = skipped ? [{ text: `Searched ${paths.length} files; ${skipped} more were left out (too large, or past the ${SEARCH_LIMITS.maxFiles}-file limit). Narrow "files to include" to search them.`, type: TextSearchCompleteMessageType.Warning }] : [];
      return { results, limitHit: found >= max, messages };
    },
  };
}

/** Puts the repo search in front of the workbench's default file-scheme providers. */
export async function registerRepoSearch(fs: RepoFs): Promise<void> {
  const search = await getService(ISearchService);
  const provider = repoProvider(fs);
  search.registerSearchResultProvider("file", SearchProviderType.file, provider);
  search.registerSearchResultProvider("file", SearchProviderType.text, provider);
}
