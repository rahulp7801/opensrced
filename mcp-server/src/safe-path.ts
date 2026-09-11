import { realpath } from "node:fs/promises";
import path from "node:path";

/** Resolve links before reading repository files; Git metadata is never source. */
export async function safeRepoPath(dir: string, relative: string): Promise<string> {
  const forbidden = (value: string) =>
    value.split(/[\\/]/).some(part => /^\.git[ .]*$/i.test(part));
  if (path.isAbsolute(relative) || /[:\0]/.test(relative) || forbidden(relative)) {
    throw new Error("Path must refer to repository source");
  }
  const root = await realpath(dir);
  const inside = (candidate: string) => {
    const rel = path.relative(root, candidate);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || forbidden(rel)) {
      throw new Error("Path escapes repository source");
    }
  };
  const candidate = path.resolve(root, relative);
  inside(candidate);
  const resolved = await realpath(candidate);
  inside(resolved);
  return resolved;
}
