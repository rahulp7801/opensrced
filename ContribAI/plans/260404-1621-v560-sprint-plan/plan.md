---
title: "v5.6.0 Sprint Plan"
description: "Four-sprint plan: docs/quick-wins, integration tests, merge rate improvements, advanced analysis"
status: completed-with-gaps
priority: P1
effort: 32h
branch: main
tags: [v5.6.0, sprint-plan, tech-debt, testing, merge-rate]
created: 2026-04-04
---

# v5.6.0 Sprint Plan

**Baseline:** v5.5.0 | 66 .rs files | ~28K LOC | 355 tests (343 unit + 12 CLI) | 10/44 PRs merged (23%)

## Sprint Overview

| # | Sprint | Priority | Effort | Risk | Status |
|---|--------|----------|--------|------|--------|
| 1 | [Docs & Quick Wins](phase-01-docs-quick-wins.md) | P2 | 4h | Low | Pending |
| 2 | [Integration Tests](phase-02-integration-tests.md) | P1 | 12h | Medium | Pending |
| 3 | [Merge Rate Improvements](phase-03-merge-rate-improvements.md) | P1 | 10h | Medium | Pending |
| 4 | [Advanced Analysis](phase-04-advanced-analysis.md) | P2 | 6h | High | Pending |

## Dependency Graph

```
Sprint 1 (Docs & Quick Wins)
    └──> Sprint 2 (Integration Tests) ← needs accurate docs + DB indexes
              └──> Sprint 3 (Merge Rate) ← needs test framework for validation
                        └──> Sprint 4 (Advanced Analysis) ← needs merge rate baseline
```

Sprint 1 is a hard blocker for Sprint 2 (DB indexes change query behavior tested in Sprint 2).
Sprint 3 can technically start before Sprint 2 completes (analysis is code-review, not test-dependent).
Sprint 4 depends on Sprint 3 baseline measurement for success criteria.

## Key Metrics to Track

| Metric | Current (v5.5.0) | Target (v5.6.0) |
|--------|-------------------|------------------|
| Test count | 355 | 400+ |
| Integration tests | 0 | 20+ |
| Merge rate | 23% (10/44) | 35%+ on new PRs |
| DB query perf (cold) | Unindexed | Indexed, <5ms p99 |

## Backwards Compatibility

- DB schema: Additive only (CREATE INDEX IF NOT EXISTS). No column changes.
- CLI: No breaking changes. New flags only.
- Config: No changes to config.yaml schema.
- API: No breaking changes.

## Rollback Plan

| Sprint | Rollback Strategy |
|--------|-------------------|
| 1 | `git revert` — docs-only, zero runtime risk |
| 2 | Tests are additive. Remove test files. No prod code changes. |
| 3 | Feature-flag new scoring logic behind config. Revert to old scorer. |
| 4 | New analysis behind feature flag. Revert drops new code paths. |

## File Ownership (No Parallel Conflicts)

| Sprint | Owns | Reads Only |
|--------|------|------------|
| 1 | `docs/*`, `README.md`, `memory.rs` (indexes only) | — |
| 2 | `tests/` (new dir), test helpers | All `src/` (read) |
| 3 | `generator/scorer.rs`, `generator/self_review.rs`, `pr/manager.rs`, `orchestrator/pipeline.rs` | `HALL_OF_FAME.md` |
| 4 | `analysis/compressor.rs`, `analysis/ast_intel.rs`, `analysis/repo_map.rs` | `generator/engine.rs` |
