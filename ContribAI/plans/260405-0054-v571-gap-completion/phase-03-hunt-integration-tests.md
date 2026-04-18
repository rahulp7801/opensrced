# Phase 3: Hunt Integration Tests

## Context
- [orchestrator/pipeline.rs:449-577](../../crates/contribai-rs/src/orchestrator/pipeline.rs) — `hunt()` method with rotation logic
- [github/discovery.rs](../../crates/contribai-rs/src/github/discovery.rs) — `RepoDiscovery::discover()` calls GitHub search
- [orchestrator/memory.rs](../../crates/contribai-rs/src/orchestrator/memory.rs) — `has_analyzed_since()` with 7-day TTL
- Original plan: Phase 2 targeted 3-4 hunt integration tests

## Overview
- **Priority:** P1
- **Effort:** 2h
- **Risk:** Medium — hunt() has complex rotation + discovery + daily limit logic
- **Status:** Completed (2026-04-05)
- **Progress:** 100%
- **Blocked by:** None

## Key Insights

**Hunt rotation logic:** Each round rotates languages, star tiers, sort orders, and page numbers. Tests should verify diversity across rounds.

**Daily limit gate:** `get_today_pr_count()` checked every round. If limit reached → hunt stops. Easy to test by pre-populating memory.

**Merge-friendly filter:** Hunt fetches closed PRs for each discovered repo, keeps only repos with `merged > 0`. This is the filter that was planned as "repo health" — already exists but checks `merged > 0` not `merged >= 2` as Phase 3 of old plan suggested. Current threshold is acceptable.

**Discovery mock:** `RepoDiscovery::discover()` calls GitHub search API. Mock with wiremock `mock_search_repos()` from Phase 1.

**archived:false already in query:** discovery.rs line 81 adds `archived:false` to search query. Archived repos won't appear.

## Requirements

### Functional
1. Test multi-round rotation (languages, star tiers, sort orders change per round)
2. Test daily limit stops hunt mid-round
3. Test merge-friendly filter skips repos with 0 merged PRs
4. Test 7-day TTL: recently analyzed repos skipped

### Non-Functional
- All tests use wiremock for GitHub search + PR list endpoints
- Memory::open_in_memory() for daily limit + has_analyzed checks
- Tests deterministic — no time-dependent assertions beyond TTL

## Related Code Files

| Action | File |
|--------|------|
| Create | `crates/contribai-rs/tests/hunt_integration.rs` |
| Read | `crates/contribai-rs/src/orchestrator/pipeline.rs` (hunt method) |
| Read | `crates/contribai-rs/src/github/discovery.rs` (discover method) |
| Read | `crates/contribai-rs/tests/common/mock_github.rs` (from Phase 1) |

## Implementation Steps

1. **Create `tests/hunt_integration.rs`** with setup helper:
   ```rust
   async fn setup_hunt() -> (MockServer, Pipeline, Memory) {
       let server = MockServer::start().await;
       let memory = Memory::open_in_memory().unwrap();
       // Build Pipeline with GitHubClient pointed at mock server
       // Build with MockLlm + default config
       ...
   }
   ```

2. **Test: daily limit stops hunt**
   - Pre-populate memory with `max_prs_per_day` PR records for today
   - Call `pipeline.hunt(3, 0, false, "normal")`
   - Assert: returns immediately, repos_analyzed == 0
   - Assert: no search API calls made to wiremock

3. **Test: merge-friendly filter skips non-merging repos**
   - Mock search returning 2 repos
   - Mock PR list for repo-A: 3 closed PRs, 0 with `merged_at` → should skip
   - Mock PR list for repo-B: 3 closed PRs, 2 with `merged_at` → should keep
   - Call hunt with dry_run=true
   - Assert: only repo-B analyzed

4. **Test: recently analyzed repos skipped (7-day TTL)**
   - Pre-record repo-A as analyzed today in memory
   - Mock search returning repo-A
   - Call hunt with 1 round
   - Assert: repo-A skipped (`has_analyzed_since` returns true)

5. **Test: multi-round diversity** (optional, lower priority)
   - Call hunt with 3 rounds, delay_sec=0
   - Capture wiremock received requests
   - Assert: search queries use different sort/page parameters across rounds

6. **Verify:** `cargo test --test hunt_integration` passes

## Todo List

- [x] Create hunt_integration.rs with setup helper
- [x] Test: daily limit stops hunt
- [x] Test: merge-friendly filter skips repos with 0 merged
- [x] Test: recently analyzed repos skipped (7-day TTL)
- [x] Test: multi-round diversity (if time permits)
- [x] Verify all tests pass

## Success Criteria

- 3-4 new integration tests passing
- All tests use wiremock + MockLlm (zero network)
- `cargo test` completes without regressions

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pipeline constructor complex — many deps to wire | High | Medium | Create `test_pipeline()` factory in common/ that wires all deps with defaults |
| hunt() has real sleep (delay_sec) between rounds | Medium | Low | Pass delay_sec=0 in tests; or use tokio::time::pause() |
| GitHubClient base_url not configurable | Medium | High | Check constructor; may need to add env var or param override for tests |
| Discovery query string hard to match in wiremock | Low | Medium | Use wiremock's `any()` matcher or `path_regex` instead of exact match |

## Notes

The biggest risk is **GitHubClient base_url**. If the client hardcodes `https://api.github.com`, wiremock can't intercept. Options:
- **A.** Add `base_url` param to `GitHubClient::new()` (small prod change, clean)
- **B.** Use env var `GITHUB_API_URL` override (no signature change)
- **C.** Mock at reqwest level with tower-test (complex)

Check client.rs constructor before implementing. If hardcoded, option B is simplest.
