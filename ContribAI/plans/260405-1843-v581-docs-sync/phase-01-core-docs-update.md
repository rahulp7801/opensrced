---
title: "Phase 1: Core Docs Update"
status: completed
completed: 2026-04-05
effort: 45m
---

# Phase 1: Core Docs Update

Update 4 core documentation files to v5.8.1.

## Files to Modify

### 1. `docs/codebase-summary.md`

**Changes:**
- Line 3: `5.8.0` → `5.8.1`, `~29,200` → `~29,577`, `413` → `418`
- Line 208: test count `413` → `418`
- Line 308: test coverage line `413 tests across 67 source files (includes 9 integration tests` → `418 tests across 67 source files (includes 45 integration tests`
- Line 326-327 metadata: version → 5.8.1, description update
- Add to Module Responsibilities table (generator row): mention 8-check scorer (was 7)
- Add to pr row: mention closed-PR failure analysis

### 2. `docs/system-architecture.md`

**Changes:**
- Line 1: `5.8.0` → `5.8.1`
- Line 11: pipeline banner `v5.8.0` → `v5.8.1`
- Line 60: quality scoring line: `7-check gate` → `8-check gate (7 code + 1 outcome history)`
- Add after line 65 (before filter): `│ │  ├─ Outcome-aware scoring: penalty if type in rejected_types  │`
- Add to POST-PROCESSING section (line 86 area): `│ ├─ Closed-PR failure analysis (review + CI feedback → memory)  │`
- Line 496-497 metadata: version → 5.8.1

### 3. `docs/code-standards.md`

**Changes:**
- Line 1: `5.5.0` → `5.8.1`
- Line 15: `355+` → `418`
- Line 417: `355 tests across 65 source files` → `418 tests across 67 source files`
- Line 578-579 metadata: version → 5.8.1, test count, file count

### 4. `docs/project-roadmap.md`

**Changes:**
- Line 1: `5.8.0` → `5.8.1`
- Add v5.8.1 section after v5.8.0 (line ~173):
  ```
  ### v5.8.1 (2026-04-05) — Closed-PR Analysis, Outcome Scoring ✓
  
  **Key Achievements (v5.8.1):**
  - ✓ Closed-PR failure analysis: patrol fetches review comments + CI status, stores feedback
  - ✓ Outcome-aware quality scoring: 8th check adjusts score by merge_rate + rejected_types
  - ✓ resolved_imports field on RepoContext (clean cross-file data, no symbol_map pollution)
  - ✓ Depth guard on walk_import_nodes (capped at 8)
  - ✓ Pipeline integration test for process_repo symbol_map wiring
  - ✓ 67 .rs files, ~29,577 LOC, **418 tests**
  ```
- Update Milestone 7 description to include v5.8.1
- Check off items in v5.6.0 planned section:
  - `[ ] Closed-PR failure analysis + merge rate improvements` → `[x]`
  - `[ ] Enhanced quality scoring based on outcome learning` → `[x]`
- Update Success Metrics table: v5.8.0 column → v5.8.1, LOC/tests/etc
- Update metadata at bottom

## Success Criteria

- All 4 files reference v5.8.1
- Test count = 418 everywhere
- LOC = ~29,577 everywhere
- v5.8.1 features documented (closed-PR analysis, outcome scoring)
