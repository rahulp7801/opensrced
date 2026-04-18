# Phase 2: Patrol Integration Tests

## Context
- [pr/patrol.rs](../../crates/contribai-rs/src/pr/patrol.rs) — `PrPatrol` struct, `patrol()` method, CI monitor
- [tests/common/mock_llm.rs](../../crates/contribai-rs/tests/common/mock_llm.rs) — already handles "classify"/"feedback" keywords
- [orchestrator/memory.rs](../../crates/contribai-rs/src/orchestrator/memory.rs) — `record_conversation`, `get_conversation_context`
- Original plan: Phase 2 targeted 4-5 patrol integration tests

## Overview
- **Priority:** P1
- **Effort:** 2h
- **Risk:** Medium — patrol depends on GitHub API + LLM + memory interactions
- **Status:** Completed (2026-04-05)
- **Progress:** 100%
- **Blocked by:** None

## Key Insights

**PrPatrol depends on 3 components:** GitHubClient (fetch reviews/comments), LlmProvider (classify feedback), Memory (conversation history). All three need mocking.

**Constructor pattern:** `PrPatrol::new(github, llm).with_memory(memory)` — builder pattern, easy to wire in tests.

**patrol() input:** Takes `&[serde_json::Value]` (PR records from memory), not from GitHub directly. This simplifies mocking — we feed PR records directly, only mock the GitHub calls patrol makes (fetch reviews, post comments).

**Bot filtering:** Patrol filters 11+ known bot usernames. Test this explicitly.

**404 auto-close:** Patrol auto-removes PRs that return 404. Test with wiremock 404 response.

## Requirements

### Functional
1. Test bot-user feedback filtering (known bot names ignored)
2. Test feedback classification dispatches correct action via MockLlm
3. Test conversation context injected into classification prompt
4. Test 404 PR auto-clean removes from memory
5. Test dry-run mode skips comment posting

### Non-Functional
- All tests use `Memory::open_in_memory()`
- No real HTTP calls — wiremock for GitHub, MockLlm for LLM
- Each test isolated (fresh MockServer + Memory per test)

## Related Code Files

| Action | File |
|--------|------|
| Create | `crates/contribai-rs/tests/patrol_integration.rs` |
| Read | `crates/contribai-rs/src/pr/patrol.rs` |
| Read | `crates/contribai-rs/tests/common/mock_github.rs` (from Phase 1) |

## Implementation Steps

1. **Create `tests/patrol_integration.rs`** with test setup helper:
   ```rust
   async fn setup() -> (MockServer, Memory, MockLlm) {
       let server = MockServer::start().await;
       let memory = Memory::open_in_memory().unwrap();
       let llm = MockLlm::new();
       (server, memory, llm)
   }
   ```

2. **Test: bot feedback filtered**
   - Mock PR reviews endpoint returning review from "dependabot[bot]"
   - Call `patrol.patrol(&pr_records, false)`
   - Assert: MockLlm.calls() == 0 (bot review never classified)

3. **Test: feedback classification dispatches action**
   - Mock PR reviews with real user review (state: "changes_requested", body: "fix the import")
   - MockLlm routes "classify"/"feedback" → `{"action":"fix","summary":"..."}`
   - Call patrol with dry_run=true
   - Assert: MockLlm.calls() >= 1 (classification happened)
   - Assert: PatrolResult tracks the classified feedback

4. **Test: conversation context injected**
   - Pre-populate memory with conversation history for a PR
   - Mock PR reviews with new feedback
   - Call patrol
   - Assert: MockLlm was called with prompt containing prior conversation context

5. **Test: 404 PR auto-clean**
   - Register wiremock to return 404 for PR reviews endpoint
   - Pre-record PR in memory
   - Call patrol
   - Assert: PR removed from memory (or marked closed)

6. **Test: dry-run skips posting**
   - Mock PR reviews with actionable feedback
   - Call patrol with dry_run=true
   - Assert: no POST/PUT calls made to wiremock (check request journal)

7. **Verify:** `cargo test --test patrol_integration` passes

## Todo List

- [x] Create patrol_integration.rs with setup helper
- [x] Test: bot feedback filtered
- [x] Test: feedback classification dispatches action
- [x] Test: conversation context injected
- [x] Test: 404 PR auto-clean
- [x] Test: dry-run skips posting
- [x] Verify all tests pass

## Success Criteria

- 4-5 new integration tests passing
- All tests use wiremock + MockLlm (zero network)
- `cargo test` completes without regressions

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PrPatrol requires GitHubClient with specific base_url override | Medium | Medium | Check if GitHubClient accepts custom base_url; if not, may need minor prod change or env var |
| Patrol internal flow hard to assert (side effects are GitHub API calls) | Medium | Low | Use wiremock request journal to verify calls made/not made |
| Memory conversation schema changes | Low | Low | Use same `ConversationMessage` struct as prod code |
