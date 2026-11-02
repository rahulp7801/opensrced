// The IDE's file system: a public repo at one pinned commit, with the
// contributor's edits layered on top (PLAN §8.0 step 1).
//
//   tree        GET /api/ide/tree (GitHub git/trees, once per load)
//   base files  raw.githubusercontent.com at the commit, fetched when opened,
//               cached in IndexedDB (a commit's files never change)
//   edits       IndexedDB, per lesson, so a reload or a break loses nothing
//
// RepoFs is plain browser code; repoFileSystemProvider adapts it to VS Code's
// file system provider so the workbench's explorer, editors and save use it.

import {
  FileChangeType, FileSystemProviderCapabilities, FileSystemProviderError, FileSystemProviderErrorCode, FileType,
  type IFileSystemProviderWithFileReadWriteCapability, type IStat,
} from "@codingame/monaco-vscode-files-service-override";
import { monaco } from "@codingame/monaco-editor-wrapper";
import { directoryIndex, rawFileUrl, type EntryKind, type RepoFile, type RepoTree } from "@/lib/ide/repo-tree";
import { gitDiff, type FileEdit } from "@/lib/ide/diff";

/** Where the repo is mounted in the workbench (file:///workspace/...). */
export const WORKSPACE_ROOT = "/workspace";

// ── IndexedDB: two stores, string keys ────────────────────────────────────
// ponytail: raw IndexedDB in ~20 lines instead of a wrapper library.

type Store = "base" | "edits";
type Edit = { content: Uint8Array; at: number };
let dbPromise: Promise<IDBDatabase> | null = null;

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("opensrcer-ide", 1);
    open.onupgradeneeded = () => { open.result.createObjectStore("base"); open.result.createObjectStore("edits"); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

async function store(name: Store, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
  return (await db()).transaction(name, mode).objectStore(name);
}

// ── RepoFs ────────────────────────────────────────────────────────────────

export class RepoFs {
  private readonly index: Map<string, Map<string, EntryKind>>;
  private readonly sizes: Map<string, number>;
  /** Paths at the pinned commit (sizes also holds files the contributor created). */
  private readonly inTree: Set<string>;
  /** Edit times by path, so stat reports a new mtime after each save. */
  private readonly editedAt = new Map<string, number>();

  private constructor(readonly tree: RepoTree, readonly lessonId: string) {
    this.index = directoryIndex(tree.files.map((file) => file.path));
    this.sizes = new Map(tree.files.map((file) => [file.path, file.size]));
    this.inTree = new Set(this.sizes.keys());
  }

  static async load(repo: string, sha: string, lessonId: string): Promise<RepoFs> {
    const res = await fetch(`/api/ide/tree?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`);
    const body = await res.json().catch(() => null) as RepoTree & { error?: string } | null;
    if (!res.ok || !body) throw new Error(body?.error ?? `Could not load the repository (${res.status}).`);
    const fs = new RepoFs(body, lessonId);
    // Files the contributor created earlier only exist in the overlay: put them back in the tree.
    for (const [path, edit] of await fs.edits()) {
      if (!fs.inTree.has(path)) fs.addToIndex(path, "file");
      fs.editedAt.set(path, edit.at);
      fs.sizes.set(path, edit.content.byteLength);
    }
    return fs;
  }

  private get baseKey() { return `${this.tree.repo}@${this.tree.sha}/`; }
  private get editKey() { return `${this.lessonId}|${this.tree.repo}@${this.tree.sha}/`; }

  private async edits(): Promise<Array<[string, Edit]>> {
    const range = IDBKeyRange.bound(this.editKey, `${this.editKey}￿`);
    const edits = await store("edits");
    const [keys, values] = await Promise.all([done(edits.getAllKeys(range)), done(edits.getAll(range))]);
    return keys.map((key, i) => [String(key).slice(this.editKey.length), values[i] as Edit]);
  }

  private addToIndex(path: string, kind: EntryKind) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const own = parts.slice(0, i + 1).join("/");
      const entryKind = i === parts.length - 1 ? kind : "dir";
      if (!this.index.has(dir)) this.index.set(dir, new Map());
      this.index.get(dir)!.set(parts[i], entryKind);
      if (entryKind === "dir" && !this.index.has(own)) this.index.set(own, new Map());
    }
  }

  kind(path: string): EntryKind | null {
    if (this.index.has(path)) return "dir";
    return this.sizes.has(path) || this.editedAt.has(path) ? "file" : null;
  }

  children(path: string): Array<[string, EntryKind]> {
    return [...(this.index.get(path) ?? [])];
  }

  /** Every file: the tree at the commit plus the contributor's new files. */
  files(): RepoFile[] {
    return [...this.sizes].map(([path, size]) => ({ path, size }));
  }

  stat(path: string): { size: number; mtime: number } {
    return { size: this.sizes.get(path) ?? 0, mtime: this.editedAt.get(path) ?? 0 };
  }

  /** The file at the pinned commit: IndexedDB cache, else raw.githubusercontent.com. */
  async readBase(path: string): Promise<Uint8Array> {
    const cached = await done((await store("base")).get(this.baseKey + path)) as Uint8Array | undefined;
    if (cached) return cached;
    const res = await fetch(rawFileUrl(this.tree.repo, this.tree.sha, path));
    if (!res.ok) throw new Error(`Could not fetch ${path} (${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await done((await store("base", "readwrite")).put(bytes, this.baseKey + path));
    return bytes;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const edit = await done((await store("edits")).get(this.editKey + path)) as Edit | undefined;
    return edit ? edit.content : this.readBase(path);
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const at = Date.now();
    await done((await store("edits", "readwrite")).put({ content, at } satisfies Edit, this.editKey + path));
    if (this.kind(path) === null) this.addToIndex(path, "file");
    this.sizes.set(path, content.byteLength);
    this.editedAt.set(path, at);
  }

  /** A directory the contributor made for a new file (kept in memory; its files bring it back on reload). */
  mkdir(path: string) { this.addToIndex(path, "dir"); }

  /** Only files the contributor created can be deleted; the repo's own files are the lesson's base. */
  async deleteCreated(path: string): Promise<boolean> {
    if (this.inTree.has(path) || !this.editedAt.has(path)) return false;
    await done((await store("edits", "readwrite")).delete(this.editKey + path));
    this.editedAt.delete(path);
    this.sizes.delete(path);
    const slash = path.lastIndexOf("/");
    this.index.get(slash < 0 ? "" : path.slice(0, slash))?.delete(path.slice(slash + 1));
    return true;
  }

  /** The contributor's edits as one git-style unified diff against the pinned commit. */
  async getDiff(): Promise<string> {
    const decoder = new TextDecoder();
    const edits: FileEdit[] = [];
    for (const [path, edit] of await this.edits()) {
      const base = this.inTree.has(path) ? decoder.decode(await this.readBase(path)) : null;
      edits.push({ path, base, current: decoder.decode(edit.content) });
    }
    return gitDiff(edits);
  }
}

// ── VS Code adapter ───────────────────────────────────────────────────────

function notFound(): never {
  throw FileSystemProviderError.create("Not in this repository", FileSystemProviderErrorCode.FileNotFound);
}

/** Path inside the repo, or null for a URI outside WORKSPACE_ROOT (other providers answer those). */
function repoPath(resource: { path: string }): string | null {
  if (resource.path === WORKSPACE_ROOT) return "";
  return resource.path.startsWith(`${WORKSPACE_ROOT}/`) ? resource.path.slice(WORKSPACE_ROOT.length + 1) : null;
}

export function repoFileSystemProvider(fs: RepoFs): IFileSystemProviderWithFileReadWriteCapability {
  const changes = new monaco.Emitter<readonly { type: FileChangeType; resource: monaco.Uri }[]>();
  const fileType = (kind: EntryKind) => (kind === "dir" ? FileType.Directory : FileType.File);
  return {
    capabilities: FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive,
    onDidChangeCapabilities: new monaco.Emitter<void>().event,
    onDidChangeFile: changes.event as IFileSystemProviderWithFileReadWriteCapability["onDidChangeFile"],
    watch: () => ({ dispose() {} }),
    async stat(resource): Promise<IStat> {
      const path = repoPath(resource);
      const kind = path === null ? null : fs.kind(path);
      if (path === null || !kind) notFound();
      const { size, mtime } = kind === "file" ? fs.stat(path) : { size: 0, mtime: 0 };
      return { type: fileType(kind), size, mtime, ctime: 0 };
    },
    async readdir(resource) {
      const path = repoPath(resource);
      if (path === null || fs.kind(path) !== "dir") notFound();
      return fs.children(path).map(([name, kind]) => [name, fileType(kind)] as [string, FileType]);
    },
    async readFile(resource) {
      const path = repoPath(resource);
      if (path === null || fs.kind(path) !== "file") notFound();
      return fs.readFile(path);
    },
    async writeFile(resource, content) {
      const path = repoPath(resource);
      if (!path) notFound();
      const created = fs.kind(path) === null;
      await fs.writeFile(path, content);
      changes.fire([{ type: created ? FileChangeType.ADDED : FileChangeType.UPDATED, resource: resource as monaco.Uri }]);
    },
    async mkdir(resource) {
      const path = repoPath(resource);
      if (!path) notFound();
      fs.mkdir(path);
    },
    async delete(resource) {
      const path = repoPath(resource);
      if (path === null) notFound();
      if (!(await fs.deleteCreated(path))) throw FileSystemProviderError.create("Only files you created can be deleted here.", FileSystemProviderErrorCode.NoPermissions);
      changes.fire([{ type: FileChangeType.DELETED, resource: resource as monaco.Uri }]);
    },
    async rename() {
      throw FileSystemProviderError.create("Renaming isn't supported in the lesson editor yet.", FileSystemProviderErrorCode.NoPermissions);
    },
  };
}
