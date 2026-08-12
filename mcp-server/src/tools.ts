// Tool implementations. Each takes parsed args + the cached repo dir and
// returns a text payload. Tools are kept small and shell out to git/grep
// rather than parsing files themselves — git/grep on a shallow clone is
// fast enough and gives us language-agnostic coverage for free.
//
// Symbol lookup (find_definition / find_references) is the exception: it
// goes through the tree-sitter index in indexer.ts, which handles the
// cases a regex can't — multi-line signatures, decorators above the def,
// `const foo = () => …`, Rust `impl T { fn foo() }`, Go method receivers —
// and labels each hit with a kind. The regex path it replaced is gone.

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ensureRepo } from "./repo-cache.js";
import { findByName, getIndex } from "./indexer.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 60_000; // chars; Sonnet can handle more but we'd rather it call again than drown
const MAX_FILE_BYTES = 400_000;

function truncate(s: string, cap = MAX_OUTPUT): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap) + `\n\n[…truncated, ${s.length - cap} more chars]`;
}

function safeJoin(dir: string, rel: string): string {
  // Reject absolute paths and traversals; everything must stay inside the
  // cached clone. Belt-and-braces since git output is trusted but tool args
  // come from the model.
  if (path.isAbsolute(rel)) throw new Error(`path must be repo-relative: ${rel}`);
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(path.resolve(dir) + path.sep) && abs !== path.resolve(dir)) {
    throw new Error(`path escapes repo: ${rel}`);
  }
  return abs;
}

/** list_files — globby-ish via `git ls-files`. Respects .gitignore for free. */
export async function listFiles(args: { repo: string; glob?: string; limit?: number }) {
  const { dir } = await ensureRepo(args.repo);
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 2000);
  const gitArgs = ["-C", dir, "ls-files"];
  if (args.glob) gitArgs.push("--", args.glob);
  const { stdout } = await execFileAsync("git", gitArgs, { maxBuffer: 20 * 1024 * 1024 });
  const files = stdout.split("\n").filter(Boolean).slice(0, limit);
  return truncate(
    `# ${files.length} file(s)` +
      (args.glob ? ` matching ${args.glob}` : "") +
      `\n${files.join("\n")}`,
  );
}

/** read_file — returns line-numbered slice of a repo file. */
export async function readFileTool(args: {
  repo: string;
  path: string;
  line_start?: number;
  line_end?: number;
}) {
  const { dir } = await ensureRepo(args.repo);
  const abs = safeJoin(dir, args.path);
  const s = await stat(abs);
  if (!s.isFile()) throw new Error(`not a file: ${args.path}`);
  if (s.size > MAX_FILE_BYTES) {
    // Very large file + no range: refuse with a helpful hint instead of
    // silently truncating somewhere arbitrary. The model should narrow.
    if (!args.line_start) {
      return `# ${args.path} is ${s.size} bytes (> ${MAX_FILE_BYTES}). Call again with line_start/line_end.`;
    }
  }
  const text = await readFile(abs, "utf8");
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, args.line_start ?? 1);
  const end = Math.min(lines.length, args.line_end ?? lines.length);
  const slice = lines.slice(start - 1, end);
  const width = String(end).length;
  const numbered = slice
    .map((l, i) => `${String(start + i).padStart(width, " ")}│ ${l}`)
    .join("\n");
  return truncate(
    `# ${args.path} (lines ${start}-${end} of ${lines.length})\n${numbered}`,
  );
}

/** grep — ripgrep-over-git-grep. Returns file:line:match triples. */
export async function grepTool(args: {
  repo: string;
  pattern: string;
  glob?: string;
  case_insensitive?: boolean;
  max_matches?: number;
}) {
  const { dir } = await ensureRepo(args.repo);
  const max = Math.min(Math.max(args.max_matches ?? 200, 1), 1000);
  // git grep gives us .gitignore-aware search without a ripgrep dep. -n for
  // line numbers, -I to skip binaries, --no-color to keep output clean.
  const gitArgs = ["-C", dir, "grep", "-n", "-I", "--no-color"];
  if (args.case_insensitive) gitArgs.push("-i");
  gitArgs.push("-e", args.pattern);
  if (args.glob) gitArgs.push("--", args.glob);
  try {
    const { stdout } = await execFileAsync("git", gitArgs, {
      maxBuffer: 30 * 1024 * 1024,
    });
    const lines = stdout.split("\n").filter(Boolean).slice(0, max);
    return truncate(
      `# ${lines.length} match(es) for /${args.pattern}/\n${lines.join("\n")}`,
    );
  } catch (err: unknown) {
    // git grep exits 1 when nothing matched — not an error from our POV.
    const e = err as { code?: number; stdout?: string; stderr?: string };
    if (e.code === 1 && !e.stderr) {
      return `# 0 matches for /${args.pattern}/${args.glob ? ` in ${args.glob}` : ""}`;
    }
    throw err;
  }
}

/** find_definition — tree-sitter index for supported languages, with a
 *  regex-over-git-grep fallback for everything else (C-family, Java,
 *  shell, etc.) and when indexing fails. The index catches things the
 *  regex misses: multi-line signatures, decorators above the def, JS
 *  `const foo = () => …`, Rust impl-methods, Go receiver methods. */
export async function findDefinition(args: { repo: string; symbol: string }) {
  const { dir } = await ensureRepo(args.repo);
  const sym = args.symbol.trim();
  if (!/^[A-Za-z_][\w$.]*$/.test(sym)) {
    throw new Error(`symbol contains disallowed chars: ${sym}`);
  }

  // 1) tree-sitter AST index. Covers py/js/ts/tsx/rs/go with kind labels
  //    (function/class/method/struct/…). Exact name match, structurally
  //    correct, includes definitions the regex would miss.
  let indexHits: string[] = [];
  try {
    const index = await getIndex(dir);
    const syms = findByName(index, sym);
    indexHits = syms.map(
      (s) => `${s.file}:${s.line}:${s.col}  [${s.lang} ${s.kind}]`,
    );
  } catch (e) {
    process.stderr.write(
      `find_definition: index unavailable, falling back to grep: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  // 2) regex fallback via git grep. Still useful for C/C++/Java/shell or
  //    when the AST lookup returned nothing for a symbol that exists in a
  //    non-indexed language. Also acts as a safety net if a grammar
  //    misses a declaration form we didn't anticipate.
  // Regex uses PCRE constructs (\s, (?:…), \b) — git grep needs -P, not -E.
  // PCRE is compiled into Git-for-Windows by default; if an exotic build
  // lacks it we'll get a different error below and still return what the
  // index found.
  const kw =
    "(?:def|class|fn|func|function|struct|enum|trait|interface|type|const|let|var|pub\\s+(?:fn|struct|enum|trait|const|type)|impl)";
  const pattern = String.raw`^\s*(?:export\s+|pub\s+|async\s+|public\s+|private\s+|protected\s+|static\s+)*${kw}\s+${escapeRe(sym)}\b`;
  let grepHits: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dir, "grep", "-n", "-P", "-I", "--no-color", "-e", pattern],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    grepHits = stdout.split("\n").filter(Boolean);
  } catch (err: unknown) {
    const e = err as { code?: number; stderr?: string };
    // exit 1 + no stderr = "no matches", which is fine. Anything else and
    // we swallow the error when the AST index gave us hits; otherwise
    // re-throw so the caller sees the real failure.
    if (!(e.code === 1 && !e.stderr) && indexHits.length === 0) throw err;
  }

  // Dedupe grep hits against index hits by file:line. If a definition is
  // already in the index, skipping the regex version keeps the output
  // clean and leaves the kind label as the authoritative answer.
  const indexKeys = new Set<string>();
  for (const line of indexHits) {
    const m = /^([^:]+):(\d+):/.exec(line);
    if (m) indexKeys.add(`${m[1]}:${m[2]}`);
  }
  const extraGrep = grepHits.filter((h) => {
    const m = /^([^:]+):(\d+):/.exec(h);
    return m ? !indexKeys.has(`${m[1]}:${m[2]}`) : true;
  });

  if (indexHits.length === 0 && extraGrep.length === 0) {
    return `# No definition found for '${sym}'. Try grep with a broader pattern, or read_file on a suspected location.`;
  }

  const parts: string[] = [];
  if (indexHits.length > 0) {
    parts.push(
      `## AST-indexed definitions (${indexHits.length})\n${indexHits.slice(0, 50).join("\n")}`,
    );
  }
  if (extraGrep.length > 0) {
    parts.push(
      `## Regex-only matches (${extraGrep.length}, non-indexed languages or unusual forms)\n${extraGrep.slice(0, 30).join("\n")}`,
    );
  }
  return truncate(`# Definition sites for '${sym}'\n\n${parts.join("\n\n")}`);
}

/** find_references — every non-definition line mentioning the symbol. */
export async function findReferences(args: {
  repo: string;
  symbol: string;
  max_matches?: number;
}) {
  const { dir } = await ensureRepo(args.repo);
  const sym = args.symbol.trim();
  if (!/^[A-Za-z_][\w$.]*$/.test(sym)) {
    throw new Error(`symbol contains disallowed chars: ${sym}`);
  }
  const max = Math.min(Math.max(args.max_matches ?? 300, 1), 1500);
  const pattern = String.raw`\b${escapeRe(sym)}\b`;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dir, "grep", "-n", "-E", "-I", "--no-color", "-e", pattern],
      { maxBuffer: 40 * 1024 * 1024 },
    );
    const all = stdout.split("\n").filter(Boolean);
    const hits = all.slice(0, max);
    const byFile = new Map<string, number>();
    for (const h of all) {
      const file = h.split(":", 1)[0];
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
    const summary = [...byFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([f, n]) => `  ${n.toString().padStart(4, " ")}  ${f}`)
      .join("\n");
    return truncate(
      `# ${all.length} reference(s) to '${sym}' across ${byFile.size} file(s)\n\n` +
        `## Top files by reference count:\n${summary}\n\n` +
        `## Hits (first ${hits.length}):\n${hits.join("\n")}`,
    );
  } catch (err: unknown) {
    const e = err as { code?: number; stderr?: string };
    if (e.code === 1 && !e.stderr) {
      return `# 0 references to '${sym}'`;
    }
    throw err;
  }
}

/** repo_info — metadata + a shallow file-tree peek. */
export async function repoInfo(args: { repo: string }) {
  const { ref, dir } = await ensureRepo(args.repo);
  const { stdout: headSha } = await execFileAsync(
    "git",
    ["-C", dir, "rev-parse", "HEAD"],
    { maxBuffer: 1 * 1024 * 1024 },
  );
  const { stdout: headMsg } = await execFileAsync(
    "git",
    ["-C", dir, "log", "-1", "--pretty=%s"],
    { maxBuffer: 1 * 1024 * 1024 },
  );
  const { stdout: topFiles } = await execFileAsync("git", ["-C", dir, "ls-files"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const files = topFiles.split("\n").filter(Boolean);
  const topLevel = new Set<string>();
  for (const f of files) topLevel.add(f.split("/")[0]);
  return (
    `# ${ref.full}\n` +
    `HEAD: ${headSha.trim()}  (${headMsg.trim()})\n` +
    `Files: ${files.length}\n` +
    `Top-level entries: ${[...topLevel].sort().join(", ")}`
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
