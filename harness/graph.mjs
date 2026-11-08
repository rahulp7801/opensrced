// A code graph from a local checkout, in lib/graph.ts's GraphData shape, so
// the lesson steps on the server (s1's main parts, s3's most-imported
// libraries, s7's distance to the fix) read it like the site's graphify graph.
//
// Nodes: one per source file, one per function or class defined in it, one
// per external package. Links: file -contains-> definition, file -imports->
// file or package. Python and JavaScript/TypeScript imports are resolved;
// other languages get files and definitions only.
// ponytail: regexes, not parsers; good enough to find modules and imports,
// swap in tree-sitter if a lesson ever needs call edges.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

export const MAX_FILES = 4_000;
export const MAX_FILE_BYTES = 300_000;
const MAX_DEFS_PER_FILE = 200;

const PY = /\.py$/;
const JS = /\.(?:[cm]?jsx?|tsx?)$/;
const OTHER = /\.(?:go|rs|java|kt|rb|php|cs|swift|scala|c|cc|cpp|h|hpp)$/;
const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// Common standard-library modules: imported everywhere, never "a library the project leans on".
const PY_STDLIB = new Set(("abc argparse ast asyncio base64 bisect builtins calendar collections concurrent contextlib copy csv dataclasses datetime decimal difflib "
  + "enum errno functools gc getpass glob gzip hashlib heapq hmac html http importlib inspect io ipaddress itertools json keyword logging math mimetypes "
  + "multiprocessing numbers operator os pathlib pickle platform pprint queue random re shlex shutil signal socket sqlite3 ssl stat statistics string "
  + "struct subprocess sys tempfile textwrap threading time timeit tokenize traceback types typing unicodedata unittest urllib uuid warnings weakref "
  + "xml zipfile zlib __future__ typing_extensions").split(" "));
const NODE_BUILTINS = new Set("assert buffer child_process cluster crypto dgram dns events fs http http2 https module net os path perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib".split(" "));

const DEF_PATTERNS = {
  py: /^[ \t]*(?:async[ \t]+)?(?:def|class)[ \t]+([A-Za-z_]\w*)/gm,
  js: /^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?(?:function\*?[ \t]+([A-Za-z_$][\w$]*)|class[ \t]+([A-Za-z_$][\w$]*)|(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*(?:async[ \t]*)?(?:function|\([^)]*\)[ \t]*=>|[A-Za-z_$][\w$]*[ \t]*=>))/gm,
  other: /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:func|fn|def|class|struct|interface|enum|trait)[ \t]+(?:\([^)]*\)[ \t]*)?([A-Za-z_]\w*)/gm,
};

/** The group a file belongs to: its first two folders when it is that deep
 *  (earthpy/tests apart from earthpy), else its folder. Pure. */
export function groupOf(path) {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** The definitions in one file's text, with their line numbers. Pure. */
export function definitionsIn(path, text) {
  const re = PY.test(path) ? DEF_PATTERNS.py : JS.test(path) ? DEF_PATTERNS.js : DEF_PATTERNS.other;
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(re)) {
    const name = m.slice(1).find(Boolean);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, line: text.slice(0, m.index).split("\n").length });
    if (out.length >= MAX_DEFS_PER_FILE) break;
  }
  return out;
}

/** The module specifiers a file imports. Pure. */
export function importsIn(path, text) {
  if (PY.test(path)) {
    const out = [];
    for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)/gm)) for (const part of m[1].split(",")) out.push(part.trim().split(/\s+/)[0]);
    for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+\(?([\w, \t*]+)/gm)) {
      // "from . import x" names submodules; "from a import b" may too.
      const names = m[2].split(",").map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && s !== "*");
      out.push(m[1], ...names.map((n) => (m[1].endsWith(".") ? m[1] + n : `${m[1]}.${n}`)));
    }
    return out.filter(Boolean);
  }
  if (JS.test(path)) {
    const out = [];
    for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\b[^'"`;]*?from[ \t]*['"]([^'"]+)['"]|(?:^|[\s;])import[ \t]*['"]([^'"]+)['"]|\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      out.push(m[1] ?? m[2] ?? m[3]);
    }
    return out;
  }
  return [];
}

/** A package name from an import: "pandas.core" → "pandas", "@scope/pkg/x" → "@scope/pkg". Null for builtins. Pure. */
export function externalPackage(path, spec) {
  if (PY.test(path)) {
    const top = spec.replace(/^\.+/, "").split(".")[0];
    return top && !PY_STDLIB.has(top) ? top : null;
  }
  if (spec.startsWith("node:")) return null;
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  return NODE_BUILTINS.has(name) ? null : name;
}

/** Python module name → file, for every .py file (with and without a src/ prefix). */
function pythonModules(files) {
  const modules = new Map();
  for (const f of files.filter((p) => PY.test(p))) {
    const mod = f.replace(/\.py$/, "").replace(/\/__init__$/, "").split("/").join(".");
    modules.set(mod, f);
    if (mod.startsWith("src.")) modules.set(mod.slice(4), f);
  }
  return modules;
}

/** The repository file an import points at, or null for a package. Pure. */
export function resolveImport(from, spec, files, pyModules) {
  if (PY.test(from)) {
    let mod = spec;
    if (spec.startsWith(".")) {
      const dots = spec.match(/^\.+/)[0].length;
      const pkg = from.split("/").slice(0, -1);
      const base = pkg.slice(0, pkg.length - (dots - 1));
      mod = [...base, ...spec.slice(dots).split(".").filter(Boolean)].join(".");
    }
    // Longest prefix that is a module: "app.fill.fill" → app/fill.py.
    const parts = mod.split(".");
    for (let i = parts.length; i > 0; i--) {
      const hit = pyModules.get(parts.slice(0, i).join("."));
      if (hit) return hit;
    }
    return null;
  }
  if (JS.test(from)) {
    let base = null;
    if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
    else if (spec.startsWith("@/") || spec.startsWith("~/")) base = spec.slice(2);
    if (base === null) return null;
    const candidates = [base, ...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => `${base}/index${e}`), base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx")];
    for (const root of ["", "src/"]) for (const c of candidates) if (files.has(root + c)) return root + c;
  }
  return null;
}

const link = (source, target, relation, file) => ({ source, target, relation, confidence: "EXTRACTED", confidence_score: 1, source_file: file });

/** The graph of `dir`'s tracked source files. Throws when `dir` isn't a git checkout. */
export function buildGraph(dir) {
  const listed = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const sources = listed.filter((p) => PY.test(p) || JS.test(p) || OTHER.test(p)).filter((p) => !/(^|\/)(node_modules|vendor|dist|build|\.git)\//.test(p) && !/\.min\.js$/.test(p)).slice(0, MAX_FILES);
  const fileSet = new Set(sources);
  const pyModules = pythonModules(sources);
  const groups = new Map();
  const community = (key) => { if (!groups.has(key)) groups.set(key, groups.size); return groups.get(key); };
  const nodes = [];
  const links = [];
  const external = new Map();
  for (const file of sources) {
    let text;
    try {
      if (statSync(join(dir, file)).size > MAX_FILE_BYTES) continue;
      text = readFileSync(join(dir, file), "utf8");
    } catch { continue; } // deleted or unreadable since ls-files: skip it
    const c = community(groupOf(file));
    nodes.push({ id: file, label: posix.basename(file), community: c, file_type: "code", source_file: file });
    for (const d of definitionsIn(file, text)) {
      nodes.push({ id: `${file}::${d.name}`, label: d.name, community: c, file_type: "code", source_file: file, source_location: `L${d.line}` });
      links.push(link(file, `${file}::${d.name}`, "contains", file));
    }
    const targets = new Set();
    for (const spec of importsIn(file, text)) {
      const hit = resolveImport(file, spec, fileSet, pyModules);
      if (hit && hit !== file) { targets.add(hit); continue; }
      if (hit) continue;
      // A relative import that didn't resolve is still inside the repository, not a package.
      if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~/")) continue;
      const pkg = externalPackage(file, spec);
      if (!pkg) continue;
      if (!external.has(pkg)) external.set(pkg, `ext:${pkg}`);
      targets.add(external.get(pkg));
    }
    for (const t of targets) links.push(link(file, t, "imports", file));
  }
  // One group per package: lumped together, the packages would outnumber any
  // real part of the project in s1's "main parts".
  for (const [pkg, id] of external) nodes.push({ id, label: pkg, community: community(`(package) ${pkg}`), file_type: "external", source_file: "" });
  // Imports of files that were skipped (too large) point nowhere: drop them.
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, links: links.filter((l) => ids.has(l.target)) };
}

/** What the lesson view draws: one box per group with its files, and how
 *  many imports run between groups. Small enough to send to the view, never
 *  to the model. Pure. */
export function graphSummary(graph, highlight = {}) {
  const names = new Map();
  for (const n of graph.nodes) if (!names.has(n.community) && n.file_type !== "external") names.set(n.community, groupOf(n.source_file || n.id));
  const files = graph.nodes.filter((n) => n.file_type !== "external" && !n.id.includes("::"));
  const degree = new Map();
  for (const l of graph.links) if (l.relation === "imports") for (const id of [l.source, l.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const modules = [...names.entries()].map(([id, name]) => {
    const own = files.filter((f) => f.community === id).sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    return { id, name, size: own.length, files: own.slice(0, 40).map((f) => f.id) };
  }).filter((m) => m.size > 0).sort((a, b) => b.size - a.size).slice(0, 40);
  const shown = new Set(modules.map((m) => m.id));
  const groupOfNode = new Map(graph.nodes.map((n) => [n.id, n.community]));
  const weights = new Map();
  for (const l of graph.links) {
    if (l.relation !== "imports") continue;
    const a = groupOfNode.get(l.source), b = groupOfNode.get(l.target);
    if (a === b || !shown.has(a) || !shown.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }
  const edges = [...weights.entries()].map(([key, weight]) => { const [a, b] = key.split("|").map(Number); return { a, b, weight }; });
  const packages = [...degree.entries()].filter(([id]) => id.startsWith("ext:")).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, n]) => ({ name: id.slice(4), imports: n }));
  return { modules, edges, packages, files: files.length, highlight };
}
