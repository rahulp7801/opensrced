# Phase 1: Mock GitHub Infrastructure

## Context
- [tests/common/mod.rs](../../crates/contribai-rs/tests/common/mod.rs) — only exports `mock_llm`
- [tests/common/mock_llm.rs](../../crates/contribai-rs/tests/common/mock_llm.rs) — keyword-based routing, 79 LOC
- [Cargo.toml](../../crates/contribai-rs/Cargo.toml) — `wiremock = "0.6"` already in dev-deps
- [github/client.rs](../../crates/contribai-rs/src/github/client.rs) — concrete `GitHubClient` struct

## Overview
- **Priority:** P1
- **Effort:** 1h
- **Risk:** Low — additive test infrastructure, no prod changes
- **Status:** Completed (2026-04-05)
- **Progress:** 100%

## Key Insights

**wiremock already available** — dev-dep added in v5.6.0 but never used. Pipeline integration tests use MockLlm only; GitHub calls are not mocked (tests rely on dry-run paths that skip GitHub).

**GitHubClient is concrete** — not trait-based. Mock at HTTP level with wiremock, constructing real `GitHubClient` pointed at mock server URL.

**Reuse pattern:** Patrol tests need mock PR review endpoints. Hunt tests need mock search + PR list endpoints. Share helpers.

## Requirements

### Functional
1. `mock_github.rs` module with wiremock helper functions
2. Helpers for: repo details, file tree, PR list, PR reviews, PR comments, authenticated user, search results
3. Re-export from `tests/common/mod.rs`

### Non-Functional
- Helpers must be composable (register multiple endpoints on same MockServer)
- Response JSON must match real GitHub API shape (only required fields)
- No network access — all wiremock

## Related Code Files

| Action | File |
|--------|------|
| Create | `crates/contribai-rs/tests/common/mock_github.rs` |
| Modify | `crates/contribai-rs/tests/common/mod.rs` (add re-export) |

## Implementation Steps

1. **Create `tests/common/mock_github.rs`** with these helpers:
   ```rust
   pub async fn mock_repo_details(server: &MockServer, owner: &str, name: &str)
   pub async fn mock_file_tree(server: &MockServer, owner: &str, name: &str)
   pub async fn mock_pull_requests(server: &MockServer, owner: &str, name: &str, state: &str, prs: Vec<Value>)
   pub async fn mock_pr_reviews(server: &MockServer, owner: &str, name: &str, pr_number: u64, reviews: Vec<Value>)
   pub async fn mock_pr_comments(server: &MockServer, owner: &str, name: &str, pr_number: u64, comments: Vec<Value>)
   pub async fn mock_authenticated_user(server: &MockServer)
   pub async fn mock_search_repos(server: &MockServer, repos: Vec<Value>)
   ```

2. **Each helper registers wiremock matchers** — e.g.:
   ```rust
   Mock::given(method("GET"))
       .and(path(format!("/repos/{owner}/{name}")))
       .respond_with(ResponseTemplate::new(200).set_body_json(repo_json))
       .mount(server).await;
   ```

3. **Add fixture factory functions** for common JSON shapes:
   ```rust
   pub fn fake_repo(owner: &str, name: &str, stars: i64) -> Value
   pub fn fake_pr(number: u64, state: &str, title: &str) -> Value
   pub fn fake_review(user: &str, state: &str, body: &str) -> Value
   ```

4. **Update `tests/common/mod.rs`:**
   ```rust
   pub mod mock_llm;
   pub mod mock_github;
   ```

5. **Verify:** `cargo test --test memory_integration` and `cargo test --test pipeline_integration` still pass (no regressions from adding new module).

## Todo List

- [x] Create `mock_github.rs` with wiremock helpers
- [x] Add fixture factory functions (fake_repo, fake_pr, fake_review)
- [x] Update `common/mod.rs` to export mock_github
- [x] Verify existing tests still pass

## Success Criteria

- `cargo test` passes (no regressions)
- mock_github module compiles and is importable from other test files
- Helpers cover the 7 endpoints needed by Phase 2 + Phase 3

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| wiremock API changes between 0.5 and 0.6 | Low | Low | Already on 0.6, follow docs |
| GitHubClient constructor requires real token | Medium | Low | Pass fake token, wiremock intercepts before auth matters |
| Response shape mismatch vs real API | Low | Medium | Only include fields actually deserialized by prod code |
