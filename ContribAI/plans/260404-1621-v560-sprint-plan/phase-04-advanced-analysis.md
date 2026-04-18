# Phase 4: Advanced Analysis

## Context
- [analysis/compressor.rs](../../crates/contribai-rs/src/analysis/compressor.rs) — 3-tier context compression
- [analysis/ast_intel.rs](../../crates/contribai-rs/src/analysis/ast_intel.rs) — tree-sitter AST parsing (13 langs)
- [analysis/repo_map.rs](../../crates/contribai-rs/src/analysis/repo_map.rs) — PageRank file ranking
- [generator/engine.rs](../../crates/contribai-rs/src/generator/engine.rs) — LLM code generation
- Original roadmap: v5.6.0 "Advanced Analysis" — semantic chunking, cross-file resolution, type-aware gen

## Overview
- **Priority:** P2
- **Effort:** 6h
- **Risk:** High — changes to core analysis affect all downstream quality
- **Status:** Pending
- **Blocked by:** Phase 3 (need merge rate baseline before changing analysis)

## Key Insights

**Current compression problem:** `compressor.rs` uses 3-tier compression (Full → Signatures → Summary). When files exceed the 30K token budget, it truncates. Truncation loses context mid-function, causing LLM to hallucinate missing code patterns.

**Cross-file resolution gap:** `ast_intel.rs` parses individual files but doesn't resolve imports across files. If `file_a.rs` imports `struct Foo` from `file_b.rs`, the analysis of `file_a.rs` doesn't know Foo's fields. This causes false positives (flagging usage that's actually correct given Foo's type).

**Type-aware generation opportunity:** `engine.rs` generates code fixes without type context. For typed languages (Rust, TypeScript, Go, Java), providing type signatures of referenced symbols would reduce syntax errors in generated code.

**Scope guard (YAGNI):** The original roadmap lists Code2Vec embeddings and multi-turn LLM conversations. These are premature — embeddings require a vector DB, multi-turn requires conversation state management. Skip both for v5.6.0.

## Requirements

### Functional
1. Semantic chunking: split files at function/class boundaries instead of byte offset
2. Cross-file import resolution: resolve top-level imports to provide type context
3. Type hints in generation prompts: inject type signatures of referenced symbols

### Non-Functional
- Chunking must not increase analysis time by more than 50% (currently ~2s per file)
- Import resolution limited to 1-hop (direct imports only, no transitive)
- Type hints capped at 2000 tokens per generation prompt (avoid context bloat)

## Architecture

### Change 1: Semantic Chunking

**Current:** `compressor.rs` splits by line count → mid-function truncation
**New:** Use tree-sitter AST to identify function/class/impl boundaries → split at boundaries

```
File (5000 lines)
  ├── fn process_repo() [lines 1-80]      → Chunk 1
  ├── fn analyze_findings() [lines 81-200] → Chunk 2
  ├── impl Pipeline { ... } [lines 201-500] → Chunk 3 (split at method boundaries if >budget)
  └── mod tests { ... } [lines 501-5000]   → Skip (test code, not analyzed)
```

**Data flow:**
1. `ast_intel.rs` already extracts function/class node ranges
2. New `semantic_chunker()` function in `compressor.rs` takes AST nodes + file content
3. Groups nodes into chunks that fit within token budget
4. Each chunk is a complete syntactic unit (no mid-function cuts)
5. Chunks include a "context header" (file imports + struct definitions) for coherence

**Key function:**
```rust
pub fn semantic_chunk(
    content: &str,
    ast_nodes: &[AstNode],
    max_tokens_per_chunk: usize,
) -> Vec<CodeChunk> {
    // 1. Sort nodes by line range
    // 2. Greedily pack nodes into chunks up to budget
    // 3. Prepend import/struct context header to each chunk
    // 4. Return chunks with source ranges
}
```

### Change 2: Cross-File Import Resolution

**Scope:** 1-hop resolution for 5 languages (Rust, Python, JS/TS, Go, Java)

**Data flow:**
1. `repo_map.rs` already builds import graph for PageRank
2. Extend to store resolved symbol types (function signatures, struct fields)
3. New `resolve_imports()` in `ast_intel.rs`:
   - Input: file's import statements + repo file map
   - Output: `HashMap<SymbolName, TypeSignature>`
   - Only resolves symbols from files already parsed in this analysis run
4. Feed resolved types into analysis context

**Token budget:** Type signatures capped at 500 tokens per file. If exceeded, keep only symbols actually referenced in the file being analyzed.

### Change 3: Type-Aware Generation Hints

**Data flow:**
1. After analysis, before generation: collect type signatures of symbols referenced in the finding's file
2. Inject as a "Type Context" section in the generation prompt:
   ```
   ## Type Context (referenced symbols)
   struct Config { pub max_retries: u32, pub timeout: Duration }
   fn process(input: &str) -> Result<Output>
   trait Handler: Send + Sync { fn handle(&self, req: Request) -> Response; }
   ```
3. Generator uses these types to produce syntactically correct fixes

**Integration point:** `generator/engine.rs` — modify the prompt construction to include type context when available.

## Related Code Files

| Action | File | Change |
|--------|------|--------|
| Modify | `analysis/compressor.rs` | Add `semantic_chunk()` function, refactor tier-1 to use it |
| Modify | `analysis/ast_intel.rs` | Add `resolve_imports()` + symbol type extraction |
| Modify | `analysis/repo_map.rs` | Extend import graph with resolved type signatures |
| Modify | `generator/engine.rs` | Add type context section to generation prompts |
| Modify | `analysis/analyzer.rs` | Wire semantic chunking + import resolution into analysis pipeline |

## Implementation Steps

### Step 1: Semantic chunking in compressor.rs
1. Read current `compress()` function to understand tier-1 behavior
2. Add `semantic_chunk()` function that takes AST nodes + content
3. Implement greedy bin-packing: sort nodes by line, accumulate until budget exceeded, start new chunk
4. Add context header (imports + type defs) prepended to each chunk
5. Replace tier-1 truncation with semantic chunking when AST is available
6. Fallback to byte-offset truncation if no AST (non-parsed languages)

### Step 2: Import resolution in ast_intel.rs
1. Read current `parse_file()` to understand AST node extraction
2. Add `extract_imports()` — returns list of imported symbols with source paths
3. Add `resolve_symbol_type()` — given symbol name + source file, extract its type signature via AST
4. Add `resolve_imports()` — orchestrates: extract imports → for each → resolve type → return map
5. Limit: 1-hop only, skip unresolvable imports, cap at 20 symbols per file

### Step 3: Wire import resolution into analyzer
1. In `analyzer.rs`, after file parsing, call `resolve_imports()` for the file
2. Pass resolved types as additional context to analysis strategies
3. Strategies can use type info to reduce false positives (e.g., "this null check is fine because the type is Option<T>")

### Step 4: Type-aware generation hints
1. In `engine.rs`, modify prompt construction
2. If type context available for the finding's file, add "Type Context" section
3. Cap at 2000 tokens — if more, keep only symbols referenced in the finding's line range
4. Measure: compare generated code quality with/without type hints on 5 sample findings

### Step 5: Tests
- Unit test `semantic_chunk()` with sample Rust/Python files
- Unit test `resolve_imports()` with mock file map
- Integration test: full analysis pipeline with type resolution enabled
- Regression test: ensure existing merged-PR patterns still generate correctly

## Todo List

- [ ] Implement `semantic_chunk()` in compressor.rs
- [ ] Add context header generation (imports + type defs per chunk)
- [ ] Fallback to byte-offset truncation for non-AST languages
- [ ] Implement `extract_imports()` for 5 languages in ast_intel.rs
- [ ] Implement `resolve_symbol_type()` in ast_intel.rs
- [ ] Wire import resolution into analyzer.rs
- [ ] Add type context section to generator prompts in engine.rs
- [ ] Cap type context at 2000 tokens
- [ ] Write unit tests for semantic chunking (3+ tests)
- [ ] Write unit tests for import resolution (3+ tests)
- [ ] Integration test: pipeline with type-aware generation
- [ ] Regression test: existing merged-PR patterns still work
- [ ] Run full test suite — `cargo test`
- [ ] Run `cargo clippy` — zero warnings

## Success Criteria

- Semantic chunking produces zero mid-function truncations on a sample of 20 files
- Import resolution resolves >50% of direct imports for Rust/Python/JS files
- Type hints present in >70% of generation prompts for typed languages
- No regression in existing unit tests
- Analysis time increase <50% (measured on 5 sample repos)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Semantic chunking produces too many small chunks | Medium | Medium | Set minimum chunk size (500 tokens); merge small adjacent chunks |
| Import resolution slow on large repos | Medium | Medium | Cap at 20 symbols, 1-hop only, skip files >1000 lines |
| Type hints confuse LLM (too much context) | Low | High | A/B test with 5 samples before enabling globally; make configurable |
| AST parsing fails for edge-case syntax | Medium | Low | Graceful fallback to byte truncation; log warning |
| Cross-file resolution returns stale data | Low | Low | Resolution runs per-analysis (fresh parse), not cached |

## Security Considerations
- Import resolution must not follow symlinks outside repo root
- Type signatures are code metadata only — no secret exposure risk

## Deferred (YAGNI for v5.6.0)
- Code2Vec embeddings — requires vector DB infrastructure, premature
- Multi-turn LLM conversations — requires conversation state management, complex
- Enhanced tree-sitter cross-file reference resolution beyond 1-hop — diminishing returns
