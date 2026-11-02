// The in-browser IDE's view of a repository at one pinned commit.
// Pure: the API route (app/api/ide/tree) and the browser file system
// (components/ide/fs.ts) share these, and lib/__tests__/ide-repo-tree.test.ts
// covers them without a browser.

export interface RepoFile { path: string; size: number }
export interface RepoTree { repo: string; sha: string; truncated: boolean; files: RepoFile[] }

/** A full commit SHA. Branch names are refused: a lesson pins one commit so
 *  the base files, the diff and the hidden fix all describe the same code. */
export function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

/** Blobs from GitHub's `git/trees/<sha>?recursive=1` response. Submodules
 *  (type "commit") and directories are dropped: directories are implied by
 *  paths, and a submodule's files live in another repository. */
export function treeFiles(raw: unknown): { files: RepoFile[]; truncated: boolean } {
  const body = raw as { tree?: unknown; truncated?: unknown } | null;
  if (!body || !Array.isArray(body.tree)) throw new Error("GitHub returned no tree for that commit.");
  const files: RepoFile[] = [];
  for (const entry of body.tree as Array<{ type?: unknown; path?: unknown; size?: unknown }>) {
    if (entry?.type !== "blob" || typeof entry.path !== "string" || !entry.path) continue;
    files.push({ path: entry.path, size: typeof entry.size === "number" ? entry.size : 0 });
  }
  return { files, truncated: body.truncated === true };
}

export type EntryKind = "file" | "dir";

/** Directory path ("" is the root) → its children by name. */
export function directoryIndex(paths: string[]): Map<string, Map<string, EntryKind>> {
  const index = new Map<string, Map<string, EntryKind>>([["", new Map()]]);
  for (const path of paths) {
    const parts = path.split("/");
    let dir = "";
    parts.forEach((name, i) => {
      const kind: EntryKind = i === parts.length - 1 ? "file" : "dir";
      index.get(dir)!.set(name, kind);
      const child = dir ? `${dir}/${name}` : name;
      if (kind === "dir" && !index.has(child)) index.set(child, new Map());
      dir = child;
    });
  }
  return index;
}

/** raw.githubusercontent.com URL for one file at the pinned commit. Each
 *  segment is encoded so names with spaces, # or ? fetch the right file. */
export function rawFileUrl(repo: string, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The workbench's storage scope for one lesson on one commit: VS Code keeps
 *  open editors, layout and view state per workspace id, in an IndexedDB
 *  database named after it. Every lesson mounts its repo at the same
 *  /workspace folder, so without this id they all shared one. The demo page
 *  reuses one lesson id for any repo, hence repo and commit too (the same
 *  parts as the edits overlay key in components/ide/fs.ts). Lesson ids and
 *  SHAs have no ".", so the parts can't run together. */
export function workbenchStorageId(lessonId: string, repo: string, sha: string): string {
  return `ide.${lessonId}.${encodeURIComponent(repo)}.${sha.toLowerCase()}`;
}
