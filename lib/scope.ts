// Scope classifier — given a scanned issue, predicts how wide the fix will
// reach through the codebase. Purely textual (no network): extracts file
// paths and symbol mentions from the title+body and buckets them.
//
// Buckets:
//   doc        — only doc/packaging paths mentioned (README, docs/, setup.py,
//                pyproject.toml, MANIFEST.in, LICENSE, *.md/*.rst/*.txt…)
//   leaf       — one source file mentioned and no sign of multi-file spread
//   cross-file — 2–5 source files mentioned, or one file + obvious callers
//   refactor   — >5 source files, or language in body like "rename/refactor
//                across", "every caller", "all usages"
//   unknown    — not enough signal to decide
//
// This is deliberately conservative; it's an *advisory* badge, not a hard
// gate. The pre-flight goal is to stop users clicking Dry-run on refactors
// where the 5-file pre-attach budget guarantees failure.
//
// Future: optional code-search refinement via gh api /search/code for
// uncertain cases. Skipped for v1 because it'd add latency/rate-limit cost
// to every scan.

export type ScopeBucket =
  | "doc"
  | "leaf"
  | "cross-file"
  | "refactor"
  // new-file: issue asks to CREATE a new artifact (schema, config, docs
  // file, types stub, etc.). Deterministic pre-attach is actively wrong
  // here — it anchors to a symbol in an existing file and ships the new
  // content wedged inside. Route these to deep solve so Claude can decide
  // where the new file belongs. Detected via title verb patterns, not
  // just the file-count heuristic.
  | "new-file"
  | "unknown";

export type ScopeInfo = {
  bucket: ScopeBucket;
  confidence: "low" | "medium" | "high";
  files: string[];      // distinct file paths mentioned
  symbols: string[];    // top symbol mentions
  reason: string;       // short human-readable explanation
};

const DOC_EXT = new Set([
  "md", "markdown", "rst", "txt", "adoc", "asciidoc",
]);

// Paths that are "doc / packaging / config" — fixes here typically touch a
// single file and don't cascade.
const DOC_OR_PACKAGING_PATH = [
  /(^|\/)readme(\.[a-z]+)?$/i,
  /(^|\/)changelog(\.[a-z]+)?$/i,
  /(^|\/)license(\.[a-z]+)?$/i,
  /(^|\/)contributing(\.[a-z]+)?$/i,
  /(^|\/)docs?\//i,
  /(^|\/)setup\.(py|cfg)$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)manifest\.in$/i,
  /(^|\/)package(-lock)?\.json$/i,
  /(^|\/)cargo\.toml$/i,
  /(^|\/)go\.mod$/i,
  /(^|\/)\.github\//i,
];

// Triggers that almost always indicate a repo-wide change.
const REFACTOR_PHRASES = [
  /\brefactor(ing)?\s+(across|through|the\s+entire)/i,
  /\brename(d|ing)?\s+.+\s+(across|everywhere|in all)/i,
  /\b(every|all)\s+(callers?|usages?|consumers?|subclass(es)?|references?)\b/i,
  /\bbreaking\s+change\b/i,
  /\bmigrate\s+.+\s+(codebase|project|everywhere)/i,
];

// Path-ish tokens: captures `foo/bar.py`, `src/lib.rs`, `a.b.c.ext` in
// backticks or bare. Extension list kept intentionally broad.
const PATH_EXTS =
  "py|pyi|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|scala|c|cc|cpp|cxx|h|hpp|cs|rb|php|swift|m|mm|sh|bash|zsh|fish|ps1|r|jl|lua|pl|pm|dart|ex|exs|erl|clj|cljs|hs|ml|nim|zig|toml|yaml|yml|json|xml|html|css|scss|sql|proto|md|markdown|rst|txt|cfg|ini|adoc";

const PATH_RE = new RegExp(
  String.raw`(?:^|[\s\`"'(\[<])` +
  String.raw`((?:[\w.\-]+\/)*[\w.\-]+\.(?:` + PATH_EXTS + String.raw`))` +
  String.raw`(?=[\s\`"')\]>.,;:!?]|$)`,
  "gi",
);

// Symbol-ish tokens worth bothering with: snake_case with underscore, or
// CamelCase, or a function call like `foo(` or `bar()`. Short all-lower
// tokens without either are noisy (every issue body says "the", "it", …).
const SYMBOL_RE = new RegExp(
  String.raw`\b([A-Z][A-Za-z0-9]{2,}[A-Za-z0-9_]*` +
  String.raw`|[a-z][a-z0-9]*_[a-z0-9_]+` +
  String.raw`|[a-zA-Z_][\w.]{2,}\s*\()`,
  "g",
);

const STOPWORDS = new Set([
  "error", "issue", "bug", "fix", "fixes", "add", "adds", "added", "update",
  "updates", "change", "changes", "remove", "removes", "support", "please",
  "thanks", "note", "example", "when", "which", "this", "that", "with",
  "from", "into", "should", "would", "could", "make", "makes", "trying",
  "tried", "also", "still", "using", "used", "failed", "fails", "failing",
  "warning", "warnings", "traceback", "return", "returns", "returned",
  "true", "false", "null", "none", "nan", "text", "call", "calls", "called",
  "run", "runs", "running", "test", "tests", "testing", "time", "times",
  "work", "works", "working", "type", "types", "line", "lines", "file",
  "files", "path", "paths", "name", "names", "value", "values", "key",
  "keys", "data", "case", "cases", "code", "function", "functions",
  "method", "methods", "class", "classes", "object", "objects", "thing",
  "result", "results", "input", "output", "i", "a", "an", "the",
]);

function extractPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1].trim();
    // Reject things like "2.0.1.py" (version-like) and files with no slash
    // *and* no directory-like prefix that are also stopwords.
    if (!/[A-Za-z]/.test(p)) continue;
    out.add(p);
  }
  return [...out];
}

function extractSymbols(text: string): string[] {
  const out = new Map<string, number>();
  for (const m of text.matchAll(SYMBOL_RE)) {
    let tok = m[1].replace(/\s*\($/, "").trim();
    if (tok.length < 3 || tok.length > 64) continue;
    const low = tok.toLowerCase();
    if (STOPWORDS.has(low)) continue;
    // Filter out obvious natural-language CamelCase like "The".
    if (/^[A-Z][a-z]+$/.test(tok) && tok.length < 6) continue;
    out.set(tok, (out.get(tok) ?? 0) + 1);
  }
  return [...out.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);
}

function isDocPath(p: string): boolean {
  const lower = p.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  if (DOC_EXT.has(ext)) return true;
  return DOC_OR_PACKAGING_PATH.some((re) => re.test(lower));
}

// New-file verb patterns. Matches "Create a JSON Schema for …",
// "Add .editorconfig", "Introduce a new types.d.ts", "Generate
// openapi.yaml", etc. Keyed on the title because the body often also
// describes the existing file that the new artifact is *about*, which
// makes body-side heuristics ambiguous.
//
// Deliberately conservative noun list — only things that are typically
// shipped as their own file. Tuning here should raise false-positive
// rather than false-negative risk, since the consequence of a
// false-positive (recommend deep solve) is just spending more on an
// issue we'd otherwise quick-solve.
// Quick note on the char class: using [^\n] (not [^.\n]) so filenames
// like `.editorconfig` and `openapi.yaml` don't block the lazy match. A
// period mid-title is fine; we just want to cap the distance so the verb
// and noun belong to the same sentence.
// Two branches:
//   (a) Keyword noun — "schema", "workflow", "helper", etc. — any of
//       the common "thing shipped as its own file" words.
//   (b) Filename-with-extension — e.g. "openapi.yaml", "types.d.ts",
//       "schema.json". A user asking to "Generate openapi.yaml" is
//       unambiguously asking for a new file at that path.
const NEW_FILE_RE =
  /^\s*(?:create|add|introduce|generate|define|provide|implement|build|make|write|produce)\b[^\n]{0,80}?(?:\b(?:schema|manifest|config(?:uration)?\s+file|spec(?:ification)?|template|file|script|module|package|stub|types?|typings?|declarations?|docs?|documentation|readme|changelog|license|guide|workflow|action|hook|plugin|extension|example|rule|ruleset|linter(?:\s+config)?|editorconfig|ci\s+config|pipeline|makefile|helper|utility|utils?|wrapper|adapter|binding|converter)\b|\b[\w.-]+\.(?:ya?ml|json|toml|ini|cfg|d\.ts|tsx?|jsx?|py|rb|go|rs|md|rst|sh|proto|dockerfile)\b)/i;

// Body phrases that back up a new-file ask, in case the title's only
// hint is "Create a X" without the noun list above catching it.
const NEW_FILE_BODY_RE =
  /\b(?:doesn'?t\s+(?:currently\s+)?exist|(?:is|are)\s+(?:currently\s+)?missing|add\s+a\s+new\s+file|create\s+a\s+new\s+file|new\s+file\s+(?:called|named))\b/i;

export function classifyScope(title: string, body: string): ScopeInfo {
  const text = `${title}\n${body}`;
  const files = extractPaths(text);
  const symbols = extractSymbols(text);

  // New-file short-circuit. Runs BEFORE refactor/doc/leaf heuristics
  // because "Create a JSON Schema for asv.conf.json" otherwise trips
  // the "1 source file mentioned → leaf" rule — the mentioned file is
  // the SUBJECT of the new artifact, not the edit target.
  if (NEW_FILE_RE.test(title) || NEW_FILE_BODY_RE.test(body)) {
    return {
      bucket: "new-file",
      confidence: "high",
      files,
      symbols,
      reason:
        "Issue asks to create a new file/artifact — deterministic pre-attach can't pick a target; deep solve recommended.",
    };
  }

  // Refactor short-circuit: explicit language in body.
  if (REFACTOR_PHRASES.some((re) => re.test(text))) {
    return {
      bucket: "refactor",
      confidence: "high",
      files,
      symbols,
      reason: "Body describes a codebase-wide change",
    };
  }

  // Doc short-circuit: every mentioned path is docs/packaging, AND no
  // code-shaped symbols (function calls) appear. If code symbols show up,
  // it's probably a source bug that *also* wants a README note.
  const hasCallSymbol = symbols.some((s) => s.endsWith(")") || /[a-z][A-Z]|_/.test(s));
  if (files.length > 0 && files.every(isDocPath) && !hasCallSymbol) {
    return {
      bucket: "doc",
      confidence: "high",
      files,
      symbols,
      reason: "Only doc/packaging paths mentioned",
    };
  }

  // Source files only (strip doc mentions for counting).
  const sourceFiles = files.filter((p) => !isDocPath(p));
  const nFiles = sourceFiles.length;

  if (nFiles === 0 && files.length === 0 && symbols.length === 0) {
    return {
      bucket: "unknown",
      confidence: "low",
      files,
      symbols,
      reason: "No files or symbols named in the issue",
    };
  }

  if (nFiles > 5) {
    return {
      bucket: "refactor",
      confidence: "high",
      files,
      symbols,
      reason: `${nFiles} source files referenced`,
    };
  }

  if (nFiles >= 2) {
    return {
      bucket: "cross-file",
      confidence: "medium",
      files,
      symbols,
      reason: `${nFiles} source files referenced`,
    };
  }

  if (nFiles === 1) {
    return {
      bucket: "leaf",
      confidence: "medium",
      files,
      symbols,
      reason: `Single source file: ${sourceFiles[0]}`,
    };
  }

  // No source files but we have symbols / doc-only files — likely leaf-ish
  // but we don't really know where.
  return {
    bucket: "unknown",
    confidence: "low",
    files,
    symbols,
    reason: symbols.length > 0
      ? `Symbols mentioned but no file path (${symbols.slice(0, 3).join(", ")})`
      : "No source files identified",
  };
}
