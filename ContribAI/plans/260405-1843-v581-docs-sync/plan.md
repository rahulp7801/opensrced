---
title: "v5.8.1 Documentation Sync"
description: "Sync all project docs to v5.8.1 — versions, stats, new features, changelog creation"
status: completed
completed: 2026-04-05
priority: P1
effort: 2h
branch: main
tags: [v5.8.1, docs, sync, changelog]
created: 2026-04-05
blockedBy: []
blocks: []
---

# v5.8.1 Documentation Sync

**Baseline:** v5.8.1 | 67 .rs files | ~29,577 LOC | 418 tests | clippy clean | CI green

All docs are 1-3 versions behind. This sprint syncs everything to v5.8.1.

## Phase Summary

| # | Phase | Files | Effort | Status |
|---|-------|-------|--------|--------|
| 1 | [Core Docs Update](phase-01-core-docs-update.md) | 4 docs | 45m | Completed |
| 2 | [Public-Facing Files](phase-02-public-facing-files.md) | README, AGENTS.md | 30m | Completed |
| 3 | [Changelog + Housekeeping](phase-03-changelog-housekeeping.md) | changelog, plan status | 30m | Completed |

## Dependency Graph

```
Phase 1 (Core docs) ← independent
Phase 2 (README/AGENTS) ← independent
Phase 3 (Changelog + housekeeping) ← run last, references final stats
```

Phases 1+2 can run in parallel. Phase 3 runs last.

## Version Drift Audit

| File | Current Version | Stale Fields |
|------|----------------|--------------|
| `docs/codebase-summary.md` | v5.8.0 | version, LOC, test count, missing v5.8.1 features |
| `docs/system-architecture.md` | v5.8.0 (header), v5.5.0 (metadata) | version, missing patrol/scorer changes |
| `docs/code-standards.md` | v5.5.0 | version, test count (355→418), file count (65→67) |
| `docs/project-roadmap.md` | v5.8.0 | missing v5.8.1 section, unchecked items that are done |
| `README.md` | v5.8.0 | badge version, test count (413→418) |
| `AGENTS.md` | v5.4.0 | version, test count, file count, CLI commands, structure |
| `plans/260405-1447-v581-remaining-gaps/plan.md` | status: pending | should be completed |

## What Changed in v5.8.1

New features to document across all files:
1. **Closed-PR failure analysis** — patrol fetches review comments + CI status for closed-but-not-merged PRs, stores feedback via `memory.record_outcome()`
2. **Outcome-aware quality scoring** — `QualityScorer` takes `RepoPreferences`, 8th check `check_outcome_history` adjusts score based on `merge_rate` and `rejected_types`
3. **`resolved_imports` field** — `RepoContext` gets `HashMap<String, Vec<Symbol>>` for clean cross-file import data (moved from `symbol_map` pollution)
4. **Depth guard** — `walk_import_nodes` capped at depth 8
5. **Pipeline integration test** — `process_repo` symbol_map wiring test with wiremock

## Current Stats (for all docs)

| Metric | Value |
|--------|-------|
| Version | 5.8.1 |
| .rs files | 67 |
| LOC | ~29,577 |
| Tests | 418 (361 unit + 12 CLI + 45 integration) |
| Quality checks | 8 (was 7) |
| CI status | green |

## Backwards Compatibility

Docs-only sprint. Zero runtime changes.
