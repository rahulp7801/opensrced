# Code Review: v5.7.1 Sprint — Mock Infrastructure, Integration Tests, Cross-File Import Resolution

**Reviewer:** code-reviewer | **Date:** 2026-04-05 | **Scope:** 7 deliverables across 10 files

---

## Scope

| Area | Files | LOC (approx) |
|------|-------|---------------|
| Mock GitHub infra | `tests/common/mock_github.rs` | 241 |
| Mock LLM | `tests/common/mock_llm.rs` | 79 |
| Patrol integration tests | `tests/patrol_integration.rs` | 270 |
| Hunt integration tests | `tests/hunt_integration.rs` | 211 |
| Cross-file import resolution | `src/analysis/ast_intel.rs` (new: L328-L637) | ~310 added |
| Pipeline wiring | `src/orchestrator/pipeline.rs` (L1027-L1064) | ~38 added |
| GitHubClient testability | `src/github/client.rs` (L27, L79-L81) | ~5 added |

**Total new/modified:** ~1,150 lines of Rust

---

## Overall Assessment

Solid sprint delivery. The cross-file import resolution is well-scoped (1-hop, capped at 20) and the integration test infrastructure using wiremock is a significant quality improvement. The code is generally idiomatic Rust. No secrets leaked, no `unsafe` blocks introduced.

However, I found **2 medium-priority bugs** and **3 design concerns** worth addressing before the next release.

---

## Critical Issues

None found.

---

## High Priority

### H-1. Python import target extraction produces duplicates

**File:** `ast_intel.rs` L370-L411

The Python `import_from_statement` handler has an AST-first pass that iterates children and pushes targets, followed by a text-based fallback at L399. The fallback guard checks:

```rust
if targets.is_empty() || !targets.iter().any(|t| t.source_path == module_path)
```

This guard scans ALL targets accumulated so far (including from *other* import statements processed in prior recursion), not just targets from the current node. On the first `import_from_statement`, the AST branch may successfully extract targets. On the second `import_from_statement` with a different `module_path`, the guard `!targets.iter().any(|t| t.source_path == module_path)` will be `true` (because no existing target has this new module_path), triggering the text fallback *even though* the AST branch already extracted symbols for that node.

**Impact:** Duplicate `ImportTarget` entries for multi-import Python files. Downstream `resolve_imports` may do redundant work but won't produce incorrect results since it uses a HashMap for output. Low production impact, but still a logic error.

**Fix:** Track targets length before the AST child walk and compare against it in the fallback guard:

```rust
let pre_len = targets.len();
// ... AST child walk ...
let targets_from_ast = targets.len() - pre_len;
if targets_from_ast == 0 {
    // fallback to text parsing
}
```

### H-2. `merged_at` null check in hunt merge-friendly filter is fragile

**File:** `pipeline.rs` L562-L569

```rust
p.get("merged_at")
    .and_then(|v| v.as_str())
    .map(|s| !s.is_empty())
    .unwrap_or(false)
```

GitHub API returns `"merged_at": null` for unmerged PRs. `serde_json::Value::Null.as_str()` returns `None`, so the entire chain resolves to `false` (correct for null). However, `"merged_at": "2026-04-01T12:00:00Z"` returns `Some("2026-04-01T12:00:00Z")` which is non-empty (correct for merged).

The test fixture `fake_pr_unmerged` uses `"merged_at": null` (JSON null), which correctly exercises this path. **The logic is functionally correct**, but the `.map(|s| !s.is_empty())` is a dead branch — GitHub will never return `"merged_at": ""` (empty string). This makes the code misleading.

**Recommendation:** Simplify to:

```rust
p.get("merged_at").and_then(|v| v.as_str()).is_some()
```

---

## Medium Priority

### M-1. Cross-file symbol map key uses synthetic prefix `_cross_file_`

**File:** `pipeline.rs` L1058-L1061

```rust
symbol_map
    .entry(format!("_cross_file_{}", file_path))
    .or_default()
    .extend(cross_symbols);
```

This inserts entries into `symbol_map` with keys like `_cross_file_src/lib.rs`, which are not real file paths. Downstream consumers iterate `symbol_map.values()` and filter by `SymbolKind` (see `engine.rs` L250-L268), so they will pick up these virtual entries. The name field `"{name} [resolved: {sig}]"` embeds metadata in the symbol name, which will appear in LLM prompts verbatim.

**Impact:** The LLM prompt includes noisy symbol names like `Config [resolved: Struct Config (src/core/config.rs:L10-L25)]`. This is technically functional but adds prompt clutter. The `line_start: 0, line_end: 0` sentinel values also show up in the summary.

**Recommendation:** Either:
1. Use a separate field on `RepoContext` (e.g., `resolved_imports: HashMap<String, String>`) to keep the type-resolution data clean, or
2. Filter out `_cross_file_` keys when building LLM prompts.

### M-2. `walk_import_nodes` recurses into children after already processing the import node

**File:** `ast_intel.rs` L506-L510

```rust
// Recurse into children
let mut cursor = node.walk();
for child in node.children(&mut cursor) {
    Self::walk_import_nodes(child, source, lang, targets);
}
```

This unconditional recursion means that after processing an `import_from_statement` at L373, the function also recurses into its children. For most AST structures, children of import nodes are not themselves import nodes, so no duplicates occur. However, for Go `import_declaration` nodes, the function already processes `import_spec_list` children explicitly at L470-L483, and then the recursion at L506-L510 will re-visit `import_spec_list` children. The inner `import_spec` nodes are NOT matched by the Go case (which only matches `import_declaration`), so no duplication actually occurs.

**Impact:** No bug currently, but fragile — a future language handler that matches child node kinds could produce duplicates. Consider adding early-return after processing known import nodes to make the intent explicit.

### M-3. No integration test coverage for cross-file import resolution in pipeline

The 9 integration tests cover patrol (5) and hunt (4) flows, which exercise the mock infrastructure well. However, no integration test exercises the pipeline's `process_repo` path through symbol extraction and cross-file resolution. The 8 unit tests in `ast_intel.rs` cover the import extraction and resolution functions in isolation. The gap is the **wiring** at `pipeline.rs` L1027-L1064.

**Recommendation:** Consider a targeted unit test or integration test that builds a `RepoContext` with known files and verifies the `symbol_map` contains both direct and `_cross_file_` entries after processing.

---

## Low Priority

### L-1. `with_base_url` is `pub` on production struct

**File:** `client.rs` L79

`with_base_url` is only used in tests but is public API. Consider gating it behind `#[cfg(test)]` or `#[cfg(feature = "testing")]` to prevent accidental misuse in production code that could redirect API calls.

### L-2. `MockLlm::route_response` keyword matching is order-dependent

**File:** `mock_llm.rs` L30-L47

If a prompt contains both "analyze" and "review", the first match ("analyze") wins. This works for current tests but is fragile. Not blocking since test prompts are controlled, but worth documenting the precedence.

### L-3. Inconsistent path construction in `fake_pr` vs `fake_pr_unmerged`

**File:** `mock_github.rs` L48 vs L62

`fake_pr` uses `format!("https://github.com/test/repo/pull/{}", number)` (hardcoded `test/repo`), while `fake_pr_unmerged` does the same. Neither accepts `owner/name` parameters for the URL. This means if a test ever needs to verify the URL, it will always show `test/repo` regardless of the repo being tested. Minor inconsistency, not currently exercised.

### L-4. `extract_name` fallback returns first line of node text as symbol name

**File:** `ast_intel.rs` L308-L315

For nodes without named children (e.g., some edge cases), the entire first line of the node text (up to 80 chars) becomes the symbol name. This could inject unexpectedly long strings into the symbol map and downstream LLM prompts. The 80-char limit mitigates this, but it's worth noting.

---

## Positive Observations

1. **Well-structured mock infrastructure** — `mock_github.rs` provides reusable fixture factories and wiremock registration helpers. Clean separation between data creation and server setup.

2. **Test design covers real-world scenarios** — Bot filtering, 404 auto-clean, dry-run behavior, conversation context injection, daily limits, merge-friendly filtering, TTL skip. These are production-relevant edge cases.

3. **Import resolution is properly bounded** — The 20-import cap and 1-hop limit prevent unbounded computation. The stdlib skip list is comprehensive.

4. **`with_base_url` builder pattern** — Clean approach to testability. Trailing-slash normalization at L80 prevents double-slash issues.

5. **AtomicU32 for rate limit tracking** — Correct use of atomics for thread-safe rate limit state without mutex overhead. `Ordering::Relaxed` is appropriate here since these are advisory counters.

6. **Memory::open_in_memory()** — Clean test isolation pattern, no filesystem side effects in tests.

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No leaked secrets | PASS | Test tokens are clearly fake (`"fake-token"`) |
| No unsafe blocks | PASS | No `unsafe` in any changed file |
| Input validation | PASS | Import resolution bounds inputs (cap 20, skip stdlib) |
| Auth not bypassed | PASS | `with_base_url` does not affect auth headers |
| No PII in logs | PASS | Tracing logs contain repo names and counts only |
| Injection risk | LOW RISK | Symbol names from AST are inserted into LLM prompts as-is (see M-1) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Integration tests | 9 (5 patrol + 4 hunt) |
| Unit tests | 8 (import extraction + resolution) |
| Languages covered by import resolution | 5 (Rust, Python, JS/TS, Go, Java) |
| Type coverage | Good (all new functions have explicit types) |
| Clippy compliance | Assumed (last commit was `cargo fmt --all`) |

---

## Recommended Actions

1. **[H-1]** Fix Python import duplicate guard — use local counter instead of global `targets` scan
2. **[H-2]** Simplify `merged_at` check — replace `.map(|s| !s.is_empty())` with `.is_some()`
3. **[M-1]** Clean up `_cross_file_` symbol map entries — either separate field or filter in prompt builder
4. **[M-3]** Add integration test for `process_repo` symbol map wiring
5. **[L-1]** Gate `with_base_url` behind test cfg

---

## Unresolved Questions

1. Is the `_cross_file_` prefix convention documented anywhere for future contributors?
2. Should resolved import symbols appear in quality scoring, or only in code generation prompts?
3. The Go import handler at L457-L484 processes both `import_spec` and `import_spec_list` children — is there a tree-sitter Go grammar version where `import_spec` appears as a direct child of `import_declaration` (not nested in `import_spec_list`)? If so, the current logic handles both; if not, the L458-L467 branch is dead code.
