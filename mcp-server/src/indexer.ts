// Tree-sitter symbol index. Parses source files in a cached shallow clone
// and extracts named declarations (functions, classes, methods, structs,
// enums, traits, types, const-let-var with a lambda/function RHS).
//
// Languages: Python, JavaScript, TypeScript, TSX, Rust, Go. Selection
// rationale: covers what we actually see in tang-vu-style OSS issues; each
// has a stable tree-sitter grammar in `tree-sitter-wasms`. Adding more
// later is a one-liner plus a query string.
//
// Why this exists (v2.0 had a regex `find_definition`):
//   - Regex misses multi-line signatures, decorators above the def line,
//     JS `const foo = () => …`, Rust `impl T { fn foo(…) }` methods, Go
//     `func (r *T) Foo(…)`. Tree-sitter handles all of them structurally.
//   - It also gives us a `kind` label (function/class/method/type/…) that
//     the LLM can read instead of re-inferring from the line content.
//
// Shape:
//   buildIndex(repoDir) → Index { symbols: Array<Symbol>, byName: Map<…> }
//   findByName(index, name) → Symbol[]
//
// The index is cached on disk as <repoDir>/.opensrcer-index.json so
// subsequent tool calls skip the reparse. Invalidated when the clone is
// refreshed (the index file is wiped with the rest of the dir in
// repo-cache.ts's re-clone path).

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// web-tree-sitter v0.22 is CommonJS (`export = Parser`) with Language/Query
// nested on the Parser namespace. We pin to 0.22 because its WASM binary ABI
// matches the prebuilt grammar bundles in tree-sitter-wasms@0.1.13. Newer
// web-tree-sitter (0.25+) uses a new dylink format and fails to load those
// older grammar WASMs with a cryptic `getDylinkMetadata` error.
import Parser from "web-tree-sitter";
type Language = Parser.Language;
type Query = Parser.Query;

const execFileAsync = promisify(execFile);

// Resolve paths to the vendored WASMs relative to this file.  We ship via
// npm so they live under node_modules/tree-sitter-wasms/out/ — walk up from
// dist/indexer.js (or src/indexer.ts during dev).
const HERE = path.dirname(fileURLToPath(import.meta.url));
function wasmPath(name: string): string {
  return path.resolve(
    HERE,
    "..",
    "node_modules",
    "tree-sitter-wasms",
    "out",
    `tree-sitter-${name}.wasm`,
  );
}

// Per-language config: file extensions, WASM name, and a tree-sitter query
// S-expression that captures declaration name tokens tagged `@name` and
// labels them `@kind.<kind>`. We collect the smallest useful set: missing a
// decl kind is fine (falls back to grep), overfitting produces noise.
type LangConfig = {
  lang: string;
  wasm: string;
  exts: string[];
  query: string;
};

const LANGS: LangConfig[] = [
  {
    lang: "python",
    wasm: "python",
    exts: [".py", ".pyi"],
    query: `
      (function_definition name: (identifier) @name) @kind.function
      (class_definition    name: (identifier) @name) @kind.class
      ; Module-level lambda assignments only (FOO = lambda ...). Including
      ; call-expr RHS made every x = foo() look like a def — 10x noise.
      (assignment
        left: (identifier) @name
        right: (lambda)) @kind.function
    `,
  },
  {
    lang: "javascript",
    wasm: "javascript",
    exts: [".js", ".jsx", ".mjs", ".cjs"],
    query: `
      (function_declaration name: (identifier) @name) @kind.function
      (class_declaration    name: (identifier) @name) @kind.class
      (method_definition    name: (property_identifier) @name) @kind.method
      (variable_declarator
        name: (identifier) @name
        value: [(arrow_function) (function_expression)]) @kind.function
      (export_statement
        (function_declaration name: (identifier) @name)) @kind.function
    `,
  },
  {
    lang: "typescript",
    wasm: "typescript",
    exts: [".ts", ".mts", ".cts"],
    query: `
      (function_declaration name: (identifier) @name) @kind.function
      (class_declaration    name: (type_identifier) @name) @kind.class
      (method_definition    name: (property_identifier) @name) @kind.method
      (interface_declaration name: (type_identifier) @name) @kind.interface
      (type_alias_declaration name: (type_identifier) @name) @kind.type
      (enum_declaration name: (identifier) @name) @kind.enum
      (variable_declarator
        name: (identifier) @name
        value: [(arrow_function) (function_expression)]) @kind.function
    `,
  },
  {
    lang: "tsx",
    wasm: "tsx",
    exts: [".tsx"],
    query: `
      (function_declaration name: (identifier) @name) @kind.function
      (class_declaration    name: (type_identifier) @name) @kind.class
      (method_definition    name: (property_identifier) @name) @kind.method
      (interface_declaration name: (type_identifier) @name) @kind.interface
      (type_alias_declaration name: (type_identifier) @name) @kind.type
      (enum_declaration name: (identifier) @name) @kind.enum
      (variable_declarator
        name: (identifier) @name
        value: [(arrow_function) (function_expression)]) @kind.function
    `,
  },
  {
    lang: "rust",
    wasm: "rust",
    exts: [".rs"],
    query: `
      (function_item     name: (identifier) @name) @kind.function
      (struct_item       name: (type_identifier) @name) @kind.struct
      (enum_item         name: (type_identifier) @name) @kind.enum
      (trait_item        name: (type_identifier) @name) @kind.trait
      (type_item         name: (type_identifier) @name) @kind.type
      (const_item        name: (identifier) @name) @kind.const
      (static_item       name: (identifier) @name) @kind.static
      (macro_definition  name: (identifier) @name) @kind.macro
    `,
  },
  {
    lang: "go",
    wasm: "go",
    exts: [".go"],
    query: `
      (function_declaration name: (identifier) @name) @kind.function
      (method_declaration   name: (field_identifier) @name) @kind.method
      (type_declaration (type_spec name: (type_identifier) @name)) @kind.type
      (const_declaration (const_spec name: (identifier) @name)) @kind.const
      (var_declaration (var_spec name: (identifier) @name)) @kind.var
    `,
  },
];

export type Symbol = {
  name: string;
  kind: string;
  lang: string;
  file: string; // repo-relative POSIX path
  line: number; // 1-indexed
  col: number;  // 1-indexed
};

export type Index = {
  builtAt: number;
  fileCount: number;
  symbols: Symbol[];
  byName: Map<string, Symbol[]>;
};

const INDEX_FILENAME = ".opensrcer-index.json";
const MAX_FILE_BYTES = 2_000_000; // skip monster files — they're usually generated

// Parser.init() is one-time. Cache it across calls.
let parserInitPromise: Promise<void> | undefined;
async function initParserOnce() {
  if (!parserInitPromise) {
    parserInitPromise = Parser.init({
      // In v0.22 the bundled WASM really is called tree-sitter.wasm; point
      // emscripten at the absolute path so Node's loader doesn't miss it
      // (the default search paths don't include the npm install dir).
      locateFile() {
        return path.resolve(
          HERE,
          "..",
          "node_modules",
          "web-tree-sitter",
          "tree-sitter.wasm",
        );
      },
    });
  }
  await parserInitPromise;
}

// Load each language's Query at most once per process. Reusing cuts the
// second-repo-indexing cost materially (Query compile is the dominant
// per-call work once parsing is warm).
type LoadedLang = { lang: string; language: Language; query: Query; cfg: LangConfig };
const langCache = new Map<string, Promise<LoadedLang>>();
function loadLang(cfg: LangConfig): Promise<LoadedLang> {
  const cached = langCache.get(cfg.lang);
  if (cached) return cached;
  const p = (async () => {
    const language = await Parser.Language.load(wasmPath(cfg.wasm));
    const query = language.query(cfg.query);
    return { lang: cfg.lang, language, query, cfg };
  })();
  langCache.set(cfg.lang, p);
  return p;
}

function pickLang(file: string): LangConfig | undefined {
  const ext = path.extname(file).toLowerCase();
  return LANGS.find((l) => l.exts.includes(ext));
}

async function listTrackedFiles(repoDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", repoDir, "ls-files"], {
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.split("\n").filter(Boolean);
}

async function parseFile(
  loaded: LoadedLang,
  repoDir: string,
  relPath: string,
): Promise<Symbol[]> {
  const abs = path.join(repoDir, relPath);
  let buf: Buffer;
  try {
    const s = await stat(abs);
    if (!s.isFile() || s.size > MAX_FILE_BYTES) return [];
    buf = await readFile(abs);
  } catch {
    return [];
  }
  const source = buf.toString("utf8");

  const parser = new Parser();
  parser.setLanguage(loaded.language);
  const tree = parser.parse(source);
  if (!tree) return [];

  // Match strategy: walk each match and pair `@name` (inner identifier)
  // with the outer `@kind.<kind>` capture. Matches in tree-sitter land
  // can have multiple captures; we take the first name + first kind.
  const out: Symbol[] = [];
  try {
    const matches = loaded.query.matches(tree.rootNode);
    for (const m of matches) {
      let name: string | undefined;
      let kind = "symbol";
      for (const c of m.captures) {
        if (c.name === "name") {
          name = c.node.text;
        } else if (c.name.startsWith("kind.")) {
          kind = c.name.slice("kind.".length);
        }
      }
      if (!name) continue;
      const nameCap = m.captures.find((c) => c.name === "name")!;
      out.push({
        name,
        kind,
        lang: loaded.lang,
        file: relPath.replaceAll("\\", "/"),
        line: nameCap.node.startPosition.row + 1,
        col: nameCap.node.startPosition.column + 1,
      });
    }
  } finally {
    tree.delete();
  }
  return out;
}

async function loadCachedIndex(repoDir: string): Promise<Index | undefined> {
  try {
    const raw = await readFile(path.join(repoDir, INDEX_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as { builtAt: number; fileCount: number; symbols: Symbol[] };
    return makeIndex(parsed.symbols, parsed.builtAt, parsed.fileCount);
  } catch {
    return undefined;
  }
}

function makeIndex(symbols: Symbol[], builtAt: number, fileCount: number): Index {
  const byName = new Map<string, Symbol[]>();
  for (const s of symbols) {
    const bucket = byName.get(s.name);
    if (bucket) bucket.push(s);
    else byName.set(s.name, [s]);
  }
  return { builtAt, fileCount, symbols, byName };
}

async function saveIndex(repoDir: string, index: Index): Promise<void> {
  const body = JSON.stringify({
    builtAt: index.builtAt,
    fileCount: index.fileCount,
    symbols: index.symbols,
  });
  await writeFile(path.join(repoDir, INDEX_FILENAME), body);
}

// Per-repo in-memory cache + an inflight-lock so two concurrent tool calls
// don't both rebuild.
const repoIndexCache = new Map<string, Promise<Index>>();

export async function getIndex(repoDir: string): Promise<Index> {
  const cached = repoIndexCache.get(repoDir);
  if (cached) return cached;

  const job = (async () => {
    const onDisk = await loadCachedIndex(repoDir);
    if (onDisk) return onDisk;

    await initParserOnce();
    const files = await listTrackedFiles(repoDir);

    // Bucket files by language so we only pay the per-language load once
    // (query compile + WASM fetch), then stream through each bucket.
    const byLang = new Map<string, string[]>();
    for (const f of files) {
      const cfg = pickLang(f);
      if (!cfg) continue;
      const arr = byLang.get(cfg.lang);
      if (arr) arr.push(f);
      else byLang.set(cfg.lang, [f]);
    }

    const symbols: Symbol[] = [];
    let touched = 0;
    for (const cfg of LANGS) {
      const files = byLang.get(cfg.lang);
      if (!files || files.length === 0) continue;
      let loaded: LoadedLang;
      try {
        loaded = await loadLang(cfg);
      } catch (e) {
        // A missing WASM or an incompatible grammar: skip the language,
        // don't poison the whole index. find_definition falls back to grep
        // for this file set.
        const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : JSON.stringify(e);
        process.stderr.write(`indexer: could not load ${cfg.lang}: ${err}\n`);
        continue;
      }
      for (const f of files) {
        try {
          const fileSyms = await parseFile(loaded, repoDir, f);
          symbols.push(...fileSyms);
        } catch (e) {
          process.stderr.write(
            `indexer: parse failure on ${f}: ${e instanceof Error ? e.message : String(e)}\n`,
          );
        }
        touched++;
      }
    }

    const index = makeIndex(symbols, Date.now(), touched);
    // Best-effort save; a write failure shouldn't break the tool call.
    saveIndex(repoDir, index).catch(() => {});
    return index;
  })();

  repoIndexCache.set(repoDir, job);
  try {
    return await job;
  } catch (e) {
    repoIndexCache.delete(repoDir);
    throw e;
  }
}

export function findByName(index: Index, name: string): Symbol[] {
  return index.byName.get(name) ?? [];
}
