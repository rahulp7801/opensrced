# Phase 3: Merge Rate Improvements

## Context
- [HALL_OF_FAME.md](../../HALL_OF_FAME.md) — 10 merged, 14 closed, 20 open (44 total)
- [generator/scorer.rs](../../crates/contribai-rs/src/generator/scorer.rs) — 7-check quality gate (min 0.6)
- [generator/self_review.rs](../../crates/contribai-rs/src/generator/self_review.rs) — LLM self-review
- [orchestrator/pipeline.rs](../../crates/contribai-rs/src/orchestrator/pipeline.rs) — pipeline orchestration
- [pr/manager.rs](../../crates/contribai-rs/src/pr/manager.rs) — PR creation + description

## Overview
- **Priority:** P1 (highest business impact)
- **Effort:** 10h
- **Risk:** Medium — changes to scoring/selection affect all future PR quality
- **Status:** Pending
- **Blocked by:** Phase 2 (need test framework to validate changes)

## Key Insights

### Closed PR Failure Mode Analysis

From HALL_OF_FAME.md, the 14 closed PRs cluster into distinct failure patterns:

| Failure Mode | Count | PRs | Root Cause |
|-------------|-------|-----|------------|
| **Not a real bug** | 3 | flask #5966, ty #3089, marimo #8789 | False positive analysis — LLM hallucinated the issue |
| **Duplicate** | 3 | worldmonitor #1886, #1874, #1872 | Same repo targeted multiple times, dedup failed across runs |
| **Out of scope** | 2 | pandas #64740, worldmonitor #1822 | Contribution type rejected by maintainer (docs, guidelines) |
| **Archived/dead repo** | 1 | elyra #3353 | Repo no longer maintained |
| **Low-value docs** | 3 | tinyhttp #491, TrendRadar #1014, vibe #365 | Missing docs/README — maintainers don't want bot-generated docs |
| **Missing testing** | 1 | TrendRadar #1015 | Generated test framework not wanted |
| **Undocumented scripts** | 1 | vibe #366 | Too trivial / not wanted |

### Pattern Summary

1. **False positives (21%):** Analysis claims bug exists but it doesn't. Fix: stronger validation.
2. **Duplicates (21%):** Same repo hit repeatedly. Fix: stronger cross-run dedup.
3. **Unwanted docs PRs (29%):** Documentation PRs almost always rejected. Fix: deprioritize or skip docs type.
4. **Repo selection (14%):** Dead/archived repos, repos that don't accept external PRs. Fix: better repo filtering.
5. **Trivial changes (14%):** Changes too small or unwanted. Fix: minimum impact threshold.

### What Merges

Merged PRs share traits:
- **Real bugs** (crash, incorrect behavior, security): 8/10 merged
- **Code quality** (missing null checks, hardcoded paths): 7/10 merged
- **Non-trivial repos** (>500 stars, active maintainers): 10/10 merged
- **Specific, focused changes** (1-3 files): 10/10 merged

## Requirements

### Functional
1. Docs-type PR suppression: skip or heavily penalize documentation-only PRs
2. Enhanced false-positive detection: second LLM validation pass for "is this actually a bug?"
3. Cross-run dedup: check memory for existing open PRs to same repo before creating new ones
4. Repo health filter: skip archived repos, repos with no merged external PRs in 6 months
5. Minimum impact scoring: reject changes that are purely cosmetic or trivial
6. PR description quality: include reproduction steps, before/after, rationale

### Non-Functional
- Changes must not reduce throughput (PRs/hour) by more than 20%
- New scoring factors must be configurable (not hardcoded thresholds)
- Existing merged-PR patterns must still score above threshold (regression check)

## Architecture

### Change 1: Docs-Type Suppression

In `pipeline.rs` — add docs-type filtering after contribution generation:

```rust
// After quality scoring, before PR creation
let contributions: Vec<_> = contributions.into_iter()
    .filter(|c| {
        if c.contribution_type == ContributionType::DocsImprove {
            // Only keep docs PRs if repo explicitly accepts them
            let prefs = self.memory.get_repo_preferences(&repo.full_name);
            prefs.map(|p| p.preferred_types.contains("docs")).unwrap_or(false)
        } else {
            true
        }
    })
    .collect();
```

### Change 2: Enhanced Validation (Two-Pass)

In `generator/self_review.rs` — add a second validation prompt:

**Current flow:** Generate fix → Self-review (does fix look correct?)
**New flow:** Generate fix → Self-review → **Bug verification** (is the original finding actually a real issue?)

The bug verification prompt:
```
Given this code: [original file content]
The analysis claims: [finding description]
Is this actually a bug/issue that needs fixing? Consider:
1. Could this be intentional behavior?
2. Is there context we're missing?
3. Would a maintainer agree this needs changing?
Respond: REAL_BUG or FALSE_POSITIVE with one-line reasoning.
```

Cost: 1 extra LLM call per contribution. ~3-5s latency added.

### Change 3: Cross-Run Duplicate Check

In `pipeline.rs` before PR creation — query memory for existing open PRs:

```rust
// Check if we already have an open PR to this repo
let existing = self.memory.get_prs(Some("open"), 100)?;
let has_open_pr = existing.iter().any(|pr| pr["repo"] == repo.full_name);
if has_open_pr {
    info!(repo = %repo.full_name, "Skipping — already have open PR");
    continue;
}
```

### Change 4: Repo Health Filter

In `pipeline.rs` hunt mode — add pre-filter:

```rust
// Skip archived repos
if repo.archived { continue; }
// Skip repos with no recent merged external PRs (already partially exists)
// Strengthen: require at least 2 merged PRs in last 6 months
```

### Change 5: PR Description Template

In `pr/manager.rs` — enhance PR body template:

```markdown
## Summary
[One-line description of what this PR fixes]

## Problem
[What's wrong in the current code — specific, with file:line reference]

## Solution
[What this PR changes and why]

## Testing
[How to verify the fix is correct]

---
*Generated by [ContribAI](https://github.com/tang-vu/ContribAI) v5.6.0*
```

## Related Code Files

| Action | File | Change |
|--------|------|--------|
| Modify | `generator/self_review.rs` | Add bug verification pass |
| Modify | `generator/scorer.rs` | Add docs-type penalty, minimum impact threshold |
| Modify | `orchestrator/pipeline.rs` | Add cross-run dedup, docs filtering, repo health |
| Modify | `pr/manager.rs` | Enhanced PR description template |
| Modify | `core/config.rs` | Add `merge_rate` config section (optional thresholds) |

## Implementation Steps

### Step 1: Analyze current scorer
Read `generator/scorer.rs` to understand the 7 scoring checks. Map which ones catch the failure patterns above.

### Step 2: Add docs-type suppression
In `pipeline.rs`, after `generate_contributions()` and before `create_pr()`:
- Filter out `ContributionType::DocsImprove` unless repo preferences explicitly include docs
- Log skipped docs contributions for visibility

### Step 3: Add bug verification pass
In `generator/self_review.rs`:
- Add `verify_finding_is_real()` method
- Takes original finding + file content, asks LLM "is this actually a bug?"
- Returns `(bool, String)` — is_real + reasoning
- Wire into pipeline between self-review and PR creation
- If `FALSE_POSITIVE` → skip contribution, record in memory as rejected finding

### Step 4: Strengthen cross-run dedup
In `pipeline.rs`:
- Before PR creation, check `memory.get_prs(Some("open"), 100)` for same repo
- If open PR exists for same repo, skip (don't create competing PRs)
- This is separate from the existing title-fuzzy-match dedup (which catches same-finding dupes)

### Step 5: Add repo health pre-filter
In `pipeline.rs` hunt mode:
- Check `repo.archived` field (already available in GitHub API response)
- Require `merged_count >= 2` in recent PRs (currently requires `> 0`, too loose)

### Step 6: Enhance PR description
In `pr/manager.rs`:
- Replace current description template with structured format
- Include: Summary, Problem (with file:line), Solution, Testing guidance
- Add "Generated by ContribAI v5.6.0" footer

### Step 7: Add config options
In `core/config.rs`:
- Add optional `merge_rate` section to config
- `skip_docs_prs: bool` (default: true)
- `require_bug_verification: bool` (default: true)
- `min_merged_prs_for_target: u32` (default: 2)

### Step 8: Write integration tests
Using Phase 2's test framework:
- Test docs-type filtering (docs PR skipped, code PR passes)
- Test bug verification (false positive rejected)
- Test cross-run dedup (second PR to same repo blocked)
- Test repo health filter (archived repo skipped)

## Todo List

- [ ] Analyze closed PR patterns (done above — document in code comments)
- [ ] Add docs-type suppression in pipeline
- [ ] Implement bug verification pass in self_review.rs
- [ ] Strengthen cross-run duplicate detection
- [ ] Add repo health pre-filter in hunt mode
- [ ] Enhance PR description template in pr/manager.rs
- [ ] Add merge_rate config section
- [ ] Write integration tests for each improvement
- [ ] Measure: run dry-run against 5 known-closed-PR repos, verify new logic would have caught them
- [ ] Run full test suite — `cargo test`

## Success Criteria

- Dry-run against 10 repos including past failure cases: >=70% of previously-closed PRs would now be filtered
- Docs-type PRs skipped by default
- No regression: all 10 merged-PR patterns still score above quality threshold
- New tests pass for each improvement
- `cargo clippy` clean

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bug verification too aggressive (rejects real bugs) | Medium | High | Start with `require_bug_verification: false` in config, test extensively before enabling |
| Docs suppression too broad (some repos want docs PRs) | Low | Medium | Respect `repo_preferences.preferred_types` override |
| Extra LLM call slows pipeline significantly | Low | Medium | Bug verification only for findings scoring 0.6-0.8 (borderline), skip for high-confidence |
| Cross-run dedup blocks legitimate second PR | Low | Low | Only block if open PR exists (not closed/merged) |
| PR description too long/verbose | Low | Low | Keep template concise, 10-15 lines max |

## Security Considerations
- Bug verification prompt must not leak sensitive repo data
- PR description template should not include raw LLM response (sanitize)
