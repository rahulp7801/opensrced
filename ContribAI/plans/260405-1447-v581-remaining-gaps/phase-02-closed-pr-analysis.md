# Phase 2: Closed-PR Failure Analysis

## Priority: Medium | Status: Pending | Effort: 1.5h

When patrol finds closed (not merged) PRs, analyze why and store learnings.

## Context Links
- [patrol.rs](../../crates/contribai-rs/src/pr/patrol.rs) — PrPatrol (L73-128)
- [memory.rs](../../crates/contribai-rs/src/orchestrator/memory.rs) — record_outcome (L423), update_repo_preferences (L460)
- [models.rs](../../crates/contribai-rs/src/core/models.rs) — PatrolResult (L487-497)

## Key Insight
All storage infrastructure exists: `pr_outcomes` table stores feedback text, `repo_preferences` auto-updates on `record_outcome()`. The gap is patrol skips closed PRs entirely (L86-89). We need to analyze them before skipping.

## Architecture

```
patrol() loop
  ├── status == "open" → existing flow (check feedback, classify, respond)
  └── status == "closed" → NEW: analyze_closed_pr()
       ├── Fetch PR state from GitHub (merged? closed-without-merge?)
       ├── If merged → record_outcome("merged", ...) + update status
       ├── If closed (not merged):
       │    ├── Fetch review comments (last 5)
       │    ├── Summarize rejection reason (simple heuristics, no LLM)
       │    ├── record_outcome("closed", feedback_summary, ...)
       │    └── Update PR status to "closed"
       └── Result: prs_skipped counter still increments, but learnings stored
```

## Files to Modify
- `crates/contribai-rs/src/pr/patrol.rs` — add `analyze_closed_pr` method
- `crates/contribai-rs/src/core/models.rs` — add `prs_learned` field to `PatrolResult`

## Implementation Steps

1. **models.rs** — Add counter to `PatrolResult`:
   ```rust
   pub prs_learned: usize,  // closed PRs where we stored rejection learnings
   ```

2. **patrol.rs** — Add `analyze_closed_pr` method on `PrPatrol`:
   ```rust
   async fn analyze_closed_pr(
       &self,
       owner: &str,
       repo: &str,
       pr_number: i64,
       pr_type: &str,
       result: &mut PatrolResult,
   ) -> Result<()>
   ```
   Logic:
   - Call `github.get_pr_details(owner, repo, pr_number)`
   - Check `pr_data["merged"].as_bool()`:
     - If merged: `memory.record_outcome(repo, pr_number, url, pr_type, "merged", "", hours)`
     - If closed (not merged):
       - Fetch comments: `github.get_pr_comments(owner, repo, pr_number)` (take last 5)
       - Build `feedback_summary`: concatenate maintainer comments, truncate to 500 chars
       - Heuristic classification: scan for keywords ("duplicate", "won't fix", "not needed", "stale", "CI", "test", "fail")
       - `memory.record_outcome(repo, pr_number, url, pr_type, "closed", &feedback_summary, hours)`
   - `memory.update_pr_status(&full_repo, pr_number, status)`
   - Increment `result.prs_learned`

3. **patrol.rs** — Modify `patrol()` loop (L84-89):
   Currently skips non-open PRs. Change to:
   ```rust
   if !["open", "pending", "review_requested"].contains(&status) {
       // Analyze closed PRs for learnings before skipping
       if status == "closed" || status == "merged" {
           let pr_type = pr["type"].as_str().unwrap_or("unknown");
           if let Err(e) = self.analyze_closed_pr(
               owner, repo_name, pr_number, pr_type, &mut result
           ).await {
               debug!("Failed to analyze closed PR: {}", e);
           }
       }
       result.prs_skipped += 1;
       continue;
   }
   ```

4. **patrol.rs** — Compute `time_to_close_hours`:
   ```rust
   let created = pr["created_at"].as_str().and_then(|s| DateTime::parse_from_rfc3339(s).ok());
   let closed = pr_data["closed_at"].as_str().and_then(|s| DateTime::parse_from_rfc3339(s).ok());
   let hours = match (created, closed) {
       (Some(c), Some(cl)) => (cl - c).num_hours() as f64,
       _ => 0.0,
   };
   ```

### Feedback Heuristic (no LLM needed)
Scan review comments for keywords to tag the rejection reason:
- "duplicate" / "already" → "duplicate"
- "won't fix" / "not needed" / "not wanted" → "unwanted"
- "CI" / "test" / "fail" / "broken" → "ci_failure"
- "style" / "convention" / "format" → "style_mismatch"
- default → "unknown"

Store as prefix in feedback: `"[ci_failure] Original comments: ..."`

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| API rate limit from extra GitHub calls | Medium | Low | Only calls for closed PRs (typically few); existing rate limiter applies |
| Missing memory reference in patrol | Low | Medium | `self.memory` is already Option; guard with `if let Some(mem)` |

## Success Criteria
- Patrol processes closed PRs and stores rejection feedback in `pr_outcomes`
- `repo_preferences` table auto-updates with rejection data (existing `update_repo_preferences`)
- `PatrolResult.prs_learned` reflects count of analyzed closed PRs
- `cargo test` passes (add unit test for heuristic classification)

## Todo

- [ ] Add `prs_learned` field to `PatrolResult` in models.rs
- [ ] Implement `analyze_closed_pr` method in patrol.rs
- [ ] Modify patrol loop to call analyze_closed_pr for closed/merged PRs
- [ ] Add feedback heuristic classification function
- [ ] Add unit test for heuristic classifier
- [ ] Run `cargo test` — all green
