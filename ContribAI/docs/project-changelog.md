# Project Changelog

All notable changes to ContribAI (Rust implementation). Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [5.8.1] - 2026-04-05

### Added
- Closed-PR failure analysis: patrol fetches review comments + CI status for rejected PRs, stores feedback via `memory.record_outcome()`
- Outcome-aware quality scoring: 8th check `check_outcome_history` adjusts score based on `merge_rate` and `rejected_types`
- `resolved_imports` field on `RepoContext` for clean cross-file import data (separated from `symbol_map`)
- Depth guard on `walk_import_nodes` (capped at 8)
- Pipeline integration test for `process_repo` symbol_map wiring with wiremock

## [5.8.0] - 2026-04-05

### Added
- Cross-file import resolution: 1-hop resolution for 5 languages (Rust/Python/JS-TS/Go/Java), capped at 20 symbols
- `symbol_map` wired in pipeline: type context feature has real data from `extract_symbols()`
- `GitHubClient::with_base_url()` for wiremock-friendly testability
- Mock GitHub infrastructure: `mock_github.rs` with fixture factories + wiremock helpers
- Patrol integration tests (5): bot filtering, classification, conversation context, 404 auto-clean, dry-run
- Hunt integration tests (4): daily limit gate, merge-friendly filter, TTL skip, empty discovery

## [5.7.0] - 2026-04-05

### Fixed
- Hunt CLI command now calls `pipeline.hunt()` instead of `pipeline.run()`

### Changed
- `cargo fmt --all` full codebase formatting pass

## [5.6.0] - 2026-04-04

### Added
- Integration test framework (wiremock 0.6 + MockLlm)
- 33+ new integration tests (388 total)
- LLM retry with exponential backoff (configurable retries for transient failures)
- GitHub rate limiter: token-bucket rate limiting for API calls
- `doctor` command for system health diagnostics (config, LLM, GitHub, DB)
- DB indexes for hot query paths (`analyzed_repos`, `submitted_prs`, `pr_outcomes`)
- Semantic code chunking: intelligent truncation respecting AST boundaries

## [5.5.0] - 2026-04-04

### Added
- Multi-file PR batching: pipeline merges related findings into single multi-file PR
- Issue solver end-to-end: `solve` command generates code + creates PRs with `Fixes #N` linking
- PR conversation memory: patrol stores full threads in SQLite, injects history for context-aware LLM responses
- Dream profile wiring: pipeline filters rejected contribution types using repo outcome history
- Auto-dream trigger on `run_targeted()` path

## [5.4.2] - 2026-04-04

### Fixed
- Auto-clean 404 PRs from patrol monitoring
- Config-set YAML list values: proper quoting for list items
- MCP stdout fix: tracing + banner redirected to stderr

## [5.4.0] - 2026-04-03

### Added
- Dream memory consolidation: efficient memory entry consolidation during idle periods
- Risk classification: Low/Medium/High risk levels for auto-submit control
- Conversation-aware patrol: maintains context history for intelligent feedback responses

## [5.3.0] - 2026-04-02

### Added
- Watchlist mode: targeted repo scanning for focused ecosystem work
- Rotating sort order + pagination for diverse discovery across hunt rounds
- Expanded AST support: 13 languages (was 8) including Ruby, PHP, Bash, YAML, JSON
- All-language discovery (scan all 15 supported languages by default)
- Gemini 3.x model support

## [5.2.0] - 2026-04-01

### Added
- Interactive `contribai login` — switch LLM providers, update tokens, launch wizard
- One-line install scripts (`install.sh` + `install.ps1`) — auto-detect OS/arch
- 4-platform release binaries: Linux x86_64, Windows x86_64, macOS Intel, macOS ARM64
- Rust-first CI pipeline: fmt + clippy -D warnings + tests + cargo audit

## [5.1.0] - 2026-04-01

### Added
- Interactive TUI: ratatui 4-tab browser (Dashboard/PRs/Repos/Actions)
- Real `notify-test`: live HTTP to Slack, Discord, Telegram
- Full 22-command CLI (init, login, leaderboard, models, templates, profile, config-get/set/list, system-status, notify-test)
- Setup wizard (`contribai init`)
- Config editor (`config-get`, `config-set`, `config-list`)

## [5.0.0] - 2026-03-28 to 2026-03-31

### Added
- Complete Python→Rust rewrite: 62 .rs files, ~21,400 LOC, 323 tests
- Tokio async runtime, Axum web framework, Clap CLI (21 commands)
- rusqlite for SQLite, serde for serialization
- MCP server expanded: 21 tools (was 14)
- API key auth with constant-time comparison
- HMAC-SHA256 webhook verification
- 17 analysis skills (5 new vs Python)
- Tree-sitter AST parsing (8 languages)
- PageRank file ranking via import graph
- 12-signal triage scoring
- 3-tier context compression

---

## Document Metadata

- **Created:** 2026-04-05
- **Last Updated:** 2026-04-05
- **Covers:** v5.0.0 through v5.8.1
