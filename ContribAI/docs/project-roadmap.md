# Project Roadmap

**Current Version:** 5.8.1 | **Release Date:** 2026-04-05 | **Status:** Active Development

---

## Executive Summary

ContribAI is a mature autonomous AI contribution system. Originally built in Python (v0.x–v4.0), it was rewritten in Rust (v5.0.0) for performance, safety, and new capabilities like tree-sitter AST parsing and PageRank file ranking. v5.2.0 added an interactive TUI and full CLI parity. v5.3.0 introduced watchlist mode and 13-language AST. v5.4.0 added dream memory consolidation and risk classification. v5.5.0 delivers multi-file PRs, end-to-end issue solving, and conversation memory. v5.6.0 adds integration tests, LLM retry with backoff, GitHub rate limiter, and the doctor command. v5.7.0–v5.8.0 deliver cross-file import resolution, hunt CLI fix, and full integration test coverage for hunt/patrol. v5.8.1 adds closed-PR failure analysis and outcome-aware quality scoring. The roadmap focuses on enterprise scalability and plugin ecosystem.

---

## Release Timeline

### v0.x Series (2026-03-17 to 2026-03-20) — Foundation Building (Python)

| Version | Date | Milestone | Status |
|---------|------|-----------|--------|
| **v0.1** | 2026-03-17 | Core pipeline (discovery → analysis → generation → PR) | ✓ Complete |
| **v0.4** | 2026-03-18 | Web dashboard + REST API | ✓ Complete |
| **v0.5** | 2026-03-18 | Scheduler + cron automation | ✓ Complete |
| **v0.7** | 2026-03-19 | Multi-LLM support (Gemini, OpenAI, Anthropic, Ollama) | ✓ Complete |
| **v0.11** | 2026-03-20 | Hunt Mode (autonomous multi-round hunting) | ✓ Complete |

---

### v1.x Series (2026-03-20) — Quality & Safety (Python)

| Version | Date | Milestone | Status |
|---------|------|-----------|--------|
| **v1.0** | 2026-03-20 | Official release; quality improvements | ✓ Complete |
| **v1.5** | 2026-03-20 | CLA/DCO handling; compliance automation | ✓ Complete |
| **v1.8** | 2026-03-20 | Cross-file pattern detection + bulk fixes | ✓ Complete |

---

### v2.x Series (2026-03-22 to 2026-03-26) — Learning & Resilience (Python)

| Version | Date | Milestone | Status |
|---------|------|-----------|--------|
| **v2.0** | 2026-03-22 | Safety gates (quality scorer, duplicate prevention) | ✓ Complete |
| **v2.2** | 2026-03-23 | PR Patrol (auto-monitor + auto-fix feedback) | ✓ Complete |
| **v2.4** | 2026-03-25 | Outcome memory (learns from PR results) | ✓ Complete |
| **v2.6** | 2026-03-26 | MCP server (14 tools for Claude Desktop) | ✓ Complete |
| **v2.7** | 2026-03-26 | Event bus (15 typed events) + working memory | ✓ Complete |
| **v2.8** | 2026-03-26 | Context compression + progressive skills | ✓ Complete |

---

### v3.x–v4.x Series (2026-03-26 to 2026-03-28) — Production Hardening (Python)

| Version | Date | Milestone | Status |
|---------|------|-----------|--------|
| **v3.0.0** | 2026-03-26 | EventBus system, Formatter, MCP Client, CLI flags | ✓ Complete |
| **v3.0.4** | 2026-03-28 | Security hardening (constant-time API keys, webhook validation) | ✓ Complete |
| **v3.0.6** | 2026-03-28 | SKIP_DIRECTORIES filter, auto-close linked issues | ✓ Complete |
| **v4.0.0** | 2026-03-28 | Repo Intelligence, Smart Dedup, Issue-First Strategy | ✓ Complete |

---

### v5.0.0 (2026-03-28 to 2026-03-31) — Rust Rewrite ✓

| Sprint | Date | Milestone | Status |
|--------|------|-----------|--------|
| **S1** | 2026-03-28 | Core architecture: config, models, middleware, events, errors | ✓ Complete |
| **S2** | 2026-03-29 | CI Monitor, Outcome Learning, Vertex AI, token cache | ✓ Complete |
| **S3** | 2026-03-30 | Web dashboard (axum), web-server CLI command | ✓ Complete |
| **S4** | 2026-03-30 | GraphQL GitHub, JSONL event log, template+plugin system | ✓ Complete |
| **Parity** | 2026-03-31 | Full Python→Rust feature parity audit + gap implementation | ✓ Complete |

**Key Achievements (v5.0.0):**
- ✓ Complete Python→Rust rewrite: 62 .rs files, ~21,400 LOC, 323 tests
- ✓ Tokio async runtime (replacing Python asyncio)
- ✓ Axum web framework (replacing Python FastAPI)
- ✓ Clap CLI with 21 commands (replacing Python Click)
- ✓ rusqlite for SQLite (replacing Python aiosqlite)
- ✓ serde for serialization (replacing Python Pydantic)
- ✓ MCP server expanded: 21 tools (was 14)
- ✓ API key auth with constant-time comparison
- ✓ HMAC-SHA256 webhook verification
- ✓ 17 analysis skills (5 new vs Python)

---

### v5.2.0 (2026-04-01) — Interactive Login, Rust CI, 4-platform Binaries ✓

**Key Achievements (v5.2.0):**
- ✓ Interactive `contribai login` — switch LLM providers, update tokens, launch wizard
- ✓ One-line install scripts (`install.sh` + `install.ps1`) — auto-detect OS/arch
- ✓ 4-platform release binaries: Linux x86_64, Windows x86_64, macOS Intel, macOS ARM64
- ✓ Rust-first CI pipeline: fmt + clippy -D warnings + 335 tests + cargo audit
- ✓ Python legacy tests only trigger with `[python]` commit label
- ✓ Resolved 24+ clippy warnings, zero-warning strict lint
- ✓ Cross-compilation support for macOS aarch64

---

### v5.1.0 (2026-04-01) — Interactive TUI & Full CLI Parity ✓

**Key Achievements (v5.1.0):**
- ✓ Interactive TUI: ratatui 4-tab browser (Dashboard/PRs/Repos/Actions)
- ✓ Real `notify-test`: live HTTP to Slack, Discord, Telegram
- ✓ Full 22-command CLI (init, login, leaderboard, models, templates, profile, config-get/set/list, system-status, notify-test)
- ✓ Setup wizard (`contribai init`)
- ✓ Config editor (`config-get`, `config-set`, `config-list`)
- ✓ 63 .rs files, ~22,000 LOC, **335 tests**
- ✓ Python moved to `python/` (v4.1.0 legacy, preserved for reference)
- ✓ Root `Cargo.toml` workspace — `cargo build` from project root

### v5.3.0 (2026-04-02) — Watchlist Mode & 13-Language AST ✓

**Key Achievements (v5.3.0):**
- ✓ Watchlist mode: targeted repo scanning for focused ecosystem work
- ✓ Rotating sort order + pagination for diverse discovery across hunt rounds
- ✓ Expanded AST support: 13 languages (was 8) including Ruby, PHP, Bash, YAML, JSON
- ✓ All-language discovery (scan all 15 supported languages by default)
- ✓ Gemini 3.x model support

### v5.4.0 (2026-04-03) — Dream Memory & Risk Classification ✓

**Key Achievements (v5.4.0):**
- ✓ Dream memory consolidation: efficient memory entry consolidation during idle periods
- ✓ Risk classification: Low/Medium/High risk levels for auto-submit control
- ✓ Conversation-aware patrol: maintains context history for intelligent feedback responses
- ✓ Enhanced PR lifecycle management

### v5.4.2 (2026-04-04) — Bug Fixes & Polish ✓

**Key Achievements (v5.4.2):**
- ✓ Auto-clean 404 PRs from patrol monitoring
- ✓ Config-set YAML list values: proper quoting for list items
- ✓ MCP stdout fix: tracing + banner redirected to stderr
- ✓ 65 .rs files, ~26,000+ LOC, **355 tests**
- ✓ 40+ CLI commands (expanded from 22)

### v5.5.0 (2026-04-04) — Multi-File PRs, Issue Solver, Conversation Memory ✓

**Key Achievements (v5.5.0):**
- ✓ Multi-file PR batching: pipeline merges related findings into single multi-file PR
- ✓ Issue solver end-to-end: `solve` command generates code + creates PRs with `Fixes #N` linking
- ✓ PR conversation memory: patrol stores full threads in SQLite, injects history for context-aware LLM responses
- ✓ Dream profile wiring: pipeline filters rejected contribution types using repo outcome history
- ✓ Auto-dream trigger on `run_targeted()` path
- ✓ 66 .rs files, ~28,000 LOC, **355 tests**

### v5.6.0 (2026-04-04) — Integration Tests, Merge Rate, LLM Retry ✓

**Key Achievements (v5.6.0):**
- ✓ Integration test framework: wiremock 0.6 + MockLlm test infrastructure
- ✓ 33+ new tests (388 total): pipeline, patrol, hunt pre-processing paths
- ✓ LLM retry with exponential backoff: configurable retries for transient failures
- ✓ GitHub rate limiter: token-bucket rate limiting for API calls
- ✓ `doctor` command: system health diagnostics (config, LLM, GitHub, DB)
- ✓ DB indexes for hot query paths (analyzed_repos, submitted_prs, pr_outcomes)
- ✓ Semantic code chunking: intelligent truncation respecting AST boundaries

### v5.7.0 (2026-04-05) — Hunt CLI Fix, TTL, Semantic Chunking ✓

**Key Achievements (v5.7.0):**
- ✓ Hunt CLI fix: `hunt` command now calls `pipeline.hunt()` instead of `pipeline.run()`
- ✓ cargo fmt --all: full codebase formatting pass

### v5.8.0 (2026-04-05) — Cross-File Import Resolution, Integration Tests ✓

**Key Achievements (v5.8.0):**
- ✓ Cross-file import resolution: 1-hop resolution for 5 languages (Rust/Python/JS-TS/Go/Java), capped at 20 symbols
- ✓ `symbol_map` wired in pipeline: type context feature now has real data from `extract_symbols()`
- ✓ GitHubClient `with_base_url()`: wiremock-friendly testability without prod code changes
- ✓ Mock GitHub infrastructure: `mock_github.rs` with fixture factories + wiremock helpers
- ✓ Patrol integration tests (5 tests): bot filtering, classification, conversation context, 404 auto-clean, dry-run
- ✓ Hunt integration tests (4 tests): daily limit gate, merge-friendly filter, TTL skip, empty discovery
- ✓ 67 .rs files, ~29,200 LOC, **413 tests**

### v5.8.1 (2026-04-05) — Closed-PR Analysis, Outcome-Aware Scoring ✓

**Key Achievements (v5.8.1):**
- ✓ Closed-PR failure analysis: patrol fetches review comments + CI status for closed-but-not-merged PRs, stores feedback via `memory.record_outcome()`
- ✓ Outcome-aware quality scoring: 8th check `check_outcome_history` adjusts score based on `merge_rate` and `rejected_types`
- ✓ `resolved_imports` field on `RepoContext`: clean cross-file data separated from `symbol_map`
- ✓ Depth guard on `walk_import_nodes` (capped at 8)
- ✓ Pipeline integration test for `process_repo` symbol_map wiring with wiremock
- ✓ 67 .rs files, ~29,577 LOC, **418 tests**

---

## Feature Status Matrix (v5.8.1)

### Core Pipeline

| Feature | Status | Details |
|---------|--------|---------|
| Repository discovery | ✓ Complete | GitHub Search API (REST + GraphQL) |
| Multi-strategy analysis | ✓ Complete | 7 analyzers, 17 skills, framework detection |
| Tree-sitter AST parsing | ✓ Complete | 13 language grammars (Rust-only, v5.3.0) |
| PageRank file ranking | ✓ Complete | Import graph analysis (Rust-only) |
| 12-signal triage | ✓ Complete | Multi-factor issue scoring (Rust-only) |
| LLM-powered generation | ✓ Complete | Multi-provider routing, self-review, quality scoring |
| Risk classification | ✓ Complete | Low/Medium/High for auto-submit control (v5.4.0) |
| Autonomous PR creation | ✓ Complete | Fork, branch, commit, PR, CLA/DCO handling |
| Hunt mode (multi-round) | ✓ Complete | Configurable rounds, delays, deduplication, watchlist (v5.3.0) |
| Dream memory | ✓ Complete | Consolidate memory during idle periods (v5.4.0) |
| Cross-file fixes | ✓ Complete | Bulk fix for pattern repetition |
| Issue-driven solving | ✓ Complete | Fetch + solve open GitHub issues |

### Safety & Compliance

| Feature | Status | Details |
|---------|--------|---------|
| Rate limiting | ✓ Complete | Daily PR limit + API rate respect |
| Quality gate | ✓ Complete | 7-check scorer, 0.6 min threshold |
| Duplicate prevention | ✓ Complete | Fuzzy title matching (>90% = duplicate) |
| AI policy detection | ✓ Complete | Parse CONTRIBUTING.md for AI bans |
| CLA auto-signing | ✓ Complete | CLA-Assistant, EasyCLA |
| DCO signoff | ✓ Complete | Auto-append to all commits |
| Deep validation | ✓ Complete | LLM validates findings vs. file context |
| Webhook verification | ✓ Complete | HMAC-SHA256 signature validation |
| API key auth | ✓ Complete | Constant-time comparison (timing attack safe) |
| Auto-clean 404 PRs | ✓ Complete | Remove stale forks with 404 status (v5.4.2) |

### Platform Features

| Feature | Status | Details |
|---------|--------|---------|
| Web dashboard | ✓ Complete | Axum REST API + static UI at `:8787` |
| Scheduler | ✓ Complete | Tokio-based cron automation |
| Webhooks | ✓ Complete | GitHub webhook receiver with HMAC verification |
| Profiles | ✓ Complete | Named presets (security-focused, docs-focused, etc.) |
| Templates | ✓ Complete | Built-in contribution templates |
| Plugins | ✓ Complete | Trait-based plugin system |
| Notifications | ✓ Complete | Slack, Discord, Telegram |
| MCP server | ✓ Complete | 21 tools for Claude Desktop |
| MCP client | ✓ Complete | StdioMcpClient for external MCP servers |

### Architecture & Internals

| Feature | Status | Details |
|---------|--------|---------|
| Event bus | ✓ Complete | 18 typed events, JSONL file logging |
| Sub-agent registry | ✓ Complete | 5 agents (Analyzer, Generator, Patrol, Compliance, Issue) |
| Context compression | ✓ Complete | 3-tier with language-aware signature extraction |
| Working memory | ✓ Complete | Per-repo cache with 72h TTL |
| Outcome learning | ✓ Complete | PR outcome tracking + repo preferences |
| Error handling | ✓ Complete | thiserror enum hierarchy + graceful recovery |
| Async-first design | ✓ Complete | All I/O via Tokio async |

---

## Completed Milestones

### Milestone 1: MVP (v0.1–v0.11, Python) ✓
- ✓ Pipeline: discovery → analysis → generation → PR
- ✓ 7 multi-strategy analyzers, multi-LLM, hunt mode, web dashboard

### Milestone 2: Safety & Learning (v1.0–v2.8, Python) ✓
- ✓ Quality scoring, CLA/DCO, PR patrol, outcome memory, event bus

### Milestone 3: Production Hardening (v3.0–v4.0, Python) ✓
- ✓ MCP server, enhanced code gen, security hardening, comprehensive docs

### Milestone 4: Rust Rewrite (v5.0.0) ✓
- ✓ Full feature parity with Python (99%+)
- ✓ New Rust-only capabilities (tree-sitter, PageRank, triage, compression)
- ✓ 62 files, ~21,400 LOC, 323 tests, single static binary

### Milestone 5: Full CLI Parity + TUI (v5.2.0) ✓
- ✓ 22 CLI commands (was 21)
- ✓ Interactive ratatui TUI browser
- ✓ Real notification testing (Slack, Discord, Telegram)
- ✓ Setup wizard + config editor commands
- ✓ Python moved to `python/` legacy, root Cargo workspace
- ✓ 335 tests

### Milestone 6: Advanced Features (v5.3.0–v5.5.0) ✓
- ✓ Watchlist mode for targeted repo scanning
- ✓ 13-language AST support (expanded from 8)
- ✓ Dream memory consolidation for efficiency
- ✓ Risk classification for intelligent auto-submit
- ✓ Conversation-aware PR patrol with context
- ✓ Auto-clean 404 PRs from patrol
- ✓ Multi-file PR batching
- ✓ Issue solver end-to-end with `Fixes #N` linking
- ✓ PR conversation memory for context-aware responses
- ✓ 40+ CLI commands, 355 tests, 66 .rs files, ~28,000 LOC

### Milestone 7: Test Coverage & Analysis (v5.6.0–v5.8.1) ✓
- ✓ Integration test framework (wiremock 0.6 + MockLlm)
- ✓ Hunt & patrol integration tests (9 tests covering critical paths)
- ✓ Cross-file import resolution (5 languages, 1-hop, 20-symbol cap)
- ✓ symbol_map wired for type-aware code generation
- ✓ LLM retry with exponential backoff
- ✓ GitHub rate limiter + doctor command
- ✓ DB indexes for hot query paths
- ✓ Closed-PR failure analysis + outcome-aware quality scoring (8-check)
- ✓ 67 .rs files, ~29,577 LOC, 418 tests

---

## Planned Features (v5.9.0+)

### v5.6.0 — Integration Tests & Merge Rate ✓ (Released 2026-04-04)

- [x] Integration test framework (wiremock + MockLlm)
- [x] 20+ integration tests for critical pipeline paths
- [x] Closed-PR failure analysis + merge rate improvements
- [x] DB indexes for hot query paths
- [x] Enhanced quality scoring based on outcome learning

### v5.7.0–v5.8.0 — Advanced Analysis ✓ (Released 2026-04-05)

- [x] Semantic code chunking (not truncation)
- [x] Enhanced tree-sitter analysis (cross-file reference resolution)
- [x] Type-aware code generation hints (symbol_map wired in pipeline)

### v5.9.0 — Enterprise Scalability (Q3 2026)

- [ ] PostgreSQL migration layer (drop-in SQLite replacement)
- [ ] Redis-based distributed rate limiting
- [ ] Prometheus metrics export
- [ ] OpenTelemetry distributed tracing
- [ ] Kubernetes Helm charts

### v5.10.0 — Plugin Ecosystem (Q4 2026)

- [ ] Central plugin registry (GitHub-based)
- [ ] Plugin package format (dynamic Rust libraries / WASM)
- [ ] Pre-built plugins: Django, React, async patterns
- [ ] Plugin security scanning

### v6.0.0 — Full Agent Autonomy (2027 H1)

- [ ] Agent-to-agent communication protocol
- [ ] Self-evaluation + automatic improvement loops
- [ ] Multi-agent coordination (spec → design → implement → test)
- [ ] GitLab/Gitea/Gitee support (pluggable VCS)

---

## Technical Debt

### Resolved by Rust Rewrite

| Item | Status |
|------|--------|
| Refactor analysis pipeline (composition over inheritance) | ✓ Done (traits) |
| Add structured logging (JSON format) | ✓ Done (tracing) |
| AST analysis for structural patterns | ✓ Done (tree-sitter) |
| Type safety throughout codebase | ✓ Done (Rust type system) |

### Remaining

| Item | Effort | Priority | Status |
|------|--------|----------|--------|
| Add database indexes for performance | Small | High | ✓ Done (v5.6.0) |
| Implement integration test suite | Medium | High | ✓ Done (v5.6.0–v5.8.0) |
| Add structured OpenTelemetry spans | Medium | Medium | Planned (v5.9.0) |

---

## Dependency & Risk Assessment

### Key Dependencies

| Dependency | Risk Level | Mitigation |
|-----------|-----------|-----------|
| **Google Gemini API** | Medium | OpenAI/Anthropic/Ollama fallbacks |
| **GitHub API** | Low | Rate limiting, retry, GraphQL fallback |
| **Rust ecosystem** | Low | Stable, growing, excellent tooling |
| **Tokio runtime** | Low | Industry standard async runtime |
| **tree-sitter** | Low | Maintained by GitHub, widely used |

---

## Success Metrics

| Metric | v4.0 (Python) | v5.0 (Rust) | v5.5.0 | v5.8.1 (Current) |
|--------|---------------|-------------|--------|------------------|
| **LOC** | ~5,500 | ~21,400 | ~28,000 | **~29,577** |
| **Files** | 45 | 63 | 66 | **67** |
| **Test count** | ~298 | 323 | 355 | **418** |
| **Binary size** | N/A (interpreted) | ~15MB static | ~4.5MB stripped | ~4.5MB stripped |
| **Startup time** | ~2s | <100ms | ~5ms | ~5ms |
| **Memory usage** | ~80MB | ~20MB | ~8MB | ~8MB |
| **MCP tools** | 14 | 21 | 21 | 21 |
| **CLI commands** | 8 | 21 | 40+ | **40+** |
| **Analysis skills** | 12 | 17 | 17 | 17 |
| **AST languages** | 0 | 8 | 13 | **13** |

---

## Document Metadata

- **Created:** 2026-03-28
- **Last Updated:** 2026-04-05
- **Version:** 5.8.1 (Closed-PR analysis, outcome-aware scoring, cross-file imports, 418 tests)
- **Next Review:** 2026-06-30 (Q2 end)
