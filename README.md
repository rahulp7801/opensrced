# opensrcer

**Find bugs. Fix them. Prove it works.**

opensrcer is an AI-powered security and bug remediation platform. Point it at any GitHub repository — public or private — and it scans for vulnerabilities, open issues, and Dependabot alerts. When it finds something, it dispatches an agentic AI pipeline that explores the codebase, generates a minimal patch, runs the repo's own test suite, and opens a verified draft PR. If the tests fail, the PR is blocked and you see exactly why.

---

## Core features

### Agentic deep solve

Claude Code explores the codebase autonomously using a custom MCP server with tree-sitter AST indexing. It calls `grep`, `find_definition`, `read_file`, and `find_references` against a shallow clone until it understands the problem, then produces a structured patch with a PR title, body, and diagnosis.

### Verified patches

Every patch runs through a five-tier apply ladder (strict, ignore-whitespace, 3-way merge, deepened history, GNU patch) and then against the repo's test suite (npm, pytest, go test, cargo test). Only patches that pass get pushed.

### Codebase explorer

Ask plain-English questions about any GitHub repo. The explore feature streams Claude's tool activity live — you see which files it greps, which definitions it looks up — then renders the answer with syntax-highlighted code snippets and follow-up suggestions.

### Security advisory remediation

Advisories and Dependabot alerts aren't just listed — they can be dispatched directly to the agentic pipeline with a security-focused prompt that identifies the vulnerable dependency, determines the fix, and checks compatibility.

### Gemini self-review

After Claude generates a patch, Gemini 2.0 Flash reviews it for correctness, security issues, and completeness before the PR is opened. The review is logged in the dispatch output.

### Private repos (Crucible)

Connect a GitHub Organization through a dedicated GitHub App. opensrcer scans private repos with short-lived installation tokens (60-min TTL, per-org scope). Tokens are re-minted at PR-open time so long agentic runs don't fail on expiry.

---

## Dashboard

| Route | What it does |
|---|---|
| `/` | Public landing page with animated stats, dispatch demo, explore demo |
| `/demo` | Pre-recorded dispatch replay — no API key needed |
| `/login` | Auth flow explainer, permissions, privacy commitment |
| `/discover` | Cross-repo issue search with scoring and filters |
| `/explore` | Plain-English codebase Q&A with live tool streaming |
| `/issues` | Single-repo scanner with scope-based recommendations |
| `/dispatches` | Live log streaming, pipeline timeline, split diff review, export |
| `/prs` | Pull requests opened by the agent (derived from dispatch logs) |
| `/repos` | Repositories the agent has contributed to |
| `/stats` | Dispatches, patches, PRs, success rate, total API spend |
| `/crucible` | Connect orgs, manage API keys, set spend limits |
| `/crucible/orgs/[org]/repos/[repo]` | Advisories + issues + explore for a private repo |

---

## Architecture

```
Next.js 15 (App Router, React 19, Tailwind v4)
│
├── Auth0 (identity) ──── GitHub OAuth (social connection)
│
├── Crucible ──── GitHub App (installation tokens for private repos)
│
├── Agentic dispatcher
│   └── spawns `claude -p` with MCP config
│       └── opensrcer-repo-tools (MCP server)
│           ├── list_files (git ls-files)
│           ├── read_file (line-numbered slices)
│           ├── grep (git grep, .gitignore-aware)
│           ├── find_definition (tree-sitter AST + regex fallback)
│           ├── find_references (word-boundary grep + file-count summary)
│           └── repo_info (HEAD sha, file count, top-level entries)
│
├── Auto-PR pipeline (lib/agentic-pr.ts)
│   ├── Extract diff from Claude's structured output
│   ├── Resolve base branch (analyze merged PR history)
│   ├── Five-tier apply ladder
│   ├── Gemini self-review (best-effort)
│   ├── Run test suite (npm/pytest/go/cargo)
│   └── Commit + push + open draft PR
│
└── Storage: zero database
    ├── .dispatches/<id>.log (append-only, all state derived from logs)
    ├── .dispatches/crucible-orgs.json (auth0 user → github org mapping)
    └── ~/.contribai/repos/ (shallow clone cache, 24h TTL)
```

---

## Security model

**No env fallbacks.** All sensitive tokens (GitHub, Anthropic, Gemini) come exclusively from the authenticated user's session or encrypted cookie. The server's own environment variables are explicitly deleted before spawning child processes.

- **Auth0** brokers all identity — opensrcer never sees your password
- **API keys** encrypted with AES-256-GCM in httpOnly browser cookies — never on disk, never in a database
- **Keys decrypted in memory only** to make API calls, then discarded — never logged
- **GitHub App tokens** are short-lived (60 min), org-scoped, re-minted at PR-open time
- **Spend controls** — hard cap per task, enforced by Claude's `--max-budget-usd` flag
- **Full revocability** — disconnect orgs, clear keys, sign out with one click

---

## Getting started

### Prerequisites

- Node.js 22+
- Claude Code CLI (`claude`)
- `gh` CLI authenticated with your GitHub account
- GNU `patch` (ships with Git-for-Windows)

### Setup

```bash
# Install dependencies
npm install --legacy-peer-deps

# Build the MCP server
cd mcp-server && npm install && npm run build && cd ..

# Create .env.local with Auth0 + GitHub App credentials (see .env.example)

# Start
npm run dev
```

Open `http://localhost:3000`. Sign in with GitHub via Auth0. Add your Anthropic and Gemini API keys on the Crucible page. Navigate to a repo, pick an issue, click **deep solve**.

---

## Honest limits

- **"Verified" = the repo's tests passed.** If a repo has no tests, there's no verification — we say so.
- **LLM diffs can be malformed.** The five-tier apply ladder handles most cases, but some patches are genuinely broken. The dashboard shows the failure reason and lets you copy the raw diff.
- **Test isolation is per-worktree, not per-container.** Low risk given prompt + review gates, but not sandboxed.
- **Cost estimates are approximations** based on repo size and observed patterns, not guarantees.

---

## License

MIT
