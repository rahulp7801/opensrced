# opensrcer

**Find bugs. Fix them. Prove it works.**

opensrcer is an AI-powered platform that scans GitHub repositories for real bugs, security advisories, and open issues — then generates verified patches and opens draft PRs, but only after the repo's own test suite passes.

Sign in with GitHub. Paste your Anthropic API key. Point it at a repo. Watch it work.

---

## What it does

### Discover issues across GitHub

Search repos by star count and language. Every open issue is scored with a deterministic classifier — category, severity, complexity, scope — so you can filter by what's actually solvable. No LLM calls during discovery.

### Solve issues with AI

Two pipelines, chosen based on what the issue needs:

| | Quick solve | Deep solve |
|---|---|---|
| **How** | Deterministic one-shot (Sonnet + Gemini self-review) | Agentic loop (Claude Code explores via MCP tools) |
| **Speed** | ~30s–3min | ~2–8min |
| **Cost** | ~$0.06/issue | ~$0.02–$0.15/issue |
| **Best for** | Doc fixes, single-file bugs | Cross-file changes, new files, complex issues |
| **Exploration** | Pre-attaches up to 10 files by symbol search | Claude drives its own codebase navigation |

### Verify before pushing

Every patch runs against the repo's test suite before a PR is opened:

- **Tests pass** → branch pushed, draft PR opened, "verified" badge shown
- **Tests fail** → PR blocked, failure reason surfaced in the dashboard
- **No tests** → honestly reported as "not verified" rather than faking a green check

### Crucible: private org repos

Connect a GitHub Organization through a dedicated GitHub App. opensrcer scans your private repos with short-lived installation tokens (60-min TTL, per-org scope). No long-lived credentials. Revocable anytime.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Next.js 15 Dashboard (App Router, React 19, Tailwind v4)  │
│                                                           │
│  /discover  /issues  /dispatches  /stats  /crucible       │
│      │          │         │          │        │           │
│   lib/discover  │    lib/dispatcher  │   lib/crucible/    │
│              lib/issues    │      lib/stats   │           │
│                            │                  │           │
│                     ┌──────┴──────┐    GitHub App         │
│                     │   spawn     │    (installation      │
│                     │             │     tokens)           │
│              contribai.exe    claude -p                   │
│              (deterministic)  (agentic, MCP)              │
└──────────────────────┬───────────────────────────────────┘
                       │ MCP stdio
                       ▼
            ┌─────────────────────┐
            │ opensrcer-repo-tools │
            │   list_files        │
            │   read_file         │
            │   grep              │
            │   find_definition   │──── tree-sitter AST index
            │   find_references   │     (Python, JS, TS, Rust, Go)
            │   repo_info         │
            └─────────┬───────────┘
                      ▼
       ~/.contribai/repos/<owner>__<name>/
       (shallow clone, 24h TTL)
```

### Post-dispatch: auto-PR pipeline

After Claude produces a fix, `lib/agentic-pr.ts` takes over:

1. Extract the diff from the structured output
2. Resolve the correct base branch (analyzes merged PR history)
3. Apply via a five-tier fallback ladder (strict → ignore-whitespace → 3way → deepen → GNU patch)
4. Run the test suite (npm/pytest/go/cargo detection)
5. Commit + push + open draft PR with Claude's title, body, and `Fixes #N`

### Storage

Zero database. Everything is flat files:

- `.dispatches/<id>.log` — append-only log per dispatch (status, diffs, PR URLs all derived from this)
- `.dispatches/crucible-orgs.json` — Auth0 user → GitHub org mapping
- `~/.contribai/repos/` — shallow clone cache (24h TTL)

---

## Security model

### Authentication

- **Auth0** brokers all identity. opensrcer never sees your password.
- **GitHub OAuth** via Auth0's social connection. You approve `public_repo` + `read:user` scopes on GitHub's consent screen.
- After login, your GitHub token lives in an **encrypted browser cookie** (AES-256-GCM, httpOnly). Never in a database. Never on disk.

### API keys

You bring your own Anthropic and Gemini keys. They're encrypted in a separate browser cookie with the same AES-256-GCM scheme.

When you click "deep solve":
1. Server decrypts the key **in memory**
2. Passes it as an env var to the Claude child process
3. Discards the decrypted value — it is never logged, stored, or cached

### Spend controls

Set a hard cap per task ($0.10 – $1.00). Claude's `--max-budget-usd` flag enforces it — the model stops cleanly when the limit is reached. A wall-clock timeout (default 30 min) kills the process tree if the model loops.

### Private repos (Crucible)

- Requires installing the `opensrcer-crucible` **GitHub App** on your org
- Installation tokens are short-lived (60 min) and org-scoped
- Tokens are re-minted at PR-open time so long agentic runs don't fail on expiry
- Pushes branches directly to the upstream repo (no fork needed)
- PRs opened via GitHub API with the installation token

### Privacy commitment

- No database storage of tokens, keys, or personal information
- No access to private repos unless you explicitly connect an org
- No selling, sharing, or transmitting your data to third parties
- No analytics, no tracking — the only cookies are your encrypted session and keys
- Everything is cleared the moment you sign out

### Revocation

- **Dashboard**: click "Delete all connections & sign out" on the Crucible page (two-step confirmation)
- **GitHub**: revoke the OAuth app at [github.com/settings/applications](https://github.com/settings/applications)
- **GitHub App**: uninstall from your org settings

---

## Getting started

### Prerequisites

- **Node.js 22+** and npm
- **Claude Code CLI** (`claude`) for deep solve
- **Rust 1.94+** (only if using quick solve / deterministic pipeline)
- **`gh` CLI** authenticated with your GitHub account
- **GNU `patch`** (ships with Git-for-Windows)

### Auth0 setup

1. Create a tenant at [auth0.com](https://auth0.com)
2. Create a Regular Web Application — note the Client ID, Client Secret, Issuer URL
3. Add a GitHub social connection (Authentication → Social → GitHub)
   - Create a GitHub OAuth App at [github.com/settings/developers](https://github.com/settings/developers)
   - Callback URL: `https://<your-auth0-tenant>.auth0.com/login/callback`
   - Scopes: `read:user`, `user:email`, `public_repo`
4. Create a Post Login Action (Actions → Library → Build from Scratch) to embed the GitHub token:
   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const github = event.user.identities?.find(i => i.provider === 'github');
     if (github?.access_token) {
       api.idToken.setCustomClaim(
         'https://opensrcer.dev/github_token',
         github.access_token
       );
     }
   };
   ```
5. Wire the Action into the Post Login trigger (Actions → Triggers → Post Login)

### GitHub App setup (for Crucible / private repos)

1. Create a GitHub App at [github.com/settings/apps/new](https://github.com/settings/apps/new)
   - Callback URL: `http://localhost:3000/api/crucible/github/install-callback`
   - Permissions: Contents R/W, Pull requests R/W, Issues R, Metadata R, Dependabot alerts R, Security events R, Org Administration R, Org Members R
   - Events: Installation, Installation repositories
2. Generate a private key (.pem)
3. Install the App on your test org

### Environment variables

Create `.env.local` (gitignored):

```
# Auth0
AUTH0_SECRET=<random 32+ char string>
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://<your-tenant>.us.auth0.com
AUTH0_CLIENT_ID=<from Auth0 dashboard>
AUTH0_CLIENT_SECRET=<from Auth0 dashboard>

# GitHub App (Crucible)
GITHUB_APP_ID=<from GitHub App settings>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_APP_WEBHOOK_SECRET=<from GitHub App settings>

# Optional: local dev overrides
GH_CLI=/path/to/gh.exe
CONTRIBAI_BIN=/path/to/contribai.exe
CONTRIBAI_CONFIG=/path/to/config.yaml
CONTRIBAI_API_URL=http://127.0.0.1:8787
```

### Boot

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Build the MCP server
cd mcp-server && npm install && npm run build && cd ..

# 3. (Optional) Build contribai for quick solve
cargo build --manifest-path ContribAI/Cargo.toml -p contribai

# 4. Start the dev server
npm run dev
# → http://localhost:3000
```

Open `http://localhost:3000`. You'll see the landing page. Click **Sign in with GitHub** → Auth0 login → GitHub OAuth. After login, add your Anthropic API key on the Crucible page, then scan a repo and click **deep solve** on an issue.

---

## Dashboard routes

| Path | Description |
|---|---|
| `/` | Public landing page |
| `/login` | Auth explainer + sign-in button |
| `/discover` | Cross-repo issue search with scoring + filters |
| `/issues` | Single-repo scanner with scope-based recommendations |
| `/prs` | Pull request history |
| `/repos` | Repository index |
| `/dispatches` | Live log streaming, diff review modal, PR banners |
| `/stats` | Counters + biggest contributions + activity feed |
| `/crucible` | Connect orgs, manage API keys, set spend limits, danger zone |
| `/crucible/orgs/[org]` | Private repo list for a connected org |
| `/crucible/orgs/[org]/repos/[repo]` | Advisories + Dependabot + issues with deep solve |

---

## Repo layout

```
.
├── app/                     # Next.js App Router
│   ├── page.tsx             # Public landing page
│   ├── login/               # Auth explainer + sign-in
│   ├── crucible/            # Private-repo flow (org list, repo scan, findings)
│   ├── discover/            # Cross-repo issue search
│   ├── issues/              # Single-repo scanner
│   ├── dispatches/          # Live dispatch log viewer
│   └── api/                 # API routes
│       ├── auth/            # Auth0 SDK catch-all + revoke-all
│       ├── crucible/        # Org connect, webhook, repos, advisories, dispatch
│       ├── run/             # Dispatch triggers (agentic, solve, target, hunt)
│       └── settings/        # API key management
├── components/              # React UI (scanner, dispatch-list, diff modal, ...)
├── lib/                     # Backend logic
│   ├── crucible/            # GitHub App, token resolver, org store, test runner
│   ├── agentic-dispatcher.ts
│   ├── agentic-pr.ts        # Auto-PR: apply ladder, test gate, push, PR open
│   ├── api-keys.ts          # Encrypted cookie storage for user API keys
│   ├── github-token.ts      # Session-based GitHub token resolver
│   ├── dispatcher.ts        # Process spawning + dispatch lifecycle
│   ├── discover.ts          # Cross-repo search via gh CLI
│   ├── issues.ts            # Issue scoring + classifiers
│   └── scope.ts             # Scope classifier (doc/leaf/cross-file/new-file/...)
├── mcp-server/              # MCP server with tree-sitter AST index
├── ContribAI/               # Vendored Rust fork (deterministic pipeline)
├── middleware.ts             # Site-wide Auth0 gate
└── .dispatches/             # Logs, caches, mappings (gitignored)
```

---

## How the two solve pipelines compare

```
                quick solve                    deep solve
                ──────────                     ──────────
exploration:    pre-attach 10 files            Claude navigates via MCP
model:          Sonnet one-shot + Gemini       Claude Code (agentic loop)
cost:           ~$0.06                         ~$0.02–$0.15
time:           30s–3min                       2–8min
scope:          doc, leaf fixes                cross-file, new-file, complex
test gate:      no                             yes (crucible flows)
PR quality:     auto-generated title/body      Claude's own structured output
```

---

## Honest limits

- **"Verified patch" = the repo's own tests passed.** Not "exploit rerun proved security." If a repo has no tests, there's no verification — we surface that honestly.
- **Test isolation is per-worktree, not per-container.** A hostile patch could in principle tamper with the worktree. Low risk given the prompt + review gates, but worth admitting.
- **The agentic pipeline can fail.** LLM diffs are noisy. The five-tier apply ladder handles most drift, but some patches are genuinely unapplicable. The dashboard shows the failure reason and lets you copy the raw diff.
- **Spend controls are enforced, not predicted.** The $0.50 cap means Claude stops at $0.50 — it doesn't mean the fix will cost exactly that much.

---

## License

MIT
