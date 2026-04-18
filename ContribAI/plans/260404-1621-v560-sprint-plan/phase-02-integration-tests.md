# Phase 2: Integration Tests

## Context
- [orchestrator/pipeline.rs](../../crates/contribai-rs/src/orchestrator/pipeline.rs) — main pipeline: discover → analyze → generate → PR
- [pr/patrol.rs](../../crates/contribai-rs/src/pr/patrol.rs) — PR monitoring + CI monitor
- [orchestrator/memory.rs](../../crates/contribai-rs/src/orchestrator/memory.rs) — SQLite memory layer, 9 tables
- [docs/codebase-summary.md](../../docs/codebase-summary.md) — 355 unit tests, 0 integration tests
- Roadmap lists "Implement integration test suite" as High priority tech debt

## Overview
- **Priority:** P1
- **Effort:** 12h
- **Risk:** Medium — test infrastructure design affects all future testing
- **Status:** Pending
- **Blocked by:** Phase 1 (DB indexes change query performance characteristics)

## Key Insights

**Current test gap:** All 355 tests are co-located unit tests (`#[cfg(test)] mod tests`). No test exercises the flow across module boundaries (e.g., pipeline calling analyzer calling LLM).

**Test boundary problem:** Real integration tests would need GitHub API + LLM API access. This is expensive, slow, and flaky. The right approach: **mock at the network boundary** (HTTP), not at the Rust trait boundary.

**Practical scope:** Focus on testing internal integration (module-to-module wiring) with mock providers, not E2E against live APIs. Live API tests belong in a separate CI job behind a feature flag.

**Key integration paths to test:**
1. Pipeline: config → middleware chain → analyzer → generator → scorer → PR manager
2. Memory: full CRUD lifecycle across all 9 tables, TTL expiry, dream consolidation
3. Patrol: feedback collection → classification → response (with mock LLM)
4. CLI: command parsing → dispatch → pipeline invocation (already 12 CLI tests exist)

## Requirements

### Functional
1. Integration test module with mock LLM provider and mock GitHub client
2. Pipeline integration: verify discover → analyze → generate → score flow with mock data
3. Memory integration: verify full lifecycle (record → query → update → expire → dream)
4. Patrol integration: verify feedback → classify → respond flow
5. Hunt integration: verify multi-round logic with mock discovery
6. Tests run in CI alongside existing unit tests

### Non-Functional
- Tests must not require network access or API keys
- Tests must complete in <30s total (no real sleep/poll)
- Tests must be deterministic (no random, no time-dependent assertions)
- Mock providers reusable across test modules

## Architecture

### Test Module Structure

```
crates/contribai-rs/tests/          # Integration test directory (cargo convention)
├── common/
│   ├── mod.rs                      # Re-exports
│   ├── mock_llm.rs                 # MockLlmProvider implementing LlmProvider trait
│   └── mock_github.rs              # MockGitHubClient (or trait wrapper)
├── pipeline_integration.rs         # Pipeline flow tests
├── memory_integration.rs           # Memory lifecycle tests
├── patrol_integration.rs           # Patrol flow tests
└── hunt_integration.rs             # Hunt mode tests
```

### Mock Strategy

**LLM Mock:** Implement `LlmProvider` trait returning canned responses:
```rust
pub struct MockLlm {
    responses: Vec<String>,  // pop front on each call
}
#[async_trait]
impl LlmProvider for MockLlm {
    async fn complete(&self, prompt: &str, ...) -> Result<String> {
        // Return canned response based on prompt content keywords
    }
}
```

**GitHub Mock:** Harder — `GitHubClient` is a concrete struct, not a trait. Two options:
- **Option A:** Extract trait `GitHubApi` from `GitHubClient`, implement for mock. Requires refactor of ~15 call sites. High effort but clean.
- **Option B:** Use `MockGitHubClient` that wraps `GitHubClient` construction with a mock HTTP server (e.g., `wiremock` or `mockito`). No refactor needed.

**Recommended: Option B** — use `wiremock` crate for HTTP-level mocking. Zero refactor to prod code. Tests construct real `GitHubClient` pointing at mock server.

**Memory:** Use `Memory::open_in_memory()` — already exists, perfect for tests.

### Data Flow for Pipeline Integration Test

```
Test Setup:
  MockLlm (canned analysis + generation responses)
  wiremock MockServer (GitHub API responses)
  Memory::open_in_memory()
  EventBus::new()
  ContribAIConfig::default() with overrides

Test Flow:
  1. Configure mock server: GET /repos/owner/name → repo JSON
  2. Configure mock server: GET /repos/owner/name/contents → file tree
  3. Configure mock LLM: analysis prompt → canned findings JSON
  4. Configure mock LLM: generation prompt → canned code fix
  5. Call pipeline.run_targeted("owner", "name", dry_run=true)
  6. Assert: PipelineResult.repos_analyzed == 1
  7. Assert: PipelineResult.findings_total > 0
  8. Assert: Memory has recorded analysis
  9. Assert: EventBus emitted PipelineStart + PipelineComplete
```

## Related Code Files

| Action | File |
|--------|------|
| Create | `crates/contribai-rs/tests/common/mod.rs` |
| Create | `crates/contribai-rs/tests/common/mock_llm.rs` |
| Create | `crates/contribai-rs/tests/common/mock_github.rs` |
| Create | `crates/contribai-rs/tests/pipeline_integration.rs` |
| Create | `crates/contribai-rs/tests/memory_integration.rs` |
| Create | `crates/contribai-rs/tests/patrol_integration.rs` |
| Create | `crates/contribai-rs/tests/hunt_integration.rs` |
| Modify | `crates/contribai-rs/Cargo.toml` (add `wiremock` dev-dependency) |

## Implementation Steps

### Step 1: Add dev dependencies
Add to `Cargo.toml` under `[dev-dependencies]`:
```toml
wiremock = "0.6"
```

### Step 2: Create mock LLM provider
File: `tests/common/mock_llm.rs`
- Implement `LlmProvider` trait
- Support keyword-based response routing (if prompt contains "analyze" → return findings JSON, if "generate" → return code fix, if "classify" → return classification JSON)
- Track call count for assertions

### Step 3: Create mock GitHub helpers
File: `tests/common/mock_github.rs`
- Helper functions to register wiremock matchers for common GitHub API endpoints
- `mock_repo_details(server, owner, name)` → registers GET /repos/owner/name
- `mock_file_tree(server, owner, name)` → registers GET /repos/owner/name/git/trees
- `mock_file_content(server, owner, name, path)` → registers GET /repos/owner/name/contents/path
- `mock_authenticated_user(server)` → registers GET /user
- `mock_pull_requests(server, owner, name)` → registers GET /repos/owner/name/pulls

### Step 4: Memory integration tests
File: `tests/memory_integration.rs`
- Test full lifecycle: `open_in_memory()` → `record_analysis()` → `has_analyzed()` → verify
- Test PR lifecycle: `record_pr()` → `get_prs()` → `update_pr_status()` → `get_prs(status)`
- Test working memory TTL: `set_working_memory()` → `get_working_memory()` → expire → get returns None
- Test dream consolidation: `record_outcome()` → `should_dream()` → `consolidate_dream()` → verify preferences updated
- Test conversation memory: `record_conversation()` → `get_conversation_context()` → verify ordering
- Test stats aggregation: multiple records → `get_stats()` → verify counts
- **Target: 8-10 tests**

### Step 5: Pipeline integration tests
File: `tests/pipeline_integration.rs`
- Test `run_targeted()` with mock LLM + mock GitHub (dry_run=true)
- Test middleware chain blocks low-quality repos
- Test rate limit middleware stops pipeline
- Test duplicate detection skips already-analyzed repos
- Test multi-file contribution merging (`merge_contributions_pub`)
- **Target: 5-7 tests**

### Step 6: Patrol integration tests
File: `tests/patrol_integration.rs`
- Test feedback collection filters bots correctly
- Test classification dispatches correct actions
- Test conversation context injected into classification prompt
- Test 404 PR auto-close logic
- **Target: 4-5 tests**

### Step 7: Hunt integration tests
File: `tests/hunt_integration.rs`
- Test multi-round rotation (languages, star tiers, sort orders)
- Test daily limit stops hunt mid-round
- Test merge-friendly filtering (skips repos with 0 merged PRs)
- **Target: 3-4 tests**

### Step 8: CI verification
- `cargo test` runs both unit + integration tests
- Verify CI passes with new `wiremock` dependency
- Ensure no test requires network (CI has no API keys)

## Todo List

- [ ] Add `wiremock` to dev-dependencies in Cargo.toml
- [ ] Create `tests/common/mod.rs` + `mock_llm.rs` + `mock_github.rs`
- [ ] Implement MockLlm with keyword-based response routing
- [ ] Implement mock GitHub helpers with wiremock
- [ ] Write memory integration tests (8-10 tests)
- [ ] Write pipeline integration tests (5-7 tests)
- [ ] Write patrol integration tests (4-5 tests)
- [ ] Write hunt integration tests (3-4 tests)
- [ ] Verify all tests pass: `cargo test`
- [ ] Verify CI green

## Success Criteria

- 20+ new integration tests passing
- Total test count: 375+
- `cargo test` completes in <60s (including integration tests)
- Zero network calls in test suite (all mocked)
- CI green with new tests

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `GitHubClient` hard to mock (concrete struct) | Medium | Medium | Use wiremock at HTTP level — no prod refactor needed |
| `LlmProvider` trait signature changes | Low | Medium | MockLlm wraps trait; update mock if trait changes |
| Integration tests flaky due to timing | Low | High | No real sleeps; use `tokio::time::pause()` for time-dependent tests |
| wiremock version conflict with existing deps | Low | Low | Check `cargo tree` for reqwest version compatibility |
| Pipeline constructor requires many dependencies | Medium | Low | Create `test_pipeline()` helper that wires everything |

## Security Considerations
- Mock responses must not contain real API keys or tokens
- Test fixtures should use obviously fake data ("test-owner/test-repo")

## Next Steps
- After this phase: Sprint 3 uses integration test framework to validate merge rate improvements
- Future: Add `#[cfg(feature = "live-tests")]` for optional live API tests behind feature flag
