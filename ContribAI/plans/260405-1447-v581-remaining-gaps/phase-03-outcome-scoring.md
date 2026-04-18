# Phase 3: Outcome-Aware Quality Scoring

## Priority: Medium | Status: Pending | Effort: 1h
**Depends on: Phase 2** (needs stored outcomes in `pr_outcomes` / `repo_preferences`)

## Context Links
- [scorer.rs](../../crates/contribai-rs/src/generator/scorer.rs) — QualityScorer (L46-306)
- [memory.rs](../../crates/contribai-rs/src/orchestrator/memory.rs) — RepoPreferences (L1092-1100), get_repo_preferences (L535)
- [pipeline.rs](../../crates/contribai-rs/src/orchestrator/pipeline.rs) — scorer construction (L212)

## Key Insight
`QualityScorer` currently runs 7 static checks. `RepoPreferences` already stores `merge_rate`, `preferred_types`, `rejected_types` per repo. We add an 8th check that penalizes findings whose type was previously rejected and boosts types that were previously merged.

## Architecture

```
QualityScorer::evaluate(contribution, repo_prefs: Option<&RepoPreferences>)
  ├── 7 existing static checks (unchanged)
  └── check_outcome_history(contribution, repo_prefs)  ← NEW 8th check
       ├── No prefs available → score 0.7 (neutral, slight benefit of doubt)
       ├── Finding type in rejected_types → score 0.2 (strong penalty)
       ├── Finding type in preferred_types → score 1.0 (boost)
       ├── merge_rate < 0.2 → score 0.4 (repo generally unreceptive)
       └── merge_rate >= 0.5 → score 0.9 (repo receptive)
```

## Files to Modify
- `crates/contribai-rs/src/generator/scorer.rs` — add 8th check, accept optional prefs
- `crates/contribai-rs/src/orchestrator/pipeline.rs` — pass repo prefs to scorer

## Implementation Steps

1. **scorer.rs** — Add optional prefs to `evaluate`:
   ```rust
   pub fn evaluate(
       &self,
       contribution: &Contribution,
       repo_prefs: Option<&crate::orchestrator::memory::RepoPreferences>,
   ) -> QualityReport
   ```
   Add to checks vec:
   ```rust
   self.check_outcome_history(contribution, repo_prefs),
   ```

2. **scorer.rs** — Implement `check_outcome_history`:
   ```rust
   fn check_outcome_history(
       &self,
       c: &Contribution,
       prefs: Option<&crate::orchestrator::memory::RepoPreferences>,
   ) -> CheckResult {
       let Some(prefs) = prefs else {
           return CheckResult {
               name: "outcome_history".into(),
               passed: true,
               score: 0.7,
               reason: "No outcome history available".into(),
           };
       };

       let type_str = c.contribution_type.to_string();

       // Strong penalty if this type was previously rejected
       if prefs.rejected_types.contains(&type_str) {
           return CheckResult {
               name: "outcome_history".into(),
               passed: false,
               score: 0.2,
               reason: format!("Type '{}' was previously rejected by this repo", type_str),
           };
       }

       // Boost if this type was previously merged
       if prefs.preferred_types.contains(&type_str) {
           return CheckResult {
               name: "outcome_history".into(),
               passed: true,
               score: 1.0,
               reason: format!("Type '{}' was previously merged by this repo", type_str),
           };
       }

       // General merge rate signal
       let (score, reason) = if prefs.merge_rate < 0.2 {
           (0.4, "Repo has low merge rate (<20%)")
       } else if prefs.merge_rate >= 0.5 {
           (0.9, "Repo has good merge rate (>=50%)")
       } else {
           (0.6, "Repo has moderate merge rate")
       };

       CheckResult {
           name: "outcome_history".into(),
           passed: score >= 0.5,
           score,
           reason: reason.into(),
       }
   }
   ```

3. **pipeline.rs** — At scorer call site, fetch and pass repo prefs.
   Find where `self.scorer.evaluate(&contribution)` is called and change to:
   ```rust
   let repo_prefs = self.memory.get_repo_preferences(&repo.full_name).ok().flatten();
   let report = self.scorer.evaluate(&contribution, repo_prefs.as_ref());
   ```

4. **scorer.rs tests** — Update existing test calls to pass `None` as second arg. Add new tests:
   - `test_outcome_history_rejected_type_penalized` — score should be 0.2
   - `test_outcome_history_preferred_type_boosted` — score should be 1.0
   - `test_outcome_history_no_prefs_neutral` — score should be 0.7

## Data Flow

```
Memory (pr_outcomes) 
  → record_outcome() auto-calls update_repo_preferences()
    → repo_preferences table updated with merge_rate, rejected_types, preferred_types
      → pipeline.rs reads via get_repo_preferences()
        → passes to scorer.evaluate(contribution, Some(&prefs))
          → check_outcome_history uses prefs to adjust score
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing test breakage from signature change | High | Low | Trivial: add `, None` to all existing evaluate() calls |
| Overly aggressive rejection penalty | Medium | Medium | 0.2 score is harsh but appropriate; min_score default 0.6 means it'll fail — which is the intent |
| No prefs for new repos | N/A | N/A | Returns 0.7 (neutral) — no regression from current behavior |

## Success Criteria
- 8th check appears in QualityReport output
- Contributions to repos with rejected types score lower
- Contributions to repos with high merge rate score higher
- New repos (no prefs) behave identically to current behavior (0.7 neutral)
- All existing tests pass after adding `None` param

## Todo

- [ ] Add `repo_prefs` parameter to `QualityScorer::evaluate`
- [ ] Implement `check_outcome_history` method
- [ ] Update pipeline.rs to fetch and pass repo prefs
- [ ] Update all existing `evaluate()` call sites to pass `None`
- [ ] Add 3 new unit tests for outcome history check
- [ ] Run `cargo test` — all green
- [ ] Run `cargo clippy` — no new warnings
