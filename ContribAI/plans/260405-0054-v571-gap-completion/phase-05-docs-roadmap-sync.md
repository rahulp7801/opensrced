# Phase 5: Docs & Roadmap Sync to v5.7.1

## Context
- [docs/project-roadmap.md](../../docs/project-roadmap.md) — still shows v5.5.0 as current, v5.6.0+ as planned
- [docs/project-overview-pdr.md](../../docs/project-overview-pdr.md) — version 5.5.0
- [docs/codebase-summary.md](../../docs/codebase-summary.md) — stats from v5.5.0
- [docs/system-architecture.md](../../docs/system-architecture.md) — version 5.5.0
- [README.md](../../README.md) — badge shows v5.6.0, test count may be stale
- [HALL_OF_FAME.md](../../HALL_OF_FAME.md) — may have new PRs to add
- Actual state: Cargo.toml = 5.7.1, 67 files, ~28.7K LOC, ~395 tests

## Overview
- **Priority:** P1
- **Effort:** 1h
- **Risk:** Low — docs only, zero runtime changes
- **Status:** Completed (2026-04-05)
- **Progress:** 100%
- **Blocked by:** None

## Key Insights

**Roadmap is stale:** Shows v5.6.0 as "Planned" but v5.6.0 shipped. Shows v5.7.0 "Advanced Analysis" as planned but semantic chunking + type hints shipped in v5.6.0. Need to mark completed items and add v5.6.0/v5.7.0/v5.7.1 release sections.

**Features shipped but undocumented:**
- v5.6.0: integration tests, merge rate improvements, semantic chunking, type-aware gen, doctor command, LLM retry, GitHub rate limiter, DB indexes, PROVENANCE.yml
- v5.7.0: version bump (features were in v5.6.0 commit)
- v5.7.1: hunt fix (pipeline.hunt() not pipeline.run()), 7-day TTL for has_analyzed, page rotation fix

**Stats drift:** Docs say 355 tests, actual is ~395. Files say 66, actual is 67. LOC says ~28K, actual ~28.7K.

## Requirements

### Functional
1. Roadmap: add v5.6.0, v5.7.0, v5.7.1 release sections with actual features
2. Roadmap: mark completed planned items (integration tests, semantic chunking, etc.)
3. Roadmap: renumber remaining planned versions correctly
4. All docs: bump version references to 5.7.1
5. All docs: update stats (files, LOC, tests) to actual numbers
6. README: update badges to match current version + test count

### Non-Functional
- Cross-check every stat against `cargo test --list`, `find`, `wc` output
- Ensure planned features section only contains genuinely unfinished items

## Related Code Files

| Action | File |
|--------|------|
| Modify | `docs/project-roadmap.md` |
| Modify | `docs/project-overview-pdr.md` |
| Modify | `docs/codebase-summary.md` |
| Modify | `docs/system-architecture.md` |
| Modify | `README.md` |
| Modify | `HALL_OF_FAME.md` (if new PR data available) |

## Implementation Steps

### Step 1: Gather actual stats
Run and record:
- `cargo test --list 2>/dev/null | grep "test$" | wc -l` → test count
- `find crates/contribai-rs/src -name "*.rs" | wc -l` → file count
- `find crates/contribai-rs/src -name "*.rs" -exec cat {} + | wc -l` → LOC

### Step 2: Update project-roadmap.md
- Add **v5.6.0** release section (2026-04-04):
  - 34 integration tests (memory + pipeline)
  - Merge rate: docs suppression, bug verification, cross-run dedup
  - Semantic chunking, type-aware generation hints
  - LLM retry with exponential backoff
  - GitHub rate limit tracking
  - Doctor diagnostic command (7 checks)
  - 7 DB indexes, PROVENANCE.yml
  - Enhanced PR descriptions
- Add **v5.7.0** release section (2026-04-04):
  - Version bump release
- Add **v5.7.1** release section (2026-04-05):
  - Hunt fix: CLI hunt calls pipeline.hunt() not pipeline.run()
  - 7-day TTL for has_analyzed (repos re-discoverable after cooldown)
  - Page rotation fix in hunt mode
- Mark completed planned items:
  - v5.6.0 planned → ✓ Complete
  - v5.7.0 semantic chunking → ✓ Complete (shipped in v5.6.0)
  - v5.7.0 type-aware hints → ✓ Complete (shipped in v5.6.0)
  - v5.7.0 cross-file resolution → In Progress (this sprint Phase 4)
- Renumber remaining: v5.8.0 Enterprise stays, v5.9.0 Plugin stays
- Update Success Metrics table with v5.7.1 column
- Update Document Metadata

### Step 3: Update project-overview-pdr.md
- Version: 5.5.0 → 5.7.1
- Add v5.6.0/v5.7.x features to Key Features section
- Update Roadmap Alignment section
- Update Document Metadata

### Step 4: Update codebase-summary.md
- Version bump to 5.7.1
- Update file count, LOC, test count stats

### Step 5: Update system-architecture.md
- Version bump to 5.7.1
- Add LLM retry to middleware/provider section if missing

### Step 6: Update README.md
- Version badge: v5.6.0 → v5.7.1
- Test badge: actual test count from Step 1
- Any other stale numbers

### Step 7: Verify
- Read each modified doc, check cross-references consistent
- No broken links

## Todo List

- [x] Gather actual stats (tests, files, LOC)
- [x] Update project-roadmap.md with v5.6.0/v5.7.x releases
- [x] Mark completed planned items in roadmap
- [x] Update project-overview-pdr.md version + features
- [x] Update codebase-summary.md stats
- [x] Update system-architecture.md version
- [x] Update README.md badges
- [x] Cross-check all version references consistent

## Success Criteria

- All docs reference v5.7.1 consistently
- All stats match actual `cargo test` / file count output
- Roadmap planned section contains only genuinely unfinished items
- No broken links or stale cross-references

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stats change during sprint (Phase 4 adds tests) | High | Low | Run Step 1 last, after all code phases complete |
| Miss a doc file with stale version | Low | Low | Grep for "5.5.0" and "5.6.0" across all .md files |
