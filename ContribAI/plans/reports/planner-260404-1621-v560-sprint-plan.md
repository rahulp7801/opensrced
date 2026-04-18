# Planner Report: v5.6.0 Sprint Plan

**Status:** DONE
**Plan:** `plans/260404-1621-v560-sprint-plan/`

## Summary

Created 4-sprint plan for v5.6.0 based on thorough codebase analysis. All phase files include implementation steps, risk assessment, success criteria, and todo checklists.

## Artifacts Created

| File | Purpose |
|------|---------|
| `plan.md` | Overview, dependency graph, rollback plan, file ownership matrix |
| `phase-01-docs-quick-wins.md` | Roadmap v5.5.0 update, 7 DB indexes, README fix, PROVENANCE.yml |
| `phase-02-integration-tests.md` | 20+ integration tests with wiremock + MockLlm, zero network deps |
| `phase-03-merge-rate-improvements.md` | Closed-PR failure analysis, 5 concrete improvements |
| `phase-04-advanced-analysis.md` | Semantic chunking, 1-hop import resolution, type-aware generation |

## Key Findings

1. **Roadmap is stale.** Says v5.4.2, actual is v5.5.0. Planned v5.5.0 content (Enterprise: PostgreSQL, Redis) never shipped — real v5.5.0 is multi-file PRs + issue solver. Needs renumbering.

2. **Zero DB indexes.** 9 tables, hot queries on `submitted_prs.status`, `submitted_prs.created_at`, `working_memory.repo+key`, `pr_conversations.repo+pr_number`. Quick fix: 7 `CREATE INDEX IF NOT EXISTS` statements.

3. **Closed PR failure modes cluster into 5 patterns:**
   - 29% low-value docs PRs (always rejected by maintainers)
   - 21% false positives (LLM hallucinated bugs)
   - 21% cross-run duplicates (same repo targeted twice)
   - 14% bad repo selection (archived, dead)
   - 14% trivial changes

4. **Test count discrepancy:** README badge says "355+" but `cargo test --list` returns exactly 355. Minor.

5. **Integration test strategy:** GitHubClient is a concrete struct (not a trait). Mocking at HTTP level with `wiremock` avoids refactoring 15+ call sites.

6. **YAGNI applied to Sprint 4:** Dropped Code2Vec embeddings and multi-turn LLM conversations from scope. Kept semantic chunking + 1-hop import resolution + type hints.

## Concerns

- Phase 4 is highest risk — changes to core analysis affect all downstream quality. Recommend thorough A/B testing before enabling globally.
- Phase 3 bug verification adds 1 extra LLM call per contribution. Cost impact ~30% more LLM spend. Consider making it conditional (borderline scores only).
