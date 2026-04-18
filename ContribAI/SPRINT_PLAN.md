# ContribAI Sprint & Release Plan

**Current Version:** v6.0.0 | **Date:** 2026-04-11 | **Status:** Active Development

---

## Executive Summary

ContribAI is at **v6.0.0** with a mature Rust codebase (587+ tests, 67+ .rs files, ~30k LOC). The project has completed 16 sprints covering core pipeline, CLI/TUI, AST analysis, memory systems, security, plugins, and i18n. 

This plan outlines **24 sprints** organized into **8 releases** (v6.1.0 → v7.0.0), targeting **Q2-Q4 2026**. Each release is triggered via `gh tag` push to automate GitHub Actions CD.

---

## Release Strategy

### Tagging & CD Workflow
```bash
# Each release triggered by:
git tag -a v6.1.0 -m "Release v6.1.0 — <feature summary>"
git push origin v6.1.0

# GitHub Actions (release.yml) auto-builds:
# - Linux x86_64
# - Windows x86_64  
# - macOS x86_64 (Intel)
# - macOS aarch64 (Apple Silicon)
```

### Release Cadence
- **Minor releases (v6.x.0):** Every 2-3 sprints (~2-3 weeks)
- **Patch releases (v6.x.1):** Bug fixes only (as needed)
- **Major releases (v7.0.0):** Breaking changes or milestone features

---

## Sprint Details

### Release v6.1.0 — Quality & Performance Polish
**Target:** Sprint 17-18 | **Timeline:** 2 weeks | **Tag:** `v6.1.0`

#### Sprint 17: Code Quality & Dead Code Removal
**Priority:** High | **Estimate:** 3-4 days

| Task | Files | Details |
|------|-------|---------|
| Remove Session dead code | `cli/commands/session.rs`, `cli/mod.rs` | Wire Session command or remove module |
| Wire Copilot provider | `llm/provider.rs`, `llm/copilot.rs` | Add Copilot to `create_llm_provider()` factory |
| Fix clippy warnings (6) | Various | Remove unused imports, derive Default, fix unwrap pattern |
| Clean test helper warnings | `tests/common/mock_*.rs` | Remove 14 unused helper functions or mark `#[allow(dead_code)]` |
| Framework detection stub | `analysis/analyzer.rs:136` | Implement basic framework detection from imports |

**Deliverables:**
- 0 clippy warnings (strict lint enforcement)
- Session command either functional or removed
- Copilot provider usable via config
- Framework detection returns non-empty HashSet for Django/Flask/React projects

**Acceptance Criteria:**
```bash
cargo clippy -- -D warnings  # Zero warnings
cargo test                    # All 587+ tests pass
```

---

#### Sprint 18: Performance & Dependency Updates
**Priority:** High | **Estimate:** 3-4 days

| Task | Files | Details |
|------|-------|---------|
| Update tree-sitter version mismatch | `Cargo.toml` | Align core `tree-sitter 0.24` with grammars (currently `0.23`) |
| Update tower 0.4 → 0.5 | `Cargo.toml`, `web/mod.rs` | Compatible with axum 0.7 |
| Add Rust dependabot | `.github/dependabot.yml` | Automated Rust dependency updates |
| Dependency audit | `Cargo.toml` | Review all 60+ deps, update outdated, remove unused |
| Binary size optimization | `Cargo.toml` (profile.release) | Benchmark current size, apply further optimizations |
| Benchmark suite | `benches/pipeline.rs` | Add criterion benchmarks for hot paths |

**Deliverables:**
- All tree-sitter grammars at 0.24
- dependabot PRs for Rust deps
- Binary size < 4.5MB stripped
- Baseline performance benchmarks

**Acceptance Criteria:**
```bash
cargo bench                    # Benchmarks run successfully
gh dependabot list             # Rust repo covered
```

---

### Release v6.2.0 — Documentation & Developer Experience
**Target:** Sprint 19-20 | **Timeline:** 2 weeks | **Tag:** `v6.2.0`

#### Sprint 19: Documentation Overhaul
**Priority:** High | **Estimate:** 3 days

| Task | Files | Details |
|------|-------|---------|
| Update CHANGELOG.md | `CHANGELOG.md` | Add v5.18.0-v6.0.0 entries (currently stops at v5.17.0) |
| Update README.md badges | `README.md` | Fix test count: 418 → 587+ |
| Sync AGENTS.md version refs | `AGENTS.md` | Update v5.8.1 → v6.0.0 throughout |
| Update roadmap docs | `docs/project-roadmap.md` | Mark v5.18.0-v6.0.0 complete, add 2026 Q2-Q4 plans |
| Add RUNBOOK.md emergency procedures | `RUNBOOK.md` | Expand with common failure modes + recovery |
| Add CONTRIBUTING.md dev guide | `CONTRIBUTING.md` | How to add commands, tests, run CI locally |

**Deliverables:**
- All docs reference v6.0.0+
- Accurate README badges
- Complete changelog through v6.0.0
- Developer onboarding guide

---

#### Sprint 20: Developer Experience Improvements
**Priority:** Medium | **Estimate:** 4 days

| Task | Files | Details |
|------|-------|---------|
| Add `make dev` target | `Makefile` | One-command setup: build + test + lint |
| Add pre-commit hooks | `.pre-commit-config.yaml` | Auto-run cargo fmt, clippy, test on commit |
| Add justfile alternative | `justfile` | Modern command runner (optional, alongside Makefile) |
| Improve error messages | `core/error.rs` | User-friendly errors with suggestions (not just "failed") |
| Add `--verbose` flag globally | `cli/mod.rs` | Enable tracing output for debugging |
| Add shell completions | `cli/mod.rs` | Generate bash/zsh/fish/pwsh completions via clap_complete |

**Deliverables:**
- `make dev` runs successfully from fresh clone
- Pre-commit hooks enforce quality gates
- Shell completions available
- Error messages actionable (e.g., "Token invalid. Run `contribai login` to re-authenticate")

---

### Release v6.3.0 — Advanced Analysis & Generation
**Target:** Sprint 21-22 | **Timeline:** 2-3 weeks | **Tag:** `v6.3.0`

#### Sprint 21: Multi-Hop Import Resolution
**Priority:** High | **Estimate:** 4-5 days

| Task | Files | Details |
|------|-------|---------|
| Extend import resolution depth | `analysis/ast_intel.rs` | 1-hop → 2-hop (cap at 50 symbols) |
| Add cross-language imports | `analysis/ast_intel.rs` | Detect FFI bindings (Python→Rust, JS→WASM) |
| Import resolution cache | `analysis/ast_intel.rs` | Cache resolved imports in SQLite (TTL: 24h) |
| Symbol usage frequency | `analysis/ast_intel.rs` | Track which symbols are most referenced |
| Pipeline integration | `orchestrator/pipeline.rs` | Use import graph for smarter file selection |

**Deliverables:**
- 2-hop import resolution (50-symbol cap)
- Cross-language FFI detection
- Import cache reduces analysis time by 30%+
- Pipeline prioritizes files with high import centrality

---

#### Sprint 22: LLM Generation Improvements
**Priority:** High | **Estimate:** 4 days

| Task | Files | Details |
|------|-------|---------|
| Structured output parsing | `generator/engine.rs` | Enforce JSON schema on LLM responses |
| Self-correction loop | `generator/self_review.rs` | Re-generate if validation fails (max 2 retries) |
| Multi-file dependency ordering | `generator/engine.rs` | Ensure edits respect file dependencies (order matters) |
| Diff quality scoring | `generator/validation.rs` | Score generated diffs before submission |
| Reduce false positives | `analysis/triage.rs` | Tune 12-signal scoring to reduce noise |

**Deliverables:**
- 90%+ LLM responses parse correctly (up from ~75%)
- Self-correction reduces invalid PRs by 40%
- Multi-file PRs respect dependency order
- Diff quality gate blocks low-quality submissions

---

### Release v6.4.0 — Enterprise Features
**Target:** Sprint 23-24 | **Timeline:** 3 weeks | **Tag:** `v6.4.0`

#### Sprint 23: PostgreSQL & Redis Support
**Priority:** High | **Estimate:** 5 days

| Task | Files | Details |
|------|-------|---------|
| Database abstraction trait | `orchestrator/db.rs` | Abstract SQLite/PostgreSQL behind common interface |
| PostgreSQL implementation | `orchestrator/db_postgres.rs` | sqlx + tokio-postgres async driver |
| Feature flag for DB backend | `Cargo.toml` | `features = ["sqlite", "postgres"]` |
| Redis cache layer | `llm/cache.rs`, `orchestrator/memory.rs` | Optional Redis for distributed caching |
| Migration system | `orchestrator/migrations.rs` | Schema versioning + auto-migrate on startup |

**Deliverables:**
- Config-selectable SQLite/PostgreSQL backend
- Redis cache for LLM responses (shared across instances)
- Automatic schema migrations
- Feature-gated dependencies (no bloat for SQLite-only users)

**Config Example:**
```yaml
database:
  backend: postgresql  # or sqlite
  url: "postgresql://user:pass@localhost/contribai"
  
cache:
  backend: redis  # or sqlite
  url: "redis://localhost:6379"
```

---

#### Sprint 24: Observability & Monitoring
**Priority:** Medium | **Estimate:** 3 days

| Task | Files | Details |
|------|-------|---------|
| OpenTelemetry tracing | `core/tracing.rs` | Distributed tracing spans for pipeline, LLM, GitHub API |
| Prometheus metrics expansion | `web/mod.rs` | Add 20+ new metrics (latency, error rates, cache hit rate) |
| Grafana dashboard | `docs/grafana-dashboard.json` | Pre-built dashboard JSON for import |
| Health check endpoint | `web/mod.rs` | `/health` endpoint for Kubernetes liveness probes |
| Audit log export | `core/events.rs` | Stream JSONL events to external systems (S3, ELK) |

**Deliverables:**
- Full OpenTelemetry integration
- 30+ Prometheus metrics
- Grafana dashboard template
- Kubernetes-ready health checks

---

### Release v6.5.0 — Plugin Ecosystem
**Target:** Sprint 25-26 | **Timeline:** 3 weeks | **Tag:** `v6.5.0`

#### Sprint 25: Plugin Framework v2
**Priority:** High | **Estimate:** 5 days

| Task | Files | Details |
|------|-------|---------|
| WASM plugin runtime | `plugins/wasm.rs` | wasmtime for sandboxed plugin execution |
| Plugin manifest format | `plugins/manifest.rs` | YAML manifest with metadata, permissions, hooks |
| Plugin registry UI | `cli/tui.rs` | Tab for installed plugins, enable/disable, logs |
| Plugin marketplace schema | `docs/plugin-schema.json` | GitHub-based plugin registry format |
| Security sandboxing | `plugins/sandbox.rs` | Capability-based permissions (read/write/network) |

**Deliverables:**
- WASM-based plugin system (safe, sandboxed)
- Plugin manifest with versioning
- 3 example plugins (Django analyzer, React linter, Go formatter)
- Plugin CLI commands: `plugin install/list/remove/info`

---

#### Sprint 26: Pre-built Plugin Suite
**Priority:** Medium | **Estimate:** 4 days

| Task | Details |
|------|---------|
| Django plugin | Detect models, views, templates; generate migrations |
| React plugin | Component analysis, prop-type validation, hook optimization |
| Go plugin | Interface compliance, error handling patterns, benchmarks |
| Python async plugin | Detect blocking calls, recommend async/await |
| Security scanner plugin | CWE/SAST rules beyond built-in analyzer |

**Deliverables:**
- 5 production-ready plugins
- Plugin documentation + tutorial
- Plugin security guidelines

---

### Release v6.6.0 — Advanced PR Strategies
**Target:** Sprint 27-28 | **Timeline:** 2-3 weeks | **Tag:** `v6.6.0`

#### Sprint 27: PR A/B Testing & Learning
**Priority:** High | **Estimate:** 4 days

| Task | Files | Details |
|------|-------|---------|
| PR title/body variants | `pr/manager.rs` | Test different PR formats (emoji vs no emoji, short vs detailed) |
| Merge rate prediction | `orchestrator/memory.rs` | ML-like scoring based on historical outcomes |
| Contribution type optimization | `orchestrator/memory.rs` | Auto-adjust strategy per repo (some prefer docs, some code) |
| Timing optimization | `scheduler/mod.rs` | Learn best times to submit PRs for visibility |
| Review response analysis | `pr/patrol.rs` | Parse reviewer tone/sentiment to improve future PRs |

**Deliverables:**
- A/B test PR formats
- Predictive merge scoring (confidence %)
- Repo-specific strategy adaptation
- Optimal PR timing recommendations

---

#### Sprint 28: Multi-Repo Coordination
**Priority:** Medium | **Estimate:** 3 days

| Task | Files | Details |
|------|-------|---------|
| Workspace detection | `github/discovery.rs` | Detect monorepos/workspaces (Nx, Cargo, Lerna) |
| Cross-repo PRs | `pr/manager.rs` | Coordinate changes across multiple repos |
| Shared dependency updates | `orchestrator/pipeline.rs` | Update library + all dependent projects |
| Batch PR grouping | `pr/manager.rs` | Group related changes into single PR |

**Deliverables:**
- Monorepo-aware contribution strategy
- Cross-repo dependency updates
- Intelligent PR batching

---

### Release v6.7.0 — Security & Compliance
**Target:** Sprint 29-30 | **Timeline:** 2 weeks | **Tag:** `v6.7.0`

#### Sprint 29: Enterprise Security
**Priority:** High | **Estimate:** 4 days

| Task | Files | Details |
|------|-------|---------|
| Real token encryption | `core/crypto.rs` | Replace XOR with `aes-gcm` crate (AES-256-GCM) |
| SSO/OAuth support | `github/client.rs` | GitHub App authentication flow |
| Audit mode | `cli/mod.rs` | Read-only analysis reporting (no PRs) |
| Compliance policies | `core/compliance.rs` | Enforce org-specific contribution policies |
| Secret scanning | `generator/validation.rs` | Detect leaked secrets in generated code |

**Deliverables:**
- Production-grade AES-256-GCM encryption
- GitHub App OAuth flow (no PAT required)
- Audit-only mode for compliance reviews
- Built-in secret detection

---

#### Sprint 30: Governance & Reporting
**Priority:** Medium | **Estimate:** 3 days

| Task | Files | Details |
|------|-------|---------|
| Activity reports | `cli/mod.rs` | Weekly/monthly contribution summaries |
| ROI metrics | `orchestrator/memory.rs` | Track value delivered (issues closed, bugs fixed) |
| Team dashboards | `web/mod.rs` | Multi-user activity tracking |
| Export to CSV/PDF | `web/mod.rs` | Downloadable reports for management |

**Deliverables:**
- Automated activity reporting
- ROI tracking metrics
- Team collaboration features

---

### Release v7.0.0 — Full Agent Autonomy
**Target:** Sprint 31-40 | **Timeline:** 8-10 weeks | **Tag:** `v7.0.0`

#### Sprint 31-32: Agent Communication Protocol
**Priority:** High | **Estimate:** 8 days

| Task | Files | Details |
|------|-------|---------|
| Agent message bus | `agents/bus.rs` | Pub/sub for inter-agent communication |
| Task delegation | `agents/registry.rs` | Agents can delegate subtasks to specialized agents |
| Shared context | `agents/context.rs` | Agents share analysis results, avoid duplicate work |
| Conflict resolution | `orchestrator/pipeline.rs` | Resolve conflicting agent recommendations |
| Agent orchestration UI | `cli/tui.rs` | Real-time agent activity monitoring |

**Deliverables:**
- 5 agents communicate autonomously
- Task delegation reduces completion time by 40%
- Conflict resolution prevents contradictory PRs

---

#### Sprint 33-34: Self-Improvement System
**Priority:** High | **Estimate:** 8 days

| Task | Files | Details |
|------|-------|---------|
| Outcome analysis | `orchestrator/memory.rs` | Analyze why PRs were merged/rejected |
| Strategy evolution | `orchestrator/pipeline.rs` | Auto-adjust parameters based on outcomes |
| Prompt optimization | `llm/formatter.rs` | A/B test prompts, track success rates |
| Model selection learning | `llm/router.rs` | Auto-choose best model per task type |
| Failure pattern database | `orchestrator/memory.rs` | Store failure modes for prevention |

**Deliverables:**
- Autonomous strategy tuning
- Prompt performance tracking
- Failure pattern recognition
- Self-tuning model selection

---

#### Sprint 35-36: Multi-VCS Support
**Priority:** Medium | **Estimate:** 8 days

| Task | Files | Details |
|------|-------|---------|
| VCS abstraction layer | `github/mod.rs` → `vcs/mod.rs` | Abstract Git/GitLab/Gitea operations |
| GitLab integration | `vcs/gitlab.rs` | Full GitLab API support |
| Gitea integration | `vcs/gitea.rs` | Self-hosted Gitea support |
| Gitee integration | `vcs/gitee.rs` | Chinese platform support |
| Cross-platform discovery | `github/discovery.rs` | Search across multiple VCS platforms |

**Deliverables:**
- Platform-agnostic core (works with GitLab, Gitea, Gitee)
- Unified discovery across platforms
- Platform-specific PR formatting

---

#### Sprint 37-38: Advanced Code Understanding
**Priority:** High | **Estimate:** 8 days

| Task | Files | Details |
|------|-------|---------|
| Semantic code search | `analysis/search.rs` | Embedding-based code retrieval |
| Type inference | `analysis/ast_intel.rs` | Infer types without running code |
| Control flow analysis | `analysis/cfg.rs` | Build control flow graphs |
| Data flow analysis | `analysis/dfa.rs` | Track data dependencies |
| Impact prediction | `analysis/impact.rs` | Predict blast radius of changes |

**Deliverables:**
- Semantic code understanding
- Type-aware generation
- Impact analysis before PR submission

---

#### Sprint 39-40: Autonomous Operation Modes
**Priority:** High | **Estimate:** 8 days

| Task | Files | Details |
|------|-------|---------|
| Goal-directed mode | `orchestrator/goal.rs` | "Improve test coverage to 80%" → autonomous execution |
| Continuous improvement | `orchestrator/pipeline.rs` | Continuously monitor and improve repos |
| Collaboration mode | `pr/manager.rs` | Work alongside human developers |
| Emergency response | `issues/solver.rs` | Rapid response to critical issues |
| Self-evaluation | `orchestrator/review.rs` | Agent reviews its own work before submission |

**Deliverables:**
- Goal-driven autonomous operation
- Real-time collaboration features
- Emergency issue triage + fixing
- Self-evaluation quality gate

---

## Sprint Execution Template

### Pre-Sprint Checklist
- [ ] Review previous sprint deliverables
- [ ] Create sprint branch: `git checkout -b sprint-XX`
- [ ] Update `Cargo.toml` version if needed
- [ ] Run baseline tests: `cargo test`
- [ ] Run clippy: `cargo clippy -- -D warnings`

### During Sprint
- [ ] Commit frequently with descriptive messages
- [ ] Add tests alongside features
- [ ] Update docs as you go
- [ ] Run `cargo fmt` before commits

### Post-Sprint Checklist
- [ ] All tests pass: `cargo test` (expect 600+)
- [ ] Zero clippy warnings: `cargo clippy -- -D warnings`
- [ ] Update CHANGELOG.md with new entry
- [ ] Update version in AGENTS.md, README.md if needed
- [ ] Run integration tests if applicable
- [ ] Create PR to main (if using sprint branches)

### Release Checklist
- [ ] Merge sprint branch to main
- [ ] Final test run: `cargo test && cargo clippy -- -D warnings`
- [ ] Update CHANGELOG.md release date
- [ ] Update version in `Cargo.toml`
- [ ] Commit: `git commit -am "release: vX.Y.Z — <summary>"`
- [ ] Tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z — <summary>"`
- [ ] Push: `git push && git push origin vX.Y.Z`
- [ ] Monitor GitHub Actions build
- [ ] Verify release appears on GitHub
- [ ] Update roadmap docs

---

## Dependency Management

### Critical Dependencies to Monitor
| Dependency | Current | Target | Notes |
|-----------|---------|--------|-------|
| tree-sitter | 0.24 core, 0.23 grammars | 0.24 all | Mismatch causes warnings |
| tower | 0.4 | 0.5 | Compatible with axum 0.7 |
| axum | 0.7 | 0.8 (when available) | Monitor for updates |
| rusqlite | 0.31 | Latest | Stable, low churn |
| tokio | 1 | Latest | Always stay current |
| tree-sitter-* | 0.23 | 0.24 | Align with core |

### Dependabot Schedule
```yaml
# Add to .github/dependabot.yml
- package-ecosystem: "cargo"
  directory: "/crates/contribai-rs"
  schedule:
    interval: "weekly"
    day: "monday"
  open-pull-requests-limit: 10
  reviewers:
    - "tang-vu"
```

---

## Risk Management

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| LLM API cost increases | High | Improve cache, add budget controls |
| GitHub API rate limits | Medium | GraphQL batching, token rotation |
| Dependency breakage | Low | Strict version pinning, CI catches issues |
| Binary size growth | Medium | Regular profiling, tree-shaking audits |
| Test suite slowdown | Medium | Parallel test execution, flaky test monitoring |

### Schedule Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Sprint scope creep | High | Strict acceptance criteria, defer to next sprint |
| Complex features take longer | Medium | Break into smaller deliverables, use feature flags |
| Contributor availability | Low | Document thoroughly, async-friendly workflow |

---

## Success Metrics

### Per-Release Targets
| Metric | v6.1.0 | v6.2.0 | v6.3.0 | v6.4.0 | v6.5.0 | v6.6.0 | v6.7.0 | v7.0.0 |
|--------|--------|--------|--------|--------|--------|--------|--------|--------|
| **Test count** | 600+ | 620+ | 650+ | 680+ | 700+ | 720+ | 750+ | 800+ |
| **Clippy warnings** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Binary size** | <4.5MB | <4.5MB | <4.5MB | <5.0MB | <5.5MB | <5.5MB | <5.5MB | <6.0MB |
| **CLI commands** | 42+ | 44+ | 45+ | 48+ | 50+ | 52+ | 54+ | 60+ |
| **LLM providers** | 7 | 7 | 7 | 7 | 7 | 7 | 8 | 10+ |
| **Languages** | 13 | 13 | 13 | 13 | 13 | 13 | 13 | 15+ |
| **Plugins** | 0 | 0 | 0 | 0 | 5+ | 8+ | 10+ | 15+ |
| **VCS platforms** | 1 | 1 | 1 | 1 | 1 | 1 | 4 | 4+ |

### Quality Gates (Every Release)
- ✅ All tests pass
- ✅ Zero clippy warnings
- ✅ Zero cargo audit vulnerabilities
- ✅ Documentation updated
- ✅ CHANGELOG.md current
- ✅ Release binary tested on all 4 platforms

---

## Quick Reference Commands

### Daily Development
```bash
# Run tests
cargo test

# Lint
cargo clippy -- -D warnings

# Format
cargo fmt --all

# Build
cargo build --release

# Run specific test
cargo test hunt_integration

# Check for vulnerabilities
cargo audit
```

### Release Process
```bash
# 1. Ensure clean state
git status
git diff HEAD

# 2. Run quality checks
cargo test && cargo clippy -- -D warnings && cargo audit

# 3. Update version
# Edit crates/contribai-rs/Cargo.toml
# Edit CHANGELOG.md

# 4. Commit
git commit -am "release: vX.Y.Z — <summary>"

# 5. Tag
git tag -a vX.Y.Z -m "Release vX.Y.Z — <summary>"

# 6. Push (triggers CD)
git push && git push origin vX.Y.Z

# 7. Monitor
gh run list --limit 5
gh release view vX.Y.Z
```

### Emergency Rollback
```bash
# Delete tag
git tag -d vX.Y.Z
git push --delete origin vX.Y.Z

# Or revert commit
git revert HEAD
```

---

## Appendix: Feature Request Backlog

### Future Releases (Post-v7.0.0)
- **v7.1.0:** Visual Studio Code extension
- **v7.2.0:** Team collaboration features
- **v7.3.0:** Advanced analytics dashboard
- **v8.0.0:** Multi-agent swarms (10+ cooperating agents)

### Nice-to-Have (Low Priority)
- macOS Homebrew formula
- Windows winget package
- Docker image on GHCR
- Nix flake support
- contribai cloud service

---

## Document Metadata

- **Created:** 2026-04-11
- **Last Updated:** 2026-04-11
- **Version:** Planning for v6.1.0 → v7.0.0
- **Next Review:** End of Sprint 17 (v6.1.0 release)
- **Owner:** tang-vu@users.noreply.github.com
