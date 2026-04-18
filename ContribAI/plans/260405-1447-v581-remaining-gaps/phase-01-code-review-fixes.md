# Phase 1: Code Review Fixes (M-1, M-2, M-3)

## Priority: Medium | Status: Pending | Effort: 1.5h

Three independent fixes from code review. No cross-dependencies.

## Context Links
- [pipeline.rs](../../crates/contribai-rs/src/orchestrator/pipeline.rs) — cross-file wiring (L1034-1061)
- [ast_intel.rs](../../crates/contribai-rs/src/analysis/ast_intel.rs) — walk_import_nodes (L360-528)
- [models.rs](../../crates/contribai-rs/src/core/models.rs) — RepoContext (L393-411)
- [engine.rs](../../crates/contribai-rs/src/generator/engine.rs) — symbol_map consumption (L250-270)
- [pipeline_integration.rs](../../crates/contribai-rs/tests/pipeline_integration.rs) — existing tests

---

## M-1: Separate `_cross_file_` keys from symbol_map

### Problem
`_cross_file_{path}` synthetic keys in `symbol_map` pollute LLM prompts. The engine iterates `symbol_map.values().flatten()` (engine.rs:252) and these synthetic entries mix with real symbols.

### Solution
Add a dedicated `resolved_imports` field to `RepoContext`.

### Files to Modify
- `crates/contribai-rs/src/core/models.rs` — add field to `RepoContext`
- `crates/contribai-rs/src/orchestrator/pipeline.rs` — write to new field instead of symbol_map
- `crates/contribai-rs/src/generator/engine.rs` — read from new field for cross-file context

### Implementation Steps

1. **models.rs** — Add field to `RepoContext` (after `symbol_map` at L408):
   ```rust
   /// Resolved cross-file import symbols (import resolution results).
   /// Kept separate from symbol_map to avoid polluting LLM symbol context.
   #[serde(default)]
   pub resolved_imports: HashMap<String, Vec<Symbol>>,
   ```

2. **pipeline.rs** (L1034-1061) — Change `_cross_file_` wiring to use `resolved_imports`:
   - Declare `let mut resolved_imports: HashMap<String, Vec<Symbol>> = HashMap::new();` before the loop
   - Replace `symbol_map.entry(format!("_cross_file_{}",…))` with `resolved_imports.entry(file_path.clone())`
   - Pass `resolved_imports` to `RepoContext` constructor (L1063-1080)

3. **engine.rs** (L250) — Add a separate block that reads `context.resolved_imports` for cross-file type info:
   - After the existing type_sigs block, add cross-file sigs from `resolved_imports.values().flatten()`
   - Prefix with "Cross-file resolved:" in the prompt section

### Success Criteria
- `cargo test` passes
- `symbol_map` no longer contains any `_cross_file_` keys
- Cross-file type info still appears in LLM prompts via `resolved_imports`

---

## M-2: Depth guard on `walk_import_nodes`

### Problem
`walk_import_nodes` in ast_intel.rs (L523-527) recurses unconditionally after processing import nodes. On deeply nested ASTs, this wastes CPU and risks stack overflow on pathological input.

### Solution
Add `depth: usize` parameter, cap at 8 levels.

### Files to Modify
- `crates/contribai-rs/src/analysis/ast_intel.rs`

### Implementation Steps

1. Change signature (L360):
   ```rust
   fn walk_import_nodes(
       node: tree_sitter::Node,
       source: &str,
       lang: Language,
       targets: &mut Vec<ImportTarget>,
       depth: usize,  // NEW
   )
   ```

2. Add guard at top of function body (after L366):
   ```rust
   if depth > 8 {
       return;
   }
   ```

3. Update recursive call (L526):
   ```rust
   Self::walk_import_nodes(child, source, lang, targets, depth + 1);
   ```

4. Update call site in `extract_import_targets` (L355):
   ```rust
   Self::walk_import_nodes(root, source, lang, &mut targets, 0);
   ```

### Success Criteria
- `cargo test ast_intel` passes
- Existing import extraction tests still green

---

## M-3: Integration test for `process_repo` symbol map wiring

### Problem
No integration test verifies that `process_repo` correctly wires AST symbols into the `RepoContext` that reaches the generator.

### Solution
Add test in `pipeline_integration.rs` that constructs a pipeline with wiremock, feeds it a repo with Python files containing imports, and verifies symbol_map and resolved_imports are populated.

### Files to Modify
- `crates/contribai-rs/tests/pipeline_integration.rs`

### Implementation Steps

1. Add a new `#[tokio::test]` named `test_process_repo_symbol_map_wiring`
2. Use wiremock `MockServer::start()` to mock GitHub API responses:
   - `/repos/{owner}/{repo}` — repo metadata
   - `/repos/{owner}/{repo}/git/trees/{branch}?recursive=1` — file tree with 2 Python files
   - `/repos/{owner}/{repo}/contents/{path}` — file content with imports
   - `/repos/{owner}/{repo}/pulls` — empty array (no existing PRs)
3. Build `ContribPipeline` with mock LLM + in-memory Memory + wiremock GitHubClient
4. Call pipeline method that exercises process_repo logic
5. Assert: symbol extraction happened (check Memory or event bus for analysis events)

### Key Insight
Full `process_repo` calls the generator which calls LLM — mock LLM should return a valid contribution JSON. Alternatively, test the symbol-map-building portion in isolation by extracting it or testing via the analysis results stored in memory.

### Success Criteria
- Test passes with `cargo test test_process_repo_symbol_map_wiring`
- Validates that symbol_map is populated for Python files
- After M-1, also validates resolved_imports field

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| M-1: engine.rs prompt regression | Low | Medium | Existing scorer + generation tests catch prompt structure changes |
| M-2: import tests break | Low | Low | Only adds a param; existing depth < 8 in all test cases |
| M-3: wiremock complexity | Medium | Low | Reuse patterns from hunt_integration.rs `mock_github` module |

## Todo

- [ ] M-1: Add `resolved_imports` field to `RepoContext` in models.rs
- [ ] M-1: Update pipeline.rs cross-file wiring to use `resolved_imports`
- [ ] M-1: Update engine.rs to read from `resolved_imports`
- [ ] M-2: Add depth guard to `walk_import_nodes`
- [ ] M-3: Add `test_process_repo_symbol_map_wiring` integration test
- [ ] Run `cargo test` — all green
- [ ] Run `cargo clippy` — no new warnings
