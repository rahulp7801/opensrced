# Phase 4: Cross-File Import Resolution

## Context
- [analysis/ast_intel.rs](../../crates/contribai-rs/src/analysis/ast_intel.rs) — `extract_symbols()`, `count_imports()`, `symbols_summary()`
- [analysis/repo_map.rs](../../crates/contribai-rs/src/analysis/repo_map.rs) — PageRank import graph, already tracks edges
- [analysis/compressor.rs](../../crates/contribai-rs/src/analysis/compressor.rs) — semantic chunking added in v5.6.0
- [generator/engine.rs](../../crates/contribai-rs/src/generator/engine.rs) — type-aware hints added in v5.6.0
- Original plan: Phase 4 listed cross-file import resolution as P2

## Overview
- **Priority:** P2
- **Effort:** 3h
- **Risk:** High — touches core analysis, affects downstream generation quality
- **Status:** Completed (2026-04-05)
- **Progress:** 100%
- **Blocked by:** None

## Key Insights

**Current state:** `ast_intel.rs` extracts symbols per-file (functions, classes, imports, structs) but doesn't resolve what those imports refer to. `count_imports()` returns import names as strings — no type info.

**repo_map.rs already builds import graph:** PageRank uses `count_imports()` to build file→file edges. Extend this to also store the resolved symbol types at each edge.

**1-hop resolution only (YAGNI):** Resolve direct imports only. If `file_a.py` imports `Foo` from `file_b.py`, look up `Foo`'s type signature in `file_b.py`'s extracted symbols. Don't follow transitive imports.

**5-language scope:** Rust (`use`), Python (`import`/`from`), JS/TS (`import`), Go (`import`), Java (`import`). These are the same languages `ast_intel.rs` already parses with tree-sitter.

**Integration point:** Feed resolved types into `engine.rs` type context section (already exists from v5.6.0). Currently engine gets types from same-file symbols only — extend to include cross-file resolved types.

## Requirements

### Functional
1. `resolve_imports()` function in `ast_intel.rs` — given file's imports + repo file map, return `HashMap<String, String>` (symbol name → type signature)
2. Support 5 languages: Rust, Python, JS/TS, Go, Java
3. Feed resolved types into analyzer context and generator type hints
4. Cap at 20 symbols per file, 500 tokens total

### Non-Functional
- 1-hop only (direct imports)
- Resolution runs per-analysis (no caching across runs)
- Graceful degradation: if resolution fails for a symbol, skip it (don't error)
- Must not increase per-file analysis time by >50%

## Architecture

### Data Flow

```
File A (being analyzed)
  │
  ├─ extract_symbols() → imports: ["Foo from file_b", "bar from file_c"]
  │
  ├─ resolve_imports(imports, repo_files)
  │   ├─ Look up file_b in already-parsed files
  │   │   └─ Find symbol "Foo" → "struct Foo { x: i32, y: String }"
  │   ├─ Look up file_c in already-parsed files
  │   │   └─ Find symbol "bar" → "fn bar(input: &str) -> Result<Output>"
  │   └─ Return: {"Foo": "struct Foo { x: i32, y: String }", "bar": "fn bar(...)"}
  │
  └─ Inject into analysis context + generation type hints
```

### Import Pattern per Language

| Language | Import Pattern | Resolve To |
|----------|---------------|------------|
| Rust | `use crate::module::Symbol` | Find `Symbol` in `src/module.rs` or `src/module/mod.rs` |
| Python | `from module import Symbol` | Find `Symbol` in `module.py` or `module/__init__.py` |
| JS/TS | `import { Symbol } from './module'` | Find `Symbol` in `module.ts/js/tsx/jsx` |
| Go | `import "pkg/module"` | Find exported symbols in `module/*.go` |
| Java | `import com.pkg.Symbol` | Find `Symbol` in matching package path |

### Key Functions

```rust
// In ast_intel.rs

/// Parse import statements and extract (symbol_name, source_module) pairs.
pub fn extract_import_targets(source: &str, file_path: &str) -> Vec<ImportTarget> { ... }

/// Resolve imported symbols against a map of already-parsed files.
/// Returns symbol_name → type_signature pairs.
pub fn resolve_imports(
    imports: &[ImportTarget],
    parsed_files: &HashMap<String, Vec<Symbol>>,
) -> HashMap<String, String> { ... }

pub struct ImportTarget {
    pub symbol_name: String,
    pub source_path: String,  // relative module path
}
```

## Related Code Files

| Action | File | Change |
|--------|------|--------|
| Modify | `analysis/ast_intel.rs` | Add `extract_import_targets()`, `resolve_imports()`, `ImportTarget` struct |
| Modify | `analysis/analyzer.rs` | Wire resolution into analysis pipeline — pass parsed_files map |
| Modify | `generator/engine.rs` | Extend type context to include cross-file resolved types |
| Read | `analysis/repo_map.rs` | Understand import graph structure for reuse |

## Implementation Steps

### Step 1: Add ImportTarget struct and extract_import_targets()
In `ast_intel.rs`:
- Define `ImportTarget { symbol_name, source_path }`
- Implement `extract_import_targets()` using tree-sitter AST
- For each language, match the import node types:
  - Rust: `use_declaration` → extract path segments
  - Python: `import_from_statement` → extract module + names
  - JS/TS: `import_statement` → extract specifiers + source
  - Go: `import_spec` → extract path
  - Java: `import_declaration` → extract qualified name
- Return `Vec<ImportTarget>`

### Step 2: Implement resolve_imports()
In `ast_intel.rs`:
- Takes `&[ImportTarget]` + `&HashMap<String, Vec<Symbol>>` (file_path → symbols)
- For each ImportTarget:
  - Map `source_path` to actual file path (handle `./`, `../`, `crate::`, etc.)
  - Look up file in parsed_files map
  - Find symbol by name in that file's symbol list
  - Extract type signature using `symbol.signature` or reconstruct from AST
- Cap at 20 resolved symbols per file
- Return `HashMap<String, String>` (name → signature)

### Step 3: Wire into analyzer
In `analyzer.rs`:
- After parsing all files in a repo, build `parsed_files` map
- For each file being analyzed, call `resolve_imports()`
- Pass resolved types as additional context to analysis strategies
- Add to the `AnalysisContext` struct (or equivalent)

### Step 4: Extend generator type hints
In `engine.rs`:
- Current type context comes from same-file symbols
- Merge cross-file resolved types into the "Type Context" section
- Apply 500-token cap on cross-file types (same-file types keep separate budget)
- Prefer symbols actually referenced in the finding's line range

### Step 5: Tests
- Unit test `extract_import_targets()` for each language (5 tests)
- Unit test `resolve_imports()` with mock parsed_files (3 tests)
- Verify existing unit tests still pass

## Todo List

- [x] Define `ImportTarget` struct in ast_intel.rs
- [x] Implement `extract_import_targets()` for Rust
- [x] Implement `extract_import_targets()` for Python
- [x] Implement `extract_import_targets()` for JS/TS
- [x] Implement `extract_import_targets()` for Go
- [x] Implement `extract_import_targets()` for Java
- [x] Implement `resolve_imports()` with parsed_files lookup
- [x] Wire into analyzer.rs analysis pipeline
- [x] Extend engine.rs type context with cross-file types
- [x] Unit tests for extract_import_targets (5 languages)
- [x] Unit tests for resolve_imports
- [x] Run `cargo test` — no regressions
- [x] Run `cargo clippy` — zero warnings

## Success Criteria

- `extract_import_targets()` correctly parses imports for 5 languages
- `resolve_imports()` resolves >50% of direct imports in sample files
- Cross-file types appear in generator prompts when available
- No regression in existing tests
- Per-file analysis time increase <50%

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tree-sitter node types differ across grammar versions | Medium | Medium | Test with actual grammar versions in Cargo.toml |
| Module path → file path mapping complex (Python packages, Rust mod.rs) | High | Medium | Start with simple 1:1 mapping, handle common patterns only |
| Resolved types too verbose (full struct definitions) | Low | Low | Truncate signatures to first line (declaration only) |
| analyzer.rs doesn't have parsed_files map readily available | Medium | Medium | Check if files are parsed once globally or per-file; may need to accumulate |
| Performance impact on large repos (>100 files) | Medium | Medium | Only resolve for files in the finding set, not all repo files |

## Security Considerations
- Import resolution must not follow symlinks outside repo root
- Don't resolve imports pointing to node_modules, .venv, or vendor dirs
