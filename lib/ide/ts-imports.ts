// Which repo files the IDE's TypeScript worker needs besides the open ones.
// The worker only sees models and extra libs, so `import { x } from "./other"`
// reads as a missing module until other.ts is handed to it.
// components/ide/languages.ts follows a TS/JS file's relative imports through
// the repo tree with these and adds what they reach as extra libs. Pure, so
// lib/__tests__/ide-ts-imports.test.ts covers it without a browser.

/** Caps on what one page load hands the TypeScript worker. Each file is a
 *  fetch from raw.githubusercontent.com the first time and stays in the
 *  worker's memory, so a barrel file in a big repo can't pull in everything. */
export const TS_IMPORT_LIMITS = {
  /** Repo files added as extra libs per page load (open files don't count). */
  maxFiles: 200,
  /** Larger files (bundles, generated code) are left out; their imports then read as `any`. */
  maxFileBytes: 200_000,
};

const SCRIPT = /\.(?:[cm]?[jt]sx?|d\.[cm]?ts)$/;

/** TS/JS source the worker type-checks (also .mts/.cts/.mjs/.cjs and .d.ts). */
export function isScriptPath(path: string): boolean {
  return SCRIPT.test(path);
}

// import x from "a" · import "a" · export * from "a" · import("a") · require("a") · /// <reference path="a" />
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|<reference\s+path\s*=\s*)(["'])([^"'\n]+)\1/g;

/** Relative module specifiers in a TS/JS file ("./a", "../b/c.js"), in order,
 *  each once. Bare package names are skipped: there is no node_modules in the
 *  browser. A regex, not a parser: a match inside a string or comment only
 *  costs one extra lookup. */
export function relativeImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2];
    if (specifier.startsWith("./") || specifier.startsWith("../") || match[0].startsWith("<reference")) found.add(specifier);
  }
  return [...found];
}

/** "a/b/../c" → "a/c"; null when the path climbs out of the repo. */
function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
// ESM TypeScript imports the emitted name ("./a.js" for a.ts).
const EMITTED: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** The repo file `specifier` names when imported from `from`, tried the way
 *  TypeScript's bundler resolution does: as written, the .ts behind a .js,
 *  with each extension added, then as a directory's index file. */
export function resolveImport(from: string, specifier: string, exists: (path: string) => boolean): string | null {
  const slash = from.lastIndexOf("/");
  const base = normalize(`${slash < 0 ? "" : from.slice(0, slash)}/${specifier}`);
  if (!base) return null;
  const candidates: string[] = [];
  if (isScriptPath(base)) candidates.push(base);
  const ext = /\.(?:jsx?|[cm]js)$/.exec(base)?.[0];
  if (ext) candidates.push(...EMITTED[ext].map((ts) => base.slice(0, -ext.length) + ts));
  candidates.push(...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`));
  return candidates.find(exists) ?? null;
}
