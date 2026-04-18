# Planner Report: v5.8.1 Remaining Gaps

**Date:** 2026-04-05 | **Plan:** `plans/260405-1447-v581-remaining-gaps/`

## Summary

Created 3-phase plan for 5 items (3 code review fixes + 2 feature gaps). Total effort: ~4h.

## Key Findings from Codebase Analysis

- **M-1**: `_cross_file_` keys inserted at pipeline.rs:1056 into `symbol_map`, then engine.rs:252 iterates all `symbol_map.values().flatten()` — confirmed pollution. Fix: new `resolved_imports` field on `RepoContext`.
- **M-2**: `walk_import_nodes` (ast_intel.rs:523-527) recurses into ALL children after processing import nodes. No depth guard. Fix: add `depth: usize` param, cap at 8.
- **M-3**: `pipeline_integration.rs` tests merge logic, scorer, risk, events, config — but never exercises `process_repo` symbol map wiring. Fix: wiremock-based integration test.
- **Feature #1**: Patrol loop (patrol.rs:86-89) skips all non-open PRs. `record_outcome()` and `update_repo_preferences()` exist but patrol never calls them for closed PRs. Fix: add `analyze_closed_pr` method.
- **Feature #2**: `QualityScorer` has 7 static checks. `RepoPreferences` stores `merge_rate`, `rejected_types`, `preferred_types` but scorer never reads them. Fix: 8th check using prefs.

## Phase Dependencies

```
Phase 1 (M-1, M-2, M-3) → independent, can start immediately
Phase 2 (closed-PR analysis) → independent, can start immediately  
Phase 3 (outcome scoring) → depends on Phase 2 (needs stored outcomes)
```

Phases 1 and 2 can be implemented in parallel. Phase 3 must follow Phase 2.

## No New Schema Required

All tables already exist: `pr_outcomes`, `repo_preferences`, `working_memory`. No migration needed.

## File Ownership (conflict-free)

| Phase | Primary Files |
|-------|--------------|
| 1 | ast_intel.rs, models.rs (field add), pipeline.rs (L1034-1061), engine.rs (L250), pipeline_integration.rs |
| 2 | patrol.rs, models.rs (PatrolResult field) |
| 3 | scorer.rs, pipeline.rs (scorer construction ~L212) |

Models.rs touched by Phase 1 (RepoContext) and Phase 2 (PatrolResult) — different structs, no conflict.

**Status:** DONE
**Summary:** 3-phase plan created with concrete implementation steps, file ownership, risk assessment, and success criteria for all 5 items.
