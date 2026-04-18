---
title: "v5.8.1 Remaining Gaps + Code Review Fixes"
description: "Closed-PR learnings, outcome-aware scoring, cross-file import cleanup, depth guard, integration test"
status: completed
priority: P2
completed: 2026-04-05
effort: 4h
branch: main
tags: [v5.8.1, patrol, scorer, ast, tests]
created: 2026-04-05
---

# v5.8.1 Implementation Plan

5 items across 3 phases. No new tables needed; all schema exists.

## Phase Summary

| # | Phase | Items | Status | Effort |
|---|-------|-------|--------|--------|
| 1 | [Code Review Fixes](phase-01-code-review-fixes.md) | M-1, M-2, M-3 | Completed | 1.5h |
| 2 | [Closed-PR Failure Analysis](phase-02-closed-pr-analysis.md) | Feature #1 | Completed | 1.5h |
| 3 | [Outcome-Aware Quality Scoring](phase-03-outcome-scoring.md) | Feature #2 | Completed | 1h |

## Dependency Graph

```
Phase 1 (M-1,M-2,M-3) ─── all independent, no cross-deps
Phase 2 ──────────────── depends on nothing (memory tables exist)
Phase 3 ──────────────── depends on Phase 2 (uses stored outcomes)
```

## Key Design Decisions

1. **M-1 (`_cross_file_` pollution)**: Add `resolved_imports: HashMap<String,Vec<Symbol>>` field to `RepoContext`. Move cross-file entries there. Engine reads from new field. symbol_map stays clean.
2. **M-2 (depth guard)**: Add `depth: usize` param to `walk_import_nodes`, cap at 8. Zero-risk change.
3. **M-3 (integration test)**: Test `process_repo` symbol_map wiring with wiremock. Asserts cross-file resolution populates `resolved_imports` (after M-1).
4. **Closed-PR analysis**: In patrol, when PR state=="closed" and not merged, fetch review comments + CI status. Store feedback summary via `memory.record_outcome()` with feedback field. No new tables.
5. **Outcome-aware scoring**: `QualityScorer::new()` takes optional `RepoPreferences`. Adds 8th check: `check_outcome_history` that adjusts score based on `merge_rate` and `rejected_types`. Penalty if finding type is in rejected_types.

## File Ownership (no conflicts)

| Phase | Owned Files |
|-------|-------------|
| 1 | `ast_intel.rs`, `models.rs` (add field), `pipeline.rs` (L1034-1061), `engine.rs` (L250-252), `pipeline_integration.rs` |
| 2 | `patrol.rs` (add closed-PR handler) |
| 3 | `scorer.rs` (add outcome check), `pipeline.rs` (scorer construction ~L212) |

## Rollback

All changes are additive. Revert = `git revert <commit>`. No schema migration needed.
