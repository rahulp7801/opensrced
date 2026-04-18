---
title: "Phase 3: Changelog + Housekeeping"
status: completed
completed: 2026-04-05
effort: 30m
---

# Phase 3: Changelog + Housekeeping

Create project changelog and update stale plan status.

## Tasks

### 1. Create `docs/project-changelog.md`

New file documenting all releases from v5.0.0 onward. Structure:

```markdown
# Project Changelog

## [5.8.1] - 2026-04-05
### Added
- Closed-PR failure analysis in patrol
- Outcome-aware quality scoring (8th check)
- `resolved_imports` field on RepoContext
- Depth guard on walk_import_nodes (cap: 8)
- Pipeline integration test for symbol_map wiring

## [5.8.0] - 2026-04-05
### Added
- Cross-file import resolution (5 languages, 1-hop, 20-symbol cap)
- symbol_map wired in pipeline for type-aware generation
- GitHubClient with_base_url() for wiremock testability
- Mock GitHub infrastructure (mock_github.rs)
- Patrol integration tests (5 tests)
- Hunt integration tests (4 tests)

## [5.7.0] - 2026-04-05
### Fixed
- Hunt CLI command calls pipeline.hunt() instead of pipeline.run()
### Changed
- cargo fmt --all formatting pass

## [5.6.0] - 2026-04-04
### Added
- Integration test framework (wiremock 0.6 + MockLlm)
- 33+ new tests (388 total)
- LLM retry with exponential backoff
- GitHub rate limiter (token-bucket)
- `doctor` command for system health diagnostics
- DB indexes for hot query paths
- Semantic code chunking

... (continue back to v5.0.0)
```

Source: git log + project-roadmap.md. Keep entries concise.

### 2. Update v5.8.1 Plan Status

**File:** `plans/260405-1447-v581-remaining-gaps/plan.md`
- Line 8: `status: pending` → `status: completed`
- Add: `completed: 2026-04-05`
- Phase table: all 3 phases → `Completed`

### 3. Archive Check

Verify all 3 existing plans have accurate statuses:
- `260404-1621-v560-sprint-plan` — `completed-with-gaps` ✓ (correct, gaps were completed in v5.7.1 plan)
- `260405-0054-v571-gap-completion` — `completed` ✓
- `260405-1447-v581-remaining-gaps` — needs update (see #2)

## Success Criteria

- `docs/project-changelog.md` exists with all v5.x releases
- v5.8.1 plan marked completed
- All plan statuses accurate
