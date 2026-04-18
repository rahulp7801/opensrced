---
title: "Phase 2: Public-Facing Files"
status: completed
completed: 2026-04-05
effort: 30m
---

# Phase 2: Public-Facing Files

Update README.md and AGENTS.md to v5.8.1.

## Files to Modify

### 1. `README.md`

**Changes:**
- Line 8: version badge `v5.8.0` → `v5.8.1`
- Line 10: test badge `413_tests` → `418_tests`
- Line 68: quality scoring description: add `8-check` (currently says `7-check` implicitly via "scoring")
- Line 263: architecture tree comment `v5.5.0` → `v5.8.1`
- Line 295: test count `388 tests` → `418 tests`
- Line 305-306: test section `388 tests` → `418 tests`

### 2. `AGENTS.md`

This file is very outdated (v5.4.0). Major updates needed:

**Header area:**
- Line 14: `v5.4.0` → `v5.8.1`

**Tech Stack table:**
- Tests row: `335+` → `418`

**Project Structure:**
- Line 38: `v5.4.0` → `v5.8.1`
- Line 43: `22 commands` → `40+ commands`
- Line 49: `15 typed events` → `18 typed events`
- Line 77: `v5.4.0` → `v5.8.1`
- Line 78: `335+ Rust tests` → `418 Rust tests`

**Architecture section:**
- Line 89: `v5.4.0` → `v5.8.1`
- Line 97: `23 commands` → `40+ commands`
- Line 106: `15 typed events` → `18 typed events`
- Add key patterns for v5.5.0-v5.8.1 features:
  - Multi-file PR batching
  - Issue solver
  - Cross-file import resolution
  - Closed-PR failure analysis
  - Outcome-aware quality scoring

**CLI Commands table:**
- Line 179: `23 total` → `40+ total`
- Add missing commands (doctor, config-get/set/list, etc.)

**Testing section:**
- Line 210: `353+` → `418`

## Success Criteria

- Both files reference v5.8.1
- Test counts accurate (418)
- AGENTS.md reflects current 40+ commands, 18 events, 67 files
