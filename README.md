# opensrcer

**Find bugs. Fix them. Prove it works.**

opensrcer is an AI-powered autonomous contribution agent. Point it at any GitHub repository — public or private — and it scans for vulnerabilities, open issues, and Dependabot alerts. When it finds something actionable, it dispatches an agentic AI pipeline that:

1. **Explores the codebase** using tree-sitter AST indexing, graph knowledge queries, grep, and definition/reference lookup
2. **Reads contribution guidelines** (CONTRIBUTING.md, PR templates, branch conventions) before writing anything
3. **Generates a minimal patch** with a structured diagnosis, diff, PR title, and PR body
4. **Reviews its own work** via Gemini 2.0 Flash (correctness, security, completeness)
5. **Scans for leaked secrets** via Gitleaks before pushing any code
6. **Runs the repo's test suite** (npm, pytest, go test, cargo test)
7. **Opens a verified draft PR** — only if every prior step passes

If the tests fail or secrets are found, the PR is blocked and the dashboard shows you exactly why.

---

## Table of Contents

- [Core Features](#core-features)
- [How It Works — End to End](#how-it-works--end-to-end)
- [Architecture](#architecture)
- [Dashboard Pages](#dashboard-pages)
- [The Two Dispatch Paths](#the-two-dispatch-paths)
- [The MCP Server (Code Intelligence)](#the-mcp-server-code-intelligence)
- [The Auto-PR Pipeline](#the-auto-pr-pipeline)
- [Issue Scanner & Scorer](#issue-scanner--scorer)
- [Scope Classifier](#scope-classifier)
- [Discovery Pipeline](#discovery-pipeline)
- [Graph Intelligence System](#graph-intelligence-system)
- [Crucible — Private Repository Mode](#crucible--private-repository-mode)
- [Security Model](#security-model)
- [Design System](#design-system)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Honest Limits](#honest-limits)
- [License](#license)

---

## Core Features

### Agentic Deep Solve

Claude Code explores codebases autonomously using a custom MCP server backed by tree-sitter AST indexing and optional graph-powered structural analysis. During a solve, Claude calls `repo_info`, `list_files`, `read_file`, `grep`, `find_definition`, `find_references`, `trace_flow`, `impact_analysis`, and `explain_area` against a shallow clone until it has enough context to propose a fix. It then produces a structured response with section headers the auto-PR pipeline parses directly into the pull request.

The entire interaction — every tool call, every reasoning step — is streamed live to a dispatch log you can watch in the dashboard.

### Verified Patches

"Verified" means **the repo's own test suite passed on the patched code**. Not a self-assessment from the AI — an actual `npm test` / `pytest` / `go test` / `cargo test` run against the modified source tree. The pipeline detects the correct ecosystem automatically and runs the appropriate command chain.

If a repo has no tests, opensrcer says so rather than faking a green check.

### Five-Tier Diff Application

LLM-generated diffs fail in predictable ways. Rather than giving up at the first `git apply` failure, the pipeline tries five strategies in sequence:

| Tier | Strategy | What it handles |
|------|----------|-----------------|
| 1 | `git apply --index --recount` (strict) | Clean, accurate diffs |
| 2 | `+ --ignore-whitespace` | Claude subtly altered spacing or tabs |
| 3 | `+ --3way` (after deepening the shallow clone to 50 commits) | Context lines drifted since the clone |
| 4 | `+ --3way --ignore-whitespace` | Combined whitespace + drift |
| 5 | GNU `patch -p1 --fuzz=3` | Claude wrote the hunk header with the wrong starting line |

### Contribution-Aware PRs

Before writing a single line of code, the agentic prompt instructs Claude to look for `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and related files. It extracts:

- **Target branch** — some repos require PRs against `develop` or `next`, not `main`
- **PR title format** — Conventional Commits (`fix:`, `feat:`), issue refs, subject line limits
- **Commit conventions** — sign-off requirements, DCO, CLA hints
- **Required tests** — "add a test", "run `make lint`"
- **Style rules** — formatter, import order, line length

This context feeds directly into the PR title and body, so the contribution looks native to the repo's workflow.

### Base Branch Resolution

The auto-PR pipeline doesn't naively target the repo's default branch. Instead:

1. Fetch the last 30 merged PRs. If ≥ 80% target the same branch → use that (catches GitFlow repos where `develop` is the real target). Requires at least 5 data points for the percentage to be meaningful.
2. Fall back to the repo's `default_branch` metadata
3. Last resort: `main`

This prevents PRs from landing on the wrong branch in repos with non-standard branching strategies.

### Gemini Self-Review

After Claude generates a patch, Gemini 2.0 Flash reviews it for correctness, security issues, and completeness — 3–8 bullet points max. The review is logged in the dispatch output but never blocks the PR. It's advisory context for whoever reviews the draft. Diffs are truncated to 30,000 characters to stay within Gemini's context window.

### Gitleaks Secret Scanning

Before any PR is pushed, `gitleaks dir` scans the worktree for hardcoded secrets (API keys, passwords, tokens). **This is a hard gate** — if any secrets are detected, the PR is blocked entirely. Findings are redacted in the log (first/last 4 characters only). If Gitleaks is not installed, the scan is gracefully skipped.

### Security Advisory Remediation

Advisories and Dependabot alerts aren't just listed — they go through a specialized prompt that identifies the vulnerable dependency, determines the fix (usually a version bump), checks compatibility with the codebase, and produces a PR body referencing the CVE.

### Codebase Explorer

Ask plain-English questions about any GitHub repo. The explore feature streams Claude's tool activity live — you see which files it greps, which definitions it looks up — then renders the answer with syntax-highlighted code snippets.

### Discover

Search all of GitHub for repositories with solvable issues. Filter by star count, language, and recency. Every discovered issue is scored and classified by category, severity, complexity, and scope — then one-click dispatched to the agentic pipeline.

### Graph Intelligence

Build a structural knowledge graph of any repository using graphify (with code-review-graph as a fallback for large repos). Query execution flows, blast radius, module boundaries, and shortest paths — all at zero LLM cost. The graph is exposed as MCP tools (`trace_flow`, `impact_analysis`, `explain_area`) so Claude can use structural understanding during solves.

### Private Repos (Crucible)

Connect a GitHub Organization through a dedicated GitHub App. opensrcer scans private repos with short-lived installation tokens (60-min TTL, per-org scope, revocable anytime). Tokens are re-minted at PR-open time so long agentic runs don't fail on token expiry. Test-gated PRs are enforced: patches that break the test suite never reach GitHub.

### Input Sanitization

All user-facing inputs pass through dedicated sanitization utilities (`lib/sanitize.ts`):
- **Prompt injection defense** — control characters stripped, excessive whitespace collapsed, input capped at 5000 chars
- **Repo ID validation** — only alphanumeric, hyphens, underscores, dots allowed; path traversal rejected
- **File path sanitization** — `../` and dangerous characters stripped
- **Commit message sanitization** — newlines stripped, length capped at 200 chars
- **Branch name and PR number validation** — git-safe character enforcement

---

## How It Works — End to End

Here's the complete lifecycle of a single issue being fixed through the agentic path:

```
1. USER visits /discover
   → Clicks "Scan" (stars ≥ 100, language: Python, 12 repos)
   → Backend: gh search repos → fan out to gh issue list per repo
   → Each issue scored: category, severity, complexity, solvability, scope
   → Stale-open detection: issues with "fixed in PR #N" comments filtered out
   → Assigned issues filtered out (someone's already working on it)

2. USER picks an issue: "Fix TypeError in parse_config() when config is empty"
   → Clicks "Deep solve"
   → POST /api/run/agentic { repo_url, issue_number }

3. SERVER resolves credentials from the user's session:
   → GitHub token from Auth0 session cookie
   → Anthropic API key from AES-256-GCM encrypted cookie
   → Gemini key from encrypted cookie (optional, for self-review)
   → Budget cap from encrypted cookie (default $2)

4. AGENTIC DISPATCHER spawns Claude Code in headless mode:
   → claude -p <prompt> --mcp-config .mcp.json
     --max-budget-usd 2 --output-format stream-json
     --strict-mcp-config --permission-mode bypassPermissions
     --no-session-persistence --verbose
   → Log starts streaming to .dispatches/d_<timestamp>_<uuid>.log
   → 30-minute wall-clock kill switch armed

5. CLAUDE explores via MCP tools:
   → repo_info("owner/name")          → 847 files, Python, MIT license
   → list_files(glob: "CONTRIBUTING*") → CONTRIBUTING.md found
   → read_file("CONTRIBUTING.md")     → "PRs target main, use fix: prefix"
   → grep("parse_config")             → 4 hits in 2 files
   → find_definition("parse_config")  → src/config.py:47 [python function]
   → read_file("src/config.py", 40-70)
   → read_file("tests/test_config.py")

6. CLAUDE produces structured output:
   ## Conventions           → Extracted from CONTRIBUTING.md
   ## Diagnosis             → Root cause at file:line with explanation
   ```diff                  → The patch
   ## Risk / Test           → What to verify, which tests pass
   ## PR title              → "fix: handle None from yaml.safe_load()"
   ## PR body               → Full markdown PR body with "Fixes #47"

7. Claude exits 0 → dispatch status: "succeeded"
   → Auto-PR pipeline fires asynchronously (250ms delay for log flush)

8. AUTO-PR PIPELINE:
   → Extract diff from dispatch log (fenced ```diff block)
   → Locate cached shallow clone at ~/.contribai/repos/owner__name/
   → Create user's fork: gh repo fork owner/name
   → Create git worktree on new branch: opensrcer/issue-47-<suffix>
   → Apply diff (five-tier ladder — strict first, GNU patch last resort)
   → Gitleaks secret scan (hard gate — blocks PR if secrets found)
   → Gemini reviews the diff (advisory, non-blocking)
   → (Crucible only) Run test suite: pytest -x -q → all 47 tests pass
   → Resolve base branch: 24/30 merged PRs target 'main' → main
   → git commit -m "fix: handle None from yaml.safe_load()"
   → git push to fork
   → gh pr create --draft --base main
   → PR URL appended to dispatch log
   → Worktree cleaned up

9. DASHBOARD updates on next poll:
   → Dispatch shows PR chip: "PR #48 opened" (green)
   → Click through to review the draft PR on GitHub
   → Mark "Ready for review" when satisfied
   → Maintainer reviews, CI passes, merges ✓
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                   Next.js 15 (App Router, React 19)              │
│                                                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ Discover  │ │  Issues   │ │ Dispatches│ │  Crucible  │ ...   │
│  │  Scanner  │ │  Scanner  │ │  + Logs   │ │ (Private)  │       │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘       │
│        ↕              ↕              ↕              ↕            │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                  API Routes (/api/*)                      │    │
│  │  Token resolution · key decryption · dispatcher calls     │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                             ↕                                    │
│  ┌──────────────┐   ┌──────────────────┐   ┌───────────────┐   │
│  │    Auth0     │   │  Dispatcher      │   │   Agentic     │   │
│  │   Session    │   │  (contribai.exe) │   │  Dispatcher   │   │
│  │   + Token    │   │  deterministic   │   │ (claude -p)   │   │
│  └──────────────┘   └──────────────────┘   └───────┬───────┘   │
│                                                     ↕           │
│                                              ┌──────────────┐   │
│                                              │  MCP Server   │   │
│                                              │ (repo-tools)  │   │
│                                              │ tree-sitter   │   │
│                                              │  + git grep   │   │
│                                              │  + graphify   │   │
│                                              └───────┬──────┘   │
│                                                      ↕           │
│                 ┌──────────────┐              ┌──────────────┐   │
│                 │   Graphify   │              │ Shallow Clone │   │
│                 │  Knowledge   │              │    Cache      │   │
│                 │    Graph     │              │~/.contribai/  │   │
│                 │~/.opensrcer/ │              │   repos/      │   │
│                 │ graph-cache/ │              └──────────────┘   │
│                 └──────────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
                              ↕
                  ┌──────────────────────┐
                  │  GitHub API / gh CLI │
                  │   Fork · Push · PR   │
                  └──────────────────────┘

Storage: zero database. All state derived from:
  .dispatches/*.log         - append-only dispatch logs
  .dispatches/*.json        - counters, caches, org mappings
  ~/.contribai/repos/       - shallow clone cache (24h TTL)
  ~/.opensrcer/graph-cache/ - graphify knowledge graphs
  Browser httpOnly cookie   - encrypted API keys (AES-256-GCM)
```

### Key Design Decisions

- **No database.** All state is derived from append-only log files and small JSON caches in `.dispatches/`. Dispatches survive process restarts (logs on disk), but lose process handles (can't cancel a dispatch owned by a previous server instance).
- **No env fallbacks for secrets.** GitHub tokens, Anthropic keys, Gemini keys — all come from the authenticated user's session or encrypted cookie. The server's own env vars are `delete`d before spawning child processes. This prevents accidental credential leakage across users.
- **Two dispatch paths.** The deterministic path (contribai.exe) does pre-attach context collection + a single LLM one-shot — fast, cheap, but limited to well-scoped leaf fixes. The agentic path (claude -p + MCP) lets the AI drive its own exploration loop — slower, more expensive, but handles multi-file problems and unfamiliar codebases.
- **Layered clone caching.** The MCP server clones once and reuses for 24 hours. Worktrees provide isolated checkouts for each dispatch without disturbing the shared clone that the MCP server keeps indexing from.
- **Multi-tier resilience.** Diff application, definition lookup, graph building, and test execution all have explicit fallback chains. The system degrades gracefully — missing tools are skipped rather than causing failures.

---

## Dashboard Pages

| Route | Purpose | Auth required |
|-------|---------|---------------|
| `/` | Public landing page — animated stats, dispatch demo, explore demo, Crucible pitch, security section | No |
| `/login` | Auth0 login page — permissions, privacy, GitHub social connection | No |
| `/demo` | Pre-recorded dispatch replay — no API key needed | No |
| `/discover` | Cross-repo issue search — filter by stars, language, recency. Issues scored by category, severity, complexity, solvability, scope | API routes gated |
| `/explore` | Plain-English codebase Q&A with live tool streaming | API routes gated |
| `/issues` | Single-repo issue scanner with scope-based solve recommendations | API routes gated |
| `/dispatches` | Live log streaming, pipeline timeline, PR status chips, cancel, export | API routes gated |
| `/trigger` | Manual dispatch trigger — repo URL, mode selector, dry-run toggle | API routes gated |
| `/graph` | Build and query graphify knowledge graphs — interactive force-directed visualization, command palette for graph queries, LLM-powered natural language Q&A | API routes gated |
| `/prs` | Pull requests opened by the agent (derived from dispatch logs) | API routes gated |
| `/repos` | Repositories the agent has contributed to | API routes gated |
| `/runs` | Agent run history with duration, tokens used, model | API routes gated |
| `/stats` | Dispatches, patches, PRs, success rate, total API spend, biggest contributions | API routes gated |
| `/crucible` | Connect orgs, manage API keys, set spend limits | API routes gated |
| `/crucible/orgs/[org]/repos/[repo]` | Private-repo view: advisories, issues, explore | API routes gated |

**Note on auth gating:** The page shells themselves are public (they load as static HTML instantly), but all data is fetched through API routes that require a valid Auth0 session. This separation gives instant page loads while maintaining security.

---

## The Two Dispatch Paths

### 1. Deterministic Path (`lib/dispatcher.ts`)

Spawns the Rust `contribai.exe` binary as a subprocess. ContribAI:
- Collects relevant file context via its own pre-attach heuristic (top 5 files by relevance)
- Builds a focused prompt with the collected context
- Makes a single LLM call (one-shot)
- Writes a structured contribution to stdout

**Best for:** Well-scoped, single-file bug fixes where the affected file is obvious from the issue.

**Modes:**
| Mode | CLI args | What it does |
|------|----------|-------------|
| `target` | `target <url>` | Scan a single repo for issues |
| `solve` | `solve <url> --issue N` | Fix a specific issue |
| `hunt` | `hunt` | Scan multiple repos for fixable issues |

**Subprocess hygiene:**
- All sensitive env vars (`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) are deleted then selectively re-injected from the requesting user's credentials only
- `CONTRIBAI_DISABLE_SELF_REVIEW=1` to skip the Rust binary's built-in LLM self-review
- `CONTRIBAI_DRAFT_PR=1` to always create draft PRs
- `CONTRIBAI_DRAFT_DIR` set for dry-run solves (JSON draft output)

### 2. Agentic Path (`lib/agentic-dispatcher.ts`)

Spawns `claude -p` (Claude Code in headless print mode) with the opensrcer MCP server attached. Claude drives its own exploration loop through tool calls until it decides it has enough context.

**Best for:** Multi-file bugs, unfamiliar codebases, issues requiring cross-reference analysis, security vulnerability remediation.

**Guardrails:**
- `--max-budget-usd` hard cap (default $2, configurable via `OPENSRCER_AGENTIC_BUDGET_USD`)
- 30-minute wall-clock timeout (kills entire process tree via `taskkill /F /T` on Windows, `SIGKILL` on Unix)
- `--strict-mcp-config` prevents Claude from picking up user-global MCP servers
- `--no-session-persistence` keeps each dispatch isolated
- `--output-format stream-json` for structured parsing of Claude's output
- All env credentials sanitized — only user-provided keys injected

**Stream parsing:**
The `pipeStreamJson()` function parses Claude's stream-json output line by line, extracting `assistant` text blocks and `result` events (with total cost). Non-JSON lines are written raw as a fallback.

**Security finding dispatch:**
`startFindingDispatch()` is a parallel entry point for security advisories/Dependabot alerts. Same mechanics but a tailored prompt focused on vulnerability remediation:
- Identify the dependency/code affected
- Determine the fix (usually a version bump)
- Check compatibility with the codebase
- Produce a diff + PR title + body with CVE references

### Dispatch Lifecycle

Both paths share the same lifecycle model:

```
Start → Running → Succeeded | Failed | Killed
                      ↓
              Auto-PR pipeline
                      ↓
          PR opened | PR failed | PR pending
```

Every dispatch gets:
- A unique ID: `d_<ISO-timestamp>_<uuid6>` (e.g., `d_2026-04-19T04-43-08_55ae24`)
- A log file at `.dispatches/<id>.log` — append-only, human-readable
- An in-memory registry entry with PID, status, and process handle

The log file is the source of truth. When the server restarts, it reconstructs dispatch records by parsing log headers from disk. PR status (`opened`, `tests_passed`, `tests_failed`, `failed`, `pending`) is derived by scanning the log for marker lines on every read.

### Cancellation

On Windows, `child.kill()` only sends CTRL_C_EVENT which is ignored by many CLIs. The dispatcher uses `taskkill /F /T /PID <pid>` to kill the entire process tree. A `cancelRequested` set tracks the intent so the close handler can distinguish a user-cancelled dispatch from a crash.

---

## The MCP Server (Code Intelligence)

**Directory:** `mcp-server/`

A standalone Node.js MCP server that communicates over stdio. Built with `@modelcontextprotocol/sdk`. Claude calls these tools during the agentic exploration loop.

### Configuration (`.mcp.json`):
```json
{
  "mcpServers": {
    "opensrcer-repo-tools": {
      "command": "node",
      "args": ["./mcp-server/dist/server.js"]
    }
  }
}
```

### Tools (9 total)

#### Code Intelligence Tools (6)

| Tool | Description | Implementation |
|------|------------|----------------|
| `repo_info` | Basic metadata: HEAD SHA, commit message, file count, top-level entries | `git rev-parse HEAD` + `git ls-files` |
| `list_files` | List tracked files with optional glob filter (up to 2000 files) | `git ls-files [-- <glob>]` |
| `read_file` | Read a file with line numbers; supports `line_start`/`line_end` for large files (>400KB requires range) | `fs.readFile` + line slicing |
| `grep` | Regex search, .gitignore-aware, skips binaries (up to 1000 matches) | `git grep -n -I --no-color` |
| `find_definition` | Definition lookup for a symbol name | **Two-tier:** tree-sitter AST index → regex-over-git-grep fallback |
| `find_references` | Every line mentioning a symbol (whole-word), with per-file count summary (up to 1500 matches) | `git grep -n -E` with `\b` word boundaries |

#### Graph-Powered Tools (3, zero LLM cost)

| Tool | Description | Implementation |
|------|------------|----------------|
| `trace_flow` | Trace execution flow from a function through its call chain (up to 6 levels deep) | BFS over graphify's `graph.json` call edges |
| `impact_analysis` | Blast radius analysis — direct callers, indirect dependents, affected modules, risk level | Reverse BFS over incoming call edges (up to 4 levels) |
| `explain_area` | Module/directory overview — key nodes, clusters, internal vs boundary edges, relationship types | Subgraph extraction + degree analysis |

Every tool takes a `repo: "owner/name"` argument. The server shallow-clones the repo on first use into `~/.contribai/repos/<owner>__<name>/` and caches it for 24 hours.

### Tree-sitter Symbol Indexer

The `find_definition` tool's first tier uses tree-sitter WASM grammars to parse source files and extract named declarations:

| Language | Declaration types captured |
|----------|--------------------------|
| Python | `function_definition`, `class_definition`, module-level lambda assignments |
| JavaScript | `function_declaration`, `class_declaration`, `method_definition`, `variable_declarator` with arrow/function RHS, exported functions |
| TypeScript | All JS types + `interface_declaration`, `type_alias_declaration`, `enum_declaration` |
| TSX | Same as TypeScript |
| Rust | `function_item`, `struct_item`, `enum_item`, `trait_item`, `type_item`, `const_item`, `static_item`, `macro_definition` |
| Go | `function_declaration`, `method_declaration`, `type_declaration`, `const_declaration`, `var_declaration` |

**Why tree-sitter over regex:** Regex misses multi-line signatures, decorators above the def line, `const foo = () => …`, Rust `impl T { fn foo(…) }` methods, and Go `func (r *T) Foo(…)` receiver methods. Tree-sitter handles all of them structurally and provides `kind` labels (function/class/method/type/…).

**Index caching:** Cached on disk as `<repoDir>/.opensrcer-index.json` and in-memory per process with an inflight lock. Rebuilt when the shallow clone is refreshed. Files over 2MB are skipped (usually generated code).

**WASM compatibility:** Pinned to web-tree-sitter v0.22 because its WASM binary ABI matches the prebuilt grammar bundles in `tree-sitter-wasms@0.1.13`. Newer versions (0.25+) use a different dylink format that fails to load these grammar WASMs.

When tree-sitter misses (unsupported language, parse error), the grep-based regex fallback catches definitions via PCRE keyword pattern matching (`def|class|fn|func|function|struct|...`). Deduplication by file:line prevents duplicates when both tiers match.

### Repo Cache

- **Location:** `~/.contribai/repos/<owner>__<name>/`
- **Strategy:** Shallow clone (`--depth=1 --single-branch`), blown away and recloned after 24h TTL
- **Auth:** If `GITHUB_TOKEN` is in the env, the clone URL is rewritten to `https://x-access-token:<token>@github.com/<owner>/<name>.git` for private repo access
- **Concurrency:** In-process locks (`Map<string, Promise>`) prevent two parallel tool calls from racing the clone
- **Security:** `safeJoin()` rejects absolute paths and `../` traversals — belt-and-braces since git output is trusted but tool args come from the model
- **Output limits:** All tool results are capped at 60,000 characters to prevent context window flooding

---

## The Auto-PR Pipeline

**File:** `lib/agentic-pr.ts`

After an agentic dispatch exits cleanly (code 0), this pipeline runs asynchronously:

### Steps

1. **Extract the diff** — Find the first fenced `` ```diff `` / `` ```patch `` block in the log containing `--- a/` + `+++ b/` headers. Tolerates bare ``` blocks that start with `--- a/`. Ensures trailing newline (git apply refuses input without one).

2. **Fork setup** (public flows) — `gh repo fork <owner>/<name>` + set up a `fork` remote in the cached clone

3. **Worktree** — `git worktree add -b opensrcer/issue-<N>-<suffix>` at `.dispatches/<id>/worktree/`. For security findings, the branch uses the finding ID (CVE/GHSA) instead of issue number. Stale worktrees from previous attempts are purged.

4. **Apply diff** — Five-tier ladder (see table above), then GNU `patch --fuzz=3` as final fallback. Each tier logs its own failure mode; if all five fail, the diff is reported as genuinely unusable.

5. **Gitleaks secret scan** — Runs `gitleaks dir` on the worktree. **Hard gate:** any finding blocks the PR. Runs on both public and Crucible flows.

6. **Gemini review** (optional) — Send diff to Gemini 2.0 Flash for advisory security/correctness review. Rate limits, quota, or network errors cause silent skip — never blocks the PR flow.

7. **Run tests** (Crucible only) — Detect ecosystem, run test suite in the worktree, block PR if tests fail

8. **Extract PR content** — Parse `## PR title` and `## PR body` sections from Claude's output

9. **Commit** — Clean subject line (uses PR title), no "generated by" trailers. Author identity configurable via `OPENSRCER_COMMIT_NAME` / `OPENSRCER_COMMIT_EMAIL`.

10. **Push** — To user's fork (public) or directly upstream (Crucible, using installation token). 90-second timeout.

11. **Resolve base branch** — Analyze merged PR history for the dominant target branch (see [Base Branch Resolution](#base-branch-resolution))

12. **Open draft PR** — Via `gh pr create --draft` (public) or GitHub REST API (Crucible). For Crucible, the `head` is the branch name directly (same repo, no fork).

13. **Cleanup** — Remove worktree, restore origin URL if Crucible (strip the installation token from git config)

### PR Content Assembly

The pipeline extracts structured sections from Claude's output:

| Section | Used for |
|---------|----------|
| `## PR title` | PR title (truncated to 90 chars, sanitized — truncated at first sentence boundary or 85 chars with ellipsis) |
| `## PR body` | PR description body |
| `## Diagnosis` | Fallback body section if PR body is missing |
| `## Risk / Test` | Fallback "Test plan" section |
| `## Conventions` | Collapsible `<details>` section in body (omitted if "no contribution guide") |

If the body doesn't contain `Fixes #N` / `Closes #N`, it's auto-injected so the issue auto-closes on merge.

### Crucible Token Re-minting

For private-org flows, the installation token is **re-minted** at PR-open time (not at dispatch-start time). This prevents a 20-minute agentic run from failing at the push step because the token expired during exploration. The origin URL is temporarily set with the fresh token for the push, then restored to the public (non-tokened) form — installation tokens never persist in the clone's git config.

---

## Issue Scanner & Scorer

**File:** `lib/issues.ts`

Every issue fetched via `gh issue list` passes through a deterministic heuristic scorer. No LLM involved — classification is instant and free.

### Scoring Dimensions

**Category** (from labels → title keywords):
`bug | feature | docs | refactor | test | performance | security | question | other`

**Severity**: `low | medium | high | critical`
- Labels checked first (e.g., `/critical|p0/` → critical, `/security|cve|vuln/` → security → high)
- Body keywords as fallback (`crash|data loss|corruption` → high, `typo|minor|cosmetic` → low)

**Complexity** (1–5):
- Body length > 400 chars → +1, > 1500 → +1
- Referenced files > 2 or code snippets > 1 → +1
- Category refactor/performance → +1
- Comment count > 5 → +1 (lots of discussion = contested scope)

**Time estimate**: `{1: 8min, 2: 20min, 3: 45min, 4: 90min, 5: 180min}`

### Solvability Gate

An issue is marked **not solvable** if any of these apply:

| Check | Reason |
|-------|--------|
| **Stale-open** | Body/comments say "fixed in PR #123", "duplicate of #456", "this was already resolved". Negation-aware: "not yet fixed" doesn't trigger a false positive. Maintainer comments flagged with authority. |
| **Assigned** | Someone's actively working on it — including bots like dependabot |
| **Question** | Not an actionable issue |
| **Insufficient repro** | "cannot reproduce" + body < 300 chars |
| **Non-actionable labels** | `needs-triage`, `wontfix`, `duplicate`, `invalid` |
| **Too sparse** | Category "other" + body < 80 chars |

---

## Scope Classifier

**File:** `lib/scope.ts`

Predicts how wide a fix will reach through the codebase. Purely textual — no network calls. Shown as a badge in the UI and used to recommend the right dispatch mode.

| Bucket | Detection | Recommendation |
|--------|-----------|----------------|
| `doc` | All mentioned files are README/docs/packaging + no code symbols | Quick solve |
| `leaf` | Exactly 1 source file mentioned | Quick solve |
| `cross-file` | 2–5 source files mentioned | Deep solve |
| `refactor` | 6+ files OR body contains "refactor across", "every caller", "breaking change" | Skip (too broad) |
| `new-file` | Title matches "create/add/introduce" + file-type noun ("schema", "config", "types.d.ts") | Deep solve |
| `unknown` | No files or symbols named | Deep solve (let Claude figure it out) |

### How it works:
1. **Extract file paths** from title+body using a regex matching common extensions (`.py`, `.ts`, `.rs`, `.go`, etc.)
2. **Extract symbols** — snake_case, CamelCase, function calls like `foo()`
3. Apply the classification ladder: new-file → refactor phrases → doc-only → file count → unknown

---

## Discovery Pipeline

**File:** `lib/discover.ts`

### Flow

```
POST /api/discover { minStars, maxStars?, language?, repoLimit, issuesPerRepo, maxRepoAgeDays? }
  ↓
1. gh search repos stars:>=N [stars:A..B] --language <lang> --limit M --sort stars
   → filter: openIssuesCount > 0
   → returns up to 20 repos
  ↓
2. Fan out to listIssues(owner, repo) — 4 parallel workers
   → gh issue list --repo owner/name --state open --limit N
     --json number,title,body,labels,state,author,url,...,comments
   → Score each issue (category, severity, complexity, solvability)
   → Classify scope (doc/leaf/cross-file/refactor/new-file/unknown)
  ↓
3. Merge all issues, sort newest-first, return { repos, issues }
```

**Rate limits:** `gh search repos` costs 1 code-search request (30/min authed). `gh issue list` uses REST (5000/hr). Typical scan: 12 repos × 20 issues = ~13 API calls.

**Client-side filtering:** The API returns all scored issues; filtering by age, complexity, scope bucket, and solvability happens in the browser — no re-fetch needed.

---

## Graph Intelligence System

**Files:** `lib/graph.ts`, `lib/graph-build.ts`, `mcp-server/src/graph.ts`

opensrcer can build a structural knowledge graph of any repository, enabling zero-cost structural queries that complement Claude's LLM-powered exploration.

### Graph Building

Two graph builders are supported, with automatic fallback:

1. **Graphify** (primary) — Leiden community clustering, relationship extraction. On Windows, runs via Python with `sys.setrecursionlimit(10000)` to handle large repos. Output: `graphify-out/graph.json`.
2. **Code-review-graph (CRG)** (fallback) — SQLite-based, handles large repos that exceed graphify's memory/recursion limits. Also built alongside graphify for blast-radius queries. Output: `.code-review-graph/graph.db`.

**Cache location:** `~/.opensrcer/graph-cache/<owner>__<name>/`

### Query Commands (zero LLM cost)

| Command | What it does |
|---------|-------------|
| `trace <symbol>` | Follow execution flow through call chain (6 levels deep, 15 edges per node) |
| `impact <symbol>` | Blast radius — direct callers, indirect dependents, affected communities, risk level (LOW/MEDIUM/HIGH) |
| `explain <directory>` | Module overview — key nodes by connectivity, clusters, internal vs boundary edges |
| `path <source> to <target>` | Shortest path between two nodes (BFS, undirected) |
| `stats` | Graph statistics — nodes, edges, modules, confidence distribution, relationship types |
| `top nodes` / `god nodes` | Highest-connectivity nodes (potential refactoring targets) |
| `recent` | Codebase activity map — areas by size, densest modules, isolated nodes (dead code candidates) |
| `help` | List all available commands |

### MCP Integration

Three graph tools are registered in the MCP server, allowing Claude to use structural understanding during solves:
- `trace_flow` — same as the `trace` command
- `impact_analysis` — same as the `impact` command
- `explain_area` — same as the `explain` command

If no graph is built for a repo, these tools return an actionable error message guiding the user to build one via the Graph page.

### Architecture Concepts

- **Nodes** = named code entities (functions, classes, modules) with file type, source location, and community assignment
- **Edges** = relationships (calls, imports, instantiates, references, uses_component, binds_method) with confidence scores
- **Communities** = Leiden algorithm clusters, given human-readable names from the most common directory path in each group
- **Module naming** = derives readable names like "lib/application" instead of "Cluster 9"

---

## Crucible — Private Repository Mode

**Directory:** `lib/crucible/`

Crucible is the private-repo workflow. Organizations install the **opensrcer GitHub App**, which grants short-lived installation tokens scoped to only the org's repos.

### GitHub App Auth Flow

```
1. App JWT — 10-minute RS256 JWT signed with the App's private key
     ↓
2. Exchange for installation token:
   POST /app/installations/<id>/access_tokens
     ↓
3. Cache: in-memory + .dispatches/crucible-tokens-cache.json (55-min TTL)
     ↓
4. Use for all GitHub API calls: installationFetch(installationId, url)
```

### Org Connection

The install callback maps `(auth0UserId, githubOrg) → installationId`, stored in `.dispatches/crucible-orgs.json`. This mapping is verified — you can't act on an org you haven't connected.

### Token Resolution

When `orgCtx` is supplied (Crucible flow):
1. Look up the verified mapping for (user, org)
2. Mint an installation token via the GitHub App
3. If no mapping exists → `token: undefined` (never falls back to a PAT — that would leak public-scope tokens into an installation-scoped path)

At PR-open time, the token is **re-minted** from scratch. This prevents a 20-minute agentic run from failing at the push step because the token expired during exploration.

### Security Findings

Two GitHub API sources normalized into a unified `SecurityFinding` type:
- **Repository security advisories** (`GET /repos/:o/:r/security-advisories`) — published + draft GHSA entries
- **Dependabot alerts** (`GET /repos/:o/:r/dependabot/alerts?state=open`) — active vulnerability alerts

Both are cached in-memory with a 60-second TTL. Also exposes `listInstallationRepos()` (paginated listing of all repos the app can access) and `listInstallationIssues()` (open issues for a specific repo).

### Test Runner

**Crucible-only.** Before opening a PR on a private repo, the pipeline runs the repo's test suite in the worktree:

| Priority | Ecosystem | Detection | Commands |
|----------|-----------|-----------|----------|
| 1 | npm | `package.json` with `scripts.test` | `npm install --no-audit --no-fund` → `npm test --silent` |
| 2 | pytest | `pyproject.toml` or `requirements*.txt` | `pip install -e .[dev,test]` (best-effort) → `pytest -x -q` |
| 3 | go | `go.mod` | `go test ./...` |
| 4 | cargo | `Cargo.toml` | `cargo test --no-fail-fast` |

- **No ecosystem match** → `status: "skipped"` (PR opens with "tests not run")
- **Tests fail** → PR is **blocked** (log records `[crucible-tests] status=failed`)
- **Timeout:** 10 minutes. **Output cap:** 256 KB stdout/stderr.
- **Safety:** `shell: true` for Windows PATH resolution (only whitelisted constant commands)

---

## Security Model

### No Env Fallbacks

All sensitive tokens (GitHub, Anthropic, Gemini) come exclusively from the authenticated user's session or encrypted cookie. Before spawning any child process, the server explicitly `delete`s its own `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` from the env, then injects only the requesting user's credentials.

### Identity

- **Auth0** brokers all identity — opensrcer never sees your password
- **GitHub Social Connection** — Auth0 performs the OAuth flow and returns a scoped token
- **Custom claim** `https://opensrcer.dev/github_token` — the user's GitHub token, embedded in the Auth0 session by a Rule

### Authentication Middleware (`middleware.ts`)

Every request passes through Next.js edge middleware that enforces auth:

```
Request → Is prefetch? → skip
        → Is /login? → if logged in, redirect to /discover
        → Is public path? → allow through
        → AUTH_DISABLED=1? → allow through (local dev)
        → Has session? → allow through
        → Is /api/*? → return 401 JSON
        → Else → redirect to /login?returnTo=<path>
```

**Public paths** (no auth required): `/`, `/login`, `/api/auth/*`, `/api/crucible/github/webhook`, webhooks (HMAC-authenticated), and all client-shell pages. The matcher skips `_next/static`, images, and favicons entirely.

### API Key Storage

User-provided API keys (Anthropic, Gemini, spend cap) are stored in an **encrypted httpOnly browser cookie**:

- **Algorithm:** AES-256-GCM
- **Key derivation:** SHA-256 hash of `AUTH0_SECRET`
- **Format:** `base64url(IV[12] + AuthTag[16] + Ciphertext)`
- **Cookie:** `opensrcer-keys`, httpOnly, sameSite=lax, secure in production, 30-day maxAge
- **Never on disk, never in a database, never logged**

### Token Lifecycle

| Token type | Source | Lifetime | Scope |
|-----------|--------|----------|-------|
| Auth0 session | Auth0 SDK cookie | Session duration | User identity |
| GitHub OAuth | Auth0 social connection | Session duration | `public_repo`, `read:user` |
| GitHub App JWT | Signed with App private key | 10 minutes | App-level API calls |
| Installation token | Exchanged from App JWT | 60 min (cached 55 min) | Per-org, all repos |
| Anthropic/Gemini keys | User-provided, encrypted cookie | 30 days (cookie maxAge) | API access |

### Spend Controls

- **Hard cap per dispatch** via `--max-budget-usd` (default $2, configurable per-user in encrypted cookie)
- Claude exits cleanly when the budget is reached
- The dashboard shows the `total_cost_usd` for each dispatch

### Secret Leak Prevention

- **Gitleaks scanning** runs on every generated patch before pushing, blocking PRs with detected secrets
- **Env sanitization** — server env vars are deleted before spawning child processes
- **Token redaction** — only the 4-char prefix of tokens is logged (safe: `ghs_` identifies installation tokens, `gho_`/`ghp_` identify user tokens)
- **Crucible origin URL cleanup** — installation tokens are stripped from git config after push

### Full Revocability

- Disconnect orgs, clear API keys, and sign out with one click
- Revoke the GitHub OAuth app from `github.com/settings/applications`
- Revoke the GitHub App installation from the org's settings

---

## Design System

**File:** `app/globals.css`

Dark-mode-only with a **warm paper-on-ink** palette. Tailwind CSS v4 with custom theme tokens.

### Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `ink` | `#0a0a0b` | Background |
| `ink-2` | `#0d0d0f` | Secondary background |
| `surface` | `#111115` | Elevated surfaces (tier 1) |
| `surface-2` | `#16161b` | Elevated surfaces (tier 2) |
| `surface-3` | `#1c1c22` | Elevated surfaces (tier 3) |
| `border` | `#26262d` | Default borders |
| `border-soft` | `#1a1a20` | Subtle borders |
| `border-strong` | `#3a3a44` | Emphasized borders |
| `paper` | `#ece5d1` | Primary text (warm cream) |
| `paper-2` | `#d9d1bc` | Secondary primary text |
| `paper-dim` | `#9a9280` | Secondary text |
| `paper-muted` | `#6b6557` | Tertiary text |
| `paper-faint` | `#3f3c34` | Quaternary text |
| `signal` | `#ff9d2e` | Primary accent (warm orange) |
| `signal-soft` | `#ffb866` | Light accent |
| `signal-dim` | `#8a5a1e` | Dark accent |
| `signal-faint` | `#2a1c0b` | Very dark accent |
| `ok` | `#7fe83f` | Success |
| `ok-dim` | `#3f7620` | Dark success |
| `alert` | `#ff5c5c` | Error/danger |
| `alert-dim` | `#7a2b2b` | Dark error |
| `info` | `#5ec8ff` | Informational |
| `info-dim` | `#205e84` | Dark informational |

### Typography

- **Serif:** Instrument Serif (Google Fonts) — headings, large numbers. Loaded via `next/font/google` with CSS variable `--font-serif`.
- **Mono:** JetBrains Mono (Google Fonts) — everything else: labels, code, body text, navigation. Weights: 300, 400, 500, 600. Features: `ss01`, `ss02`, `cv01`, `cv11`.

### Animations

- `pulse-signal` — Orange breathe effect (2.2s) for running indicators
- `pulse-ok` — Green breathe (2.8s) for succeeded states
- `fade-rise` — Subtle entrance: `translateY(8px) + opacity:0 → origin + opacity:1` (0.6s, cubic bezier)
- `scan` — Vertical sweep for scanning UI (3.5s)
- `ticker` — Horizontal continuous scroll (60s)
- `confetti-burst` — Particle explosion on PR opened (uses CSS custom properties `--tx`, `--ty`)
- Stagger classes: `.stagger-1` through `.stagger-8` (60ms increments)

### Utility Classes

- `.mono-label` — Uppercase 10px monospace label with `0.18em` letter spacing
- `.hairline` — Horizontal divider with gradient fade at edges
- `.grid-pattern` — 32px grid background pattern
- `.signal-glow` — Orange box-shadow glow effect
- `.serif` — Apply serif font family
- `.num-tabular` — Tabular number spacing (`font-variant-numeric: tabular-nums`)

### Background

Three-layer body background:
1. Radial orange glow (top-right, 1200×600px, 5% opacity)
2. Radial blue glow (bottom-left, 900×500px, 3% opacity)
3. SVG noise texture (subtle paper grain, 160px tile, 2.5% opacity)

All three are `background-attachment: fixed` for parallax-like stability during scroll.

### Other Design Decisions

- **Dark-only:** `color-scheme: dark` on `:root`
- **Antialiased:** `-webkit-font-smoothing: antialiased` + `text-rendering: optimizeLegibility`
- **No horizontal overflow:** `overflow-x: hidden; max-width: 100vw` on `html, body`
- **Custom scrollbar:** 10px, transparent track, `border-color` thumb
- **Selection color:** Orange signal on ink background
- **Radius tokens:** `xs: 2px`, `sm: 3px`, `md: 4px` — deliberately tight

---

## Getting Started

### Prerequisites

| Tool | Version | Required for |
|------|---------|-------------|
| Node.js | 22+ | Next.js dev server |
| npm | 10+ | Dependency management |
| Claude Code CLI | Latest | Agentic dispatches (`claude -p`) |
| `gh` CLI | 2.x+ | GitHub API calls (repos, issues, PRs) |
| GNU `patch` | Any | Fallback diff application (ships with Git-for-Windows) |
| Git | 2.30+ | Cloning, worktrees, push |
| Gitleaks | Any | Secret scanning (optional, skipped gracefully if missing) |
| Python | 3.9+ | Graph building via graphify (optional) |

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/rahulp7801/opensrcer.git
cd opensrcer

# 2. Install Next.js dependencies
npm install --legacy-peer-deps

# 3. Build the MCP server
cd mcp-server && npm install && npm run build && cd ..

# 4. Create .env.local (see .env.example and Environment Variables section below)
cp .env.example .env.local
# Edit .env.local — at minimum you need Auth0 credentials

# 5. Authenticate the gh CLI
gh auth login

# 6. Start the dev server
npm run dev
```

Open `http://localhost:3000`. Sign in with GitHub via Auth0. Add your Anthropic API key on the Crucible page (or via `/api/settings`). Navigate to `/discover`, scan for issues, and click **Deep solve**.

### Local Dev Without Auth0

Set `AUTH_DISABLED=1` in `.env.local` to skip all auth checks. The middleware will let every request through, and API routes won't require a session. Useful for UI development but all dispatch features will need explicit tokens.

### Building the MCP Server for Development

```bash
cd mcp-server
npm run dev  # watches for changes and recompiles
```

---

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `AUTH0_CLIENT_ID` | Auth0 application client ID |
| `AUTH0_CLIENT_SECRET` | Auth0 application client secret |
| `AUTH0_ISSUER_BASE_URL` | Auth0 tenant URL (e.g., `https://dev-xxx.us.auth0.com`) |
| `AUTH0_BASE_URL` | Application URL (e.g., `http://localhost:3000`) |
| `AUTH0_SECRET` | Session encryption secret (also used for API key encryption) |

### Optional — Local Dispatch

| Variable | Purpose |
|----------|---------|
| `CONTRIBAI_BIN` | Path to `contribai.exe` — enables deterministic dispatch mode |
| `CONTRIBAI_CONFIG` | Path to contribai config YAML |
| `GH_CLI` | Explicit path to `gh.exe` (falls back to PATH) |

### Optional — Crucible (Private Repos)

| Variable | Purpose |
|----------|---------|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM, supports `\n`-escaped single-line) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook HMAC verification secret |

### Optional — Tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_DISABLED` | `0` | Set to `1` to skip auth (local dev) |
| `CONTRIBAI_API_URL` | _(unset)_ | If set, dashboard proxies API calls to running ContribAI web server |
| `GEMINI_API_KEY` | _(unset)_ | Server-side Gemini key for patch self-review |
| `ANTHROPIC_API_KEY` | _(unset)_ | Server-side Anthropic key (prefer user-cookie keys) |
| `OPENSRCER_AGENTIC_BUDGET_USD` | `2` | Hard cap per agentic dispatch (USD) |
| `OPENSRCER_AGENTIC_TIMEOUT_MS` | `1800000` | Wall-clock timeout per dispatch (30 min) |
| `OPENSRCER_AGENTIC_AUTO_PR` | `1` | Set to `0` to disable auto-PR on clean agentic exit |
| `OPENSRCER_COMMIT_NAME` | `rahulp7801` | Git author name for auto-PRs |
| `OPENSRCER_COMMIT_EMAIL` | `76501505+rahulp7801@...` | Git author email for auto-PRs |
| `OPENSRCER_CACHE_DIR` | `~/.contribai/repos` | Override the shallow clone cache directory |
| `CONTRIBAI_GEMINI_RPM` | `4` | Gemini rate-limit throttle (requests per minute) |
| `CRG_PYTHONPATH` | _(system)_ | Path to code-review-graph Python package |

---

## API Reference

### Auth

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/login` | GET | Initiate Auth0 login |
| `/api/auth/logout` | GET | Clear session |
| `/api/auth/callback` | GET | Auth0 OAuth callback |
| `/api/auth/me` | GET | Current user info |

### Discovery & Issues

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/discover` | POST | Search GitHub for repos + score issues. Body: `{ minStars, maxStars?, language?, repoLimit?, issuesPerRepo?, maxRepoAgeDays? }` |
| `/api/issues/scan` | POST | Scan a specific repo's issues. Body: `{ owner, repo, limit? }` |

### Dispatches

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dispatches` | GET | List all dispatches (in-memory + reconstructed from disk) |
| `/api/dispatches/[id]` | GET | Get dispatch details + full log text |
| `/api/dispatches/[id]` | DELETE | Cancel a running dispatch (kills process tree) |

### Run (Dispatch Execution)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/run/target` | POST | Start deterministic target dispatch. Body: `{ repo_url, dry_run? }` |
| `/api/run/solve` | POST | Start deterministic solve dispatch. Body: `{ repo_url, issue_number, dry_run? }` |
| `/api/run/agentic` | POST | Start agentic Claude dispatch. Body: `{ repo_url, issue_number }` |
| `/api/run/hunt` | POST | Start hunt mode dispatch |

### Settings

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/settings` | GET | Get stored API key metadata (not the keys themselves) |
| `/api/settings` | POST | Save API keys to encrypted cookie. Body: `{ anthropic?, gemini?, maxSpendUsd? }` |
| `/api/settings` | DELETE | Clear all stored API keys |

### Stats & Observatory

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/stats` | GET | Aggregated stats (scans, dispatches, PRs, cost, biggest contributions) |
| `/api/prs` | GET | Pull request list (seed or proxied) |
| `/api/repos` | GET | Repository list |
| `/api/runs` | GET | Run history |
| `/api/health` | GET | Health check |
| `/api/sessions` | GET | Active sessions |

### Graph

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/graph/generate` | POST | Build graphify knowledge graph for a repo (with streaming progress) |
| `/api/graph/*` | Various | Graph query and visualization endpoints |

### Crucible (Private Repos)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/crucible/connect` | POST | Connect an org to the GitHub App |
| `/api/crucible/orgs` | GET | List connected orgs for the current user |
| `/api/crucible/repos` | GET | List repos accessible via the App installation |
| `/api/crucible/run` | POST | Dispatch on a private repo (uses installation token) |
| `/api/crucible/github/webhook` | POST | GitHub App webhook receiver (HMAC-verified) |
| `/api/crucible/github/install-callback` | GET | GitHub App installation callback |

### Explore

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/explore` | POST | Plain-English codebase Q&A via Claude + MCP tools |

---

## Project Structure

```
opensrc2/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Landing page (20 KB)
│   ├── layout.tsx                # Root layout: fonts, Auth0 UserProvider, toast, shell
│   ├── globals.css               # Design system (201 lines)
│   ├── loading.tsx               # Loading skeleton
│   ├── not-found.tsx             # 404 page
│   ├── login/page.tsx            # Auth0 login page
│   ├── discover/                 # Discovery UI
│   ├── issues/                   # Issue scanner UI
│   ├── dispatches/               # Dispatch list + log viewer
│   ├── explore/                  # Codebase Q&A
│   ├── graph/                    # Graph intelligence UI (40 KB)
│   ├── crucible/                 # Private-org mode
│   ├── trigger/                  # Manual dispatch trigger
│   ├── demo/                     # Demo page
│   ├── prs/ repos/ runs/ stats/  # Observatory views
│   └── api/                      # ~16 API route directories
│       ├── auth/                 # Auth0 SDK routes
│       ├── discover/             # Discovery endpoint
│       ├── dispatches/           # Dispatch management
│       ├── explore/              # Codebase Q&A endpoint
│       ├── graph/                # Graph build + query endpoints
│       ├── issues/               # Issue scanning
│       ├── run/                  # Dispatch execution (target/solve/agentic/hunt)
│       ├── crucible/             # Crucible: GitHub App, webhooks, org connect
│       ├── settings/             # API key management
│       ├── stats/                # Aggregated stats
│       └── prs/ repos/ runs/     # Observatory data endpoints
│
├── components/                   # 24 React components
│   ├── dispatch-list.tsx         # 51 KB — real-time log viewer, status chips, PR overlay
│   ├── issue-scanner.tsx         # 30 KB — scored issue table with action buttons
│   ├── discover-scanner.tsx      # 21 KB — cross-repo search UI
│   ├── draft-preview.tsx         # 11 KB — dry-run draft preview
│   ├── command-palette.tsx       # 11 KB — ⌘K palette
│   ├── stats-board.tsx           # 10 KB — stats dashboard with sparklines
│   ├── trigger-form.tsx          # 9 KB — manual trigger
│   ├── pr-table.tsx              # 9 KB — PR display table
│   ├── onboarding.tsx            # 5 KB — first-time user guide
│   ├── icons.tsx                 # 3 KB — SVG icon components
│   ├── auth-chip.tsx             # 3 KB — login/logout with user avatar
│   ├── api-key-gate.tsx          # 2 KB — "Configure API keys" banner
│   ├── nav.tsx                   # 2 KB — site navigation
│   ├── sparkline.tsx             # 2 KB — tiny inline SVG charts
│   ├── toast.tsx                 # 2 KB — toast notification system
│   ├── animated-counter.tsx      # 1 KB — smooth number animation
│   ├── status-dot.tsx            # 1 KB — pulsing status indicator dots
│   ├── header.tsx                # 1 KB — site header
│   └── ...                       # panel, section, page-heading, footer, etc.
│
├── lib/                          # Server-side business logic
│   ├── graph.ts                  # 28 KB — graph traversal engine (zero LLM cost)
│   ├── agentic-pr.ts             # 29 KB — auto-PR: diff extract → apply → test → push → PR
│   ├── agentic-dispatcher.ts     # 27 KB — spawns claude -p with MCP, streams output
│   ├── dispatcher.ts             # 21 KB — spawns contribai.exe, manages lifecycle
│   ├── issues.ts                 # 13 KB — issue scanner + deterministic scorer
│   ├── stats.ts                  # 11 KB — stats aggregator (scans dispatch logs)
│   ├── scope.ts                  # 11 KB — scope classifier
│   ├── seed.ts                   # 10 KB — deterministic demo data (seeded PRNG)
│   ├── discover.ts               # 7 KB — repo discovery pipeline
│   ├── gitleaks-scanner.ts       # 5 KB — secret scanning gate
│   ├── graph-build.ts            # 5 KB — graph build orchestration (graphify + CRG)
│   ├── enrich.ts                 # 4 KB — PR/repo/run enrichment
│   ├── data.ts                   # 4 KB — data fetchers (proxy to ContribAI or seed)
│   ├── api-keys.ts               # 3 KB — AES-256-GCM encrypted cookie storage
│   ├── crg-summary.py            # 3 KB — code-review-graph summary generator
│   ├── crg-impact.py             # 5 KB — blast-radius analysis via CRG
│   ├── sanitize.ts               # 2 KB — input sanitization utilities
│   ├── github-token.ts           # 2 KB — GitHub token from Auth0 session
│   ├── use-swr-fetch.ts          # 2 KB — SWR fetch hook
│   ├── llm-cache.ts              # 3 KB — LLM response caching
│   ├── types.ts                  # 2 KB — shared TypeScript types
│   ├── utils.ts                  # 1 KB — utility functions
│   └── crucible/                 # Private-org subsystem
│       ├── test-runner.ts        # 11 KB — sandbox test execution
│       ├── advisories.ts         # 8 KB — security advisories + Dependabot alerts
│       ├── github-app.ts         # 4 KB — JWT minting + installation tokens
│       ├── orgs.ts               # 2 KB — org-user mapping store
│       ├── tokens.ts             # 2 KB — installation token resolver
│       └── constants.ts          # Crucible constants
│
├── mcp-server/                   # MCP server (separate npm package)
│   └── src/
│       ├── server.ts             # 6 KB — stdio transport, 9 tool registrations
│       ├── tools.ts              # 11 KB — code intelligence tool implementations
│       ├── graph.ts              # 7 KB — graph-powered MCP tools
│       ├── repo-cache.ts         # 4 KB — shallow-clone cache
│       ├── indexer.ts            # 13 KB — tree-sitter WASM symbol indexer
│       └── tools/                # Additional tool modules
│
├── scripts/                      # Utility scripts
│   └── seed_memory.py            # 7 KB — memory seeding script
│
├── ContribAI/                    # Rust agent binary (deterministic path)
│   ├── Cargo.toml                # Rust workspace
│   ├── crates/                   # Rust crate sources
│   └── python/                   # Python helper scripts
│
├── middleware.ts                 # Auth0 session-gating middleware
├── .mcp.json                    # MCP server config for claude -p
├── .env.local                    # Environment secrets
├── .dispatches/                  # Runtime artifacts (gitignored)
│   ├── d_<timestamp>_<uuid>.log  # Per-dispatch log files
│   ├── d_<timestamp>_<uuid>/     # Worktrees + draft JSONs
│   ├── issue-titles.json         # Cached issue titles (TTL 30 days)
│   ├── stats.json                # Scan/discover counters
│   ├── crucible-orgs.json        # Org→installation mapping
│   ├── crucible-tokens-cache.json # Installation token cache
│   └── repo-stars.json           # Star count cache (TTL 7 days)
├── READING.md                    # Detailed codebase deep-dive (for contributors)
├── CRUCIBLE.md                   # Crucible design document
└── package.json                  # Next.js + dependencies
```

---

## Stats & Telemetry

**File:** `lib/stats.ts`

Stats are derived from **filesystem artifacts** — no database. Two data sources:

### 1. Counter file (`.dispatches/stats.json`):
```json
{
  "scans": 47,
  "discoverRuns": 12,
  "scanHistory": [
    { "ts": "2026-04-19T...", "repo": "owner/name", "kind": "scan" }
  ]
}
```
Bumped by `/api/issues/scan` (scans) and `/api/discover` (scans + discoverRuns).

### 2. Log file scraping:
For each `.dispatches/*.log`, extract:
- `repoFull` from `repo: <owner/name>` marker
- `issueNumber` from `issue: #N`
- `prUrl` from any `github.com/<o>/<r>/pull/<n>` URL
- `status` from `exited at ... status=<status>`
- `costUsd` from `total_cost_usd=<float>`
- `hasDiff` from presence of `` ```diff `` block

### Aggregated stats (`StatsSummary`):
- `dispatches`: count of log files
- `prsCreated`: logs containing a PR URL
- `totalCostUsd`: sum of all logged costs
- `patchesGenerated`: logs containing a diff block
- `successRate`: patchesGenerated / completed
- `prRate`: prsCreated / completed
- `biggestContributions`: PRs on repos with ≥1000 stars (star count cached in `.dispatches/repo-stars.json` with 7-day TTL)
- `recentActivity`: merged scan history + dispatch starts, newest-first

---

## Seed Data & Demo Mode

**File:** `lib/seed.ts`

When `CONTRIBAI_API_URL` is not set (no running Rust backend), the dashboard serves **deterministic demo data** generated by a seeded PRNG (`mulberry32`). This creates:
- 84 fake PRs across 23 real repos (sherlock, ruff, polars, tokio, etc.)
- Fake runs, repos, stats, sessions
- Stable across reloads (same seed = same data)

### Enrichment (`lib/enrich.ts`):
When the Rust backend IS connected, its API returns sparse PR/repo/run records. The enrichment layer fills in missing fields:
- **Language + stars**: Fetched from GitHub API and cached in-memory. Falls back to name-based heuristic (`*-rs` → rust, `*-py` → python).
- **Quality score, risk, lines/files changed**: Derived deterministically via hash code (stable per repo+pr_number).

---

## Honest Limits

- **"Verified" means the repo's tests passed.** If a repo has no tests, there's no verification — we say so explicitly. We don't fake green checks.
- **LLM diffs can be malformed.** The five-tier apply ladder handles most cases, but some patches are genuinely broken. The dashboard shows the failure reason and lets you copy the raw diff.
- **Test isolation is per-worktree, not per-container.** The worktree is a throwaway checkout off a shallow clone, so the blast radius is bounded to that directory. But it's not Docker-level isolation. A future `CRUCIBLE_SANDBOX_DOCKER=1` flag is planned.
- **Cost estimates are approximations** based on Claude's `total_cost_usd` reporting and observed patterns, not pre-computed guarantees.
- **Scope classifier is advisory, not a hard gate.** A "refactor" badge means "this will probably touch too many files for a 5-file pre-attach budget." It doesn't prevent you from trying.
- **Issue solvability is heuristic.** The stale-open detector catches most resolved-but-not-closed issues, but body-only scanning (not full comment threads on some edge cases) means it can miss resolution signals buried deep in a conversation.
- **Base branch resolution works for common patterns** (trunk, GitFlow) but not for repos with exotic branching strategies. The fallback is always the repo's default branch.
- **Gemini review is advisory and best-effort.** Rate limits, quota, or network errors cause it to silently skip — it never blocks the PR flow.
- **Graph intelligence requires a pre-built graph.** If graphify or CRG hasn't been run, the graph tools return an error. Large repos may exceed Python's recursion limit even with the 10,000-deep override.
- **Gitleaks is optional.** If not installed, the secret scan is skipped. The PR still opens, but without the secret-leak safety net.
- **Tree-sitter WASMs are pinned to v0.22.** The grammar bundles in `tree-sitter-wasms@0.1.13` are incompatible with newer web-tree-sitter versions. This limits language support to 6 languages until the grammars are upgraded.

---

## License

MIT
