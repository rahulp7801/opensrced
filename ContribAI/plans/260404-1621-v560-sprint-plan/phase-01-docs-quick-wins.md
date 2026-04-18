# Phase 1: Docs & Quick Wins

## Context
- [docs/project-roadmap.md](../../docs/project-roadmap.md) — says v5.4.2, missing v5.5.0 release
- [README.md](../../README.md) — badge says "355+ tests" but actual count is 355 exactly
- [orchestrator/memory.rs](../../crates/contribai-rs/src/orchestrator/memory.rs) — 9 tables, zero indexes
- [Issue #19](https://github.com/tang-vu/ContribAI/issues/19) — Provenance.yml agent identity

## Overview
- **Priority:** P2
- **Effort:** 4h
- **Risk:** Low — docs + DDL changes only, no logic changes
- **Status:** Pending

## Key Insights

**Roadmap gap:** v5.5.0 shipped multi-file PRs, issue solver, conversation memory, dream profile wiring. Roadmap still lists v5.4.2 as current and v5.5.0 as "Enterprise Scalability" (PostgreSQL, Redis, etc.) — completely wrong. The planned v5.5.0 features never happened; real v5.5.0 is different.

**DB index impact:** Memory.rs has 9 tables with these hot query patterns:
- `submitted_prs WHERE status = ?` (patrol, stats) — full scan
- `submitted_prs WHERE created_at LIKE ?` (daily PR count) — full scan on every pipeline run
- `working_memory WHERE repo = ? AND key = ? AND expires_at > ?` — full scan
- `pr_outcomes WHERE repo = ?` — full scan during dream consolidation
- `pr_conversations WHERE repo = ? AND pr_number = ?` — full scan per patrol check
- `findings_cache WHERE repo = ?` — no index on repo

**Test count:** README badge says "355+" — actual `cargo test --list` returns exactly 355. Minor but factually wrong.

## Requirements

### Functional
1. Roadmap reflects v5.5.0 actual features and correct stats (66 files, ~28K LOC, 355 tests)
2. Planned features renumbered: old v5.5.0 (Enterprise) → v5.7.0+, old v5.6.0 (Advanced Analysis) stays at v5.6.0
3. README badge: "355+ tests" → "355 tests" (or keep 355+ if we add tests in Sprint 2 first)
4. DB indexes added for all hot query paths
5. PROVENANCE.yml added to repo root (optional, low effort, closes #19)

### Non-Functional
- DB indexes must be backward-compatible (existing DBs auto-migrate on next `Memory::open()`)
- No schema version table needed — `CREATE INDEX IF NOT EXISTS` is idempotent

## Architecture

### DB Index Strategy

Add to `SCHEMA` constant in `memory.rs` after table definitions:

```sql
-- Hot path: daily PR count check (every pipeline run)
CREATE INDEX IF NOT EXISTS idx_submitted_prs_created_at ON submitted_prs(created_at);
-- Hot path: patrol + stats filter by status
CREATE INDEX IF NOT EXISTS idx_submitted_prs_status ON submitted_prs(status);
-- Hot path: patrol conversation lookup
CREATE INDEX IF NOT EXISTS idx_pr_conversations_repo_pr ON pr_conversations(repo, pr_number);
-- Hot path: working memory TTL queries
CREATE INDEX IF NOT EXISTS idx_working_memory_repo_key ON working_memory(repo, key);
CREATE INDEX IF NOT EXISTS idx_working_memory_expires ON working_memory(expires_at);
-- Hot path: dream consolidation
CREATE INDEX IF NOT EXISTS idx_pr_outcomes_repo ON pr_outcomes(repo);
-- Hot path: findings cache lookup
CREATE INDEX IF NOT EXISTS idx_findings_cache_repo ON findings_cache(repo);
```

### Roadmap Renumbering

| Old Version | Old Content | New Version |
|-------------|-------------|-------------|
| v5.5.0 | Enterprise Scalability | v5.7.0 |
| v5.6.0 | Advanced Analysis | v5.6.0 (stays) |
| v5.7.0 | Plugin Ecosystem | v5.8.0 |
| v6.0.0 | Full Agent Autonomy | v6.0.0 (stays) |

Insert new entry:
- **v5.5.0** (2026-04-04): Multi-file PRs, issue solver E2E, conversation memory, dream profile wiring

## Related Code Files

| Action | File |
|--------|------|
| Modify | `docs/project-roadmap.md` |
| Modify | `docs/system-architecture.md` (version bump) |
| Modify | `docs/codebase-summary.md` (version bump + stats) |
| Modify | `README.md` (badge fix) |
| Modify | `crates/contribai-rs/src/orchestrator/memory.rs` (add indexes to SCHEMA) |
| Create | `PROVENANCE.yml` (new, closes #19) |

## Implementation Steps

1. **Update `memory.rs` SCHEMA** — append 7 `CREATE INDEX IF NOT EXISTS` statements after the last `CREATE TABLE` block (line ~130, after `pr_conversations` table). No other changes to this file.

2. **Update `docs/project-roadmap.md`:**
   - Change header version from 5.4.2 → 5.5.0
   - Add v5.5.0 release section between v5.4.2 and "Planned Features"
   - Renumber planned features (v5.5.0 Enterprise → v5.7.0)
   - Update Feature Status Matrix version
   - Update Success Metrics table with current actuals (66 files, ~28K LOC, 355 tests)
   - Update Milestone 6 to include v5.5.0 achievements
   - Update remaining tech debt (DB indexes → done after this sprint)

3. **Update `docs/system-architecture.md`** — bump version references from 5.4.2 → 5.5.0

4. **Update `docs/codebase-summary.md`** — bump version, file count (66), LOC (~28K), test count (355)

5. **Fix `README.md`** — change badge from "355+" to "355" (or defer if Sprint 2 adds tests first)

6. **Create `PROVENANCE.yml`** in repo root:
   ```yaml
   provenance: "0.1"
   name: "ContribAI"
   description: "Autonomous AI agent that discovers, analyzes, and submits PRs to open source GitHub projects."
   capabilities:
     - read:code
     - write:code
     - api:github
   constraints:
     - no:pii
     - no:financial:transact
   ```

7. **Verify:** `cargo test` passes (indexes are DDL, no logic change). Close #19 in commit.

## Todo List

- [ ] Add 7 DB indexes to `memory.rs` SCHEMA constant
- [ ] Update `project-roadmap.md` — v5.5.0 release + renumber planned
- [ ] Update `system-architecture.md` — version bump
- [ ] Update `codebase-summary.md` — version bump + stats
- [ ] Fix README badge accuracy
- [ ] Create PROVENANCE.yml (closes #19)
- [ ] Run `cargo test` — confirm all 355 pass
- [ ] Run `cargo clippy` — confirm zero warnings

## Success Criteria

- `cargo test` green, `cargo clippy` clean
- `Memory::open()` on existing DB adds indexes without error (idempotent DDL)
- Roadmap accurately reflects v5.5.0 release with correct stats
- Issue #19 closed

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Index creation on large DB slow | Very Low | Low | SQLite indexes on <1000 rows are instant |
| Schema string too long for rusqlite batch | Very Low | Low | Test with `open_in_memory()` |
| Docs update introduces factual errors | Low | Low | Cross-check git log for v5.5.0 features |

## Security Considerations
- PROVENANCE.yml contains no secrets — public metadata only
- DB indexes do not expose new data paths
