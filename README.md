# opensrcer

[![CI](https://github.com/rahulp7801/opensrced/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rahulp7801/opensrced/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rahulp7801/opensrced/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/rahulp7801/opensrced/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/rahulp7801/opensrced?include_prereleases)](https://github.com/rahulp7801/opensrced/releases)

opensrcer helps a person turn a GitHub issue into a pull request they
understand and can stand behind. An AI agent drafts and tests the fix in an
isolated box. The person reviews it, explains it in their own words, and
publishes a draft PR from their own GitHub account. Nothing is posted without
them.

The goal is better contributions, not more PRs. Maintainers already get too
many AI-generated pull requests that ignore the project's rules, duplicate
someone else's work, or come from authors who cannot answer a review question.
opensrcer is built to refuse those cases and to make the human the author.

[Product tour](https://opensrced.vercel.app/demo) ·
[Stage demo](https://opensrced.vercel.app/demo/stage) ·
[Deployment guide](DEPLOYMENT.md) ·
[Security policy](SECURITY.md) ·
[Report a bug](https://github.com/rahulp7801/opensrced/issues)

## Project status

**Beta.** The production deployment has Auth0, private Blob storage and a
worker snapshot configured, and `GET /api/health` reports `ok`. The staging
project still lacks those. Open release gates are tracked in
[DEPLOYMENT.md](DEPLOYMENT.md#outstanding-release-gates).

| Environment | Branch | Endpoint | Access |
| --- | --- | --- | --- |
| Production | `main` | [opensrced.vercel.app](https://opensrced.vercel.app) | Public pages and demo; GitHub sign-in for the app |
| Staging | `staging` | [opensrced-staging.vercel.app](https://opensrced-staging.vercel.app) | Vercel authentication required |

`GET /api/health` returns 200 when the server is alive. `status: degraded`
lists the missing dependencies; it does not prove that GitHub or a model
provider works.

## How a run works

1. **Find an issue.** Discover and Issues search public repositories and score
   issues. Issues that already have someone's open PR are flagged, and so are
   projects whose contribution files ban AI-generated contributions
   (`lib/issues.ts`, `lib/contrib-guard.ts` `fetchRepoPolicy`).
2. **Explore the code.** Codebase map (`/graph`) builds a graph of the
   repository. Simple questions are answered from the graph for free. Other
   questions get a short plain-English lesson ("In short", "Where it lives",
   "Who depends on it", "If you change it", "Try this") built from the graph,
   including the real number of places that depend on the subject within three
   hops (`lib/graph.ts` `impactContext`, `dependentsByHop`;
   `app/api/graph/query/route.ts`).
3. **Read the project's rules.** The run clones the repository and builds a
   contribution profile from its own files: CONTRIBUTING, PR template,
   `AGENTS.md` or `CLAUDE.md`, AI policy, DCO sign-off, CLA, and the commit
   trailer it expects (`lib/contrib-profile.ts`). The guards below run here, before any model
   spend.
4. **Triage.** One cheap call on the fast model decides whether the issue is
   worth a full run. A live run is refused if triage says no (`lib/triage.ts`).
5. **Fix and test in an exec box.** The agent (Claude Code, or locally the
   Codex CLI) works through opensrcer's repository tools (`mcp-server/`). With
   an exec box it can edit files and run the project's own installs and tests
   in a container or VM that holds no credentials (`lib/exec-box.ts`). Its
   instructions ask it to list every variant the issue describes, look for
   sibling cases of the same root cause, and add one test per variant
   (`lib/agentic-dispatcher.ts` `buildExecPrompt`).
6. **Verify on the host.** The agent declares its test and lint commands. The
   host re-runs them on the final patch, then reverts the source change (keeping
   the tests) and checks that the new test fails without the fix
   (`lib/verify.ts`). The PR's "Tests run" section is built only from these
   re-runs, never from the agent's own account.
7. **Freeze a preview.** Every run ends at a preview: patch, PR text, evidence,
   warnings and blockers (`lib/run-finish.ts`, `lib/pr-preview.ts`). Nothing is
   published automatically. If the agent listed variants it did not cover with
   a test, the preview names them.
8. **Review and publish.** The person reviews the change on the run page and
   publishes it (see [The publish gate](#the-publish-gate)). The draft PR is
   opened from their GitHub account and fork.
9. **Follow up.** On the page of a PR one of the user's runs opened, opensrcer
   polls GitHub read-only and lists CI failures, review comments and merge
   conflicts. With "Help me with follow-ups" turned on for that PR, "Fix CI
   failure" and "Address review" start an ordinary run pinned to the PR head.
   It ends at the same publish gate, and publishing pushes one commit to the
   user's own open PR branch. Replies to reviewers are drafts the user posts
   (`lib/pr-followups.ts`, `lib/pr-lifecycle.ts`).

A run can be a **preview** (dry run), which can never be published, or a
**live** run, which still stops for review. Runs on closed issues are refused.

## Responsibility features

### The publish gate

On the review screen (`components/publish-panel.tsx`):

- **This project's rules.** A checklist of each rule opensrcer found and how
  this run handled it: contribution guide, PR template headings, DCO sign-off,
  CLA (the contributor must sign it), AI policy, discuss-first, other people's
  open PRs, and tests. Rows that need the person or block publishing stand out
  (`lib/project-rules.ts`).
- **Ask about this change.** A chat that answers questions from the diff, PR
  text, test results and the rules, with no repository access. It answers
  directly, explains with one concrete example from the diff (values quoted as
  the diff or tests show them, never computed), and ends with a "Check
  yourself" question. It says when the change does not show something and
  never calls a change correct on its own authority
  (`components/change-chat.tsx`, `lib/explain.ts`). The same chat is on the PR
  page.
- **Explain it in your own words.** The person writes what was wrong, what the
  change does and how they know it works (80 to 2,000 characters). A local
  check turns back text that mostly repeats the AI's diagnosis or PR text. One
  model call then judges the explanation against the diff; it passes when the
  cause and the change are right with no mistakes (`components/own-words.tsx`,
  `lib/understanding.ts`).
- **Practice review.** Two maintainer-style questions about this diff, with
  short feedback on each answer.
- **Confirmation.** The person ticks "I've read this change and can explain it
  to reviewers." The publish API refuses without it (`lib/publish.ts`).

The published PR body gets an "In the author's words" section with the
person's explanation, above the AI-assistance section, and one line saying
what they went through (checked against the diff, practice questions answered)
(`lib/publish.ts` `withAuthorWords`).

The explanation and practice review run in the browser. They are a
comprehension aid, not a security control: if the automatic check cannot run
(no Anthropic API key, provider error), the written explanation is still
required, the practice review is skipped, and the PR line says the explanation
was not automatically checked. Follow-up commits to an existing PR skip the
own-words step but keep the confirmation.

### Guards

Checked before spend where possible, recorded on the preview, and checked
again against GitHub at publish time (`lib/contrib-guard.ts`,
`lib/agentic-dispatcher.ts`, `lib/run-finish.ts`, `lib/publish.ts`).

| Guard | Behaviour |
| --- | --- |
| The project's contribution files ban AI-generated contributions | Live run refused before spend. A preview (dry run) still runs, labeled, and is blocked from publishing. Refused again at publish. |
| A maintainer (owner, member or collaborator) on the issue asks for human-written work or refuses AI PRs | Same as an AI ban: refused before spend, preview blocked, refused at publish. The phrase list is deliberately narrow. |
| Someone's open PR already targets the issue | Same: refused before spend, preview blocked, refused at publish. |
| The user already has an open opensrcer PR in the repository | Refused at publish (`OPENSRCER_PRS_PER_REPO`, default 1). |
| The user published 3 PRs in the last 24 hours | Refused at publish (`OPENSRCER_DAILY_PR_CAP`, default 3). |
| Project or issue label asks to discuss or get assigned first | Warning, and a drafted issue comment is the suggested path. Every issue run offers that comment; opensrcer never posts it. |
| Verification failed on the final patch | Publishing blocked. |
| Patch touches `.github/workflows/` (or compiled code in Python-only scopes) | Publishing blocked. |
| Patch produced by the scripted stand-in agent (test harness) | Never publishable. |

Follow-up runs on the user's own PR skip the competing-PR and cap checks but
keep the AI-policy refusal.

### AI disclosure

Every public PR body includes an "AI assistance" section naming opensrcer, the
model and provider, that the author asked for and reviewed the change, and
exactly what was verified. The commit carries an `Assisted-by: <model> via
opensrcer` trailer, or the trailer key the project prescribes, plus a DCO
sign-off where required. Template checkboxes about AI use are ticked. Drafted
comments carry a short note too. Only private-organization runs can turn
disclosure off (`OPENSRCER_AI_DISCLOSURE=0`) (`lib/disclosure.ts`).

### Isolation

- **Local exec box** (`OPENSRCER_EXEC`, default `auto`): a throwaway Docker
  container from `opensrcer-exec:2`, non-root, all capabilities dropped,
  `no-new-privileges`, port bound to 127.0.0.1, no credential in its
  environment. Nothing from the host is bind-mounted; the server script is
  copied in with `docker create` and `docker cp`. Per-repository named volumes
  cache packages and installed environments. Without a Docker daemon, `auto`
  logs that the run is unverified and uses the text-diff path. `host` is an
  explicit single-user opt-in and is not an isolation boundary.
- **Hosted exec VM** (`OPENSRCER_HOSTED_EXEC=1`, off by default in code): a
  second Vercel Sandbox VM per run with no GitHub token, provider key or Blob
  token. Its egress is limited to package registries and GitHub hosts
  (`EXEC_EGRESS` in `lib/sandbox-egress.ts`; `lib/cloud-exec.ts`). The agent
  VM keeps its own allowlist plus exactly one more host: its own exec VM.
- Workers get an allowlisted environment. Generated changes pass a Gitleaks
  scan (deleted and context lines included; target ignore files and inline
  allow comments cannot weaken it) before publishing. An optional Gemini review
  of the patch can block on a critical verdict (`OPENSRCER_GEMINI_GATE`).

## Paying for runs

Runs prefer the user's own subscription (Settings, "How runs are paid for";
`lib/run-payment.ts`):

1. Claude subscription.
2. ChatGPT plan through the Codex CLI, local only.
3. Anthropic API key, used only if the user ranks it first or turns on "Use my
   API key when my plan is unavailable" (off by default).

Locally (`AUTH_DISABLED=1` in development, or `OPENSRCER_LOCAL_SUBSCRIPTION=1`
on a single-operator self-hosted instance) the CLIs' existing logins are used.
Never set `OPENSRCER_LOCAL_SUBSCRIPTION` where other people sign in: their runs
would bill the operator's plan.

Hosted, runs use the user's Anthropic API key. Signing in to Claude inside the
run's own VM is gated by `OPENSRCER_HOSTED_SUBSCRIPTION=1`, which is off by
default (`lib/hosted-sign-in.ts`). ChatGPT plans are not offered hosted.

Subscription runs are capped by turns and wall clock; API-key runs also by
dollars (`lib/limits.ts`). "Ask about this change", the own-words check, the
practice review and natural-language graph answers use the Anthropic API key
from Settings.

## Architecture

```text
Browser -> Next.js (Vercel) -> Auth0 / GitHub OAuth
            ├─ Private Blob: runs, summaries, graphs, cancellation, follow-up state
            ├─ Agent VM (Vercel Sandbox, egress allowlist)
            │    -> Claude Code + opensrcer repository tools (MCP)
            │    └─ Exec VM (OPENSRCER_HOSTED_EXEC=1): installs, tests, re-runs; no credentials
            └─ Push VM: publishes the reviewed preview as a draft PR from the user's account
```

Workers stop after 40 minutes. Blob leases cap concurrent runs across web
instances (`OPENSRCER_AGENT_SLOTS`: 3, or 2 with the hosted exec VM). A
versioned worker protocol (currently 7) refuses incompatible snapshots, and
cancellation markers stop late worker uploads from reviving a stopped run.

Locally and in the Docker image, one Node process runs the agent CLI with the
MCP server and, when Docker is available, the exec box. The Docker image keeps
history in volumes but does not resume active jobs after a restart. Details are
in [DEPLOYMENT.md](DEPLOYMENT.md).

## Local development

Use Node.js 24, Git and the GitHub CLI. Agent runs need the Claude Code CLI
(or Codex) and Gitleaks. Verified runs need Docker and the exec image. Graphs
need Python 3.11 or later.

```sh
npm ci
npm --prefix mcp-server ci
npm --prefix mcp-server run build
cp .env.example .env.local        # PowerShell: Copy-Item .env.example .env.local
docker build -t opensrcer-exec:2 -f scripts/exec-image.Dockerfile scripts
```

### Without Auth0

Leave the Auth0 domain and client values unset and set:

```dotenv
AUTH_DISABLED=1
AUTH0_SECRET=<unique-local-encryption-secret>
APP_BASE_URL=http://localhost:3000
# GITHUB_TOKEN=<optional; honored only with AUTH_DISABLED=1>
```

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run dev
```

Open [localhost:3000](http://localhost:3000). `npm run dev` binds to 127.0.0.1;
with auth off, anyone who reaches the port acts as you. This mode is refused in
production and does not test the real OAuth flow. Sign in to the CLIs with
`claude auth login` and `codex login` to use your subscriptions. On Windows set
`OPENSRCER_CODEX_BIN` to `codex.exe`.

### With Auth0

Configure `AUTH0_SECRET`, `APP_BASE_URL`, `AUTH0_DOMAIN` (bare host such as
`example.us.auth0.com`), `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET`, and
enable the GitHub social connection.

- Allowed callback URL: `http://localhost:3000/auth/callback`
- Allowed logout URL: `http://localhost:3000`
- Session token claim: `https://opensrcer.dev/github_token`

An Auth0 Action must place the user's GitHub provider token in that claim. The
app strips it from the browser-facing profile ([lib/auth0.ts](lib/auth0.ts),
[lib/auth-session.ts](lib/auth-session.ts)).

For graphs, install `requirements-graph.txt` in a virtual environment and set
`OPENSRCER_GRAPH_PYTHON` to its Python.

### Docker and hosted

`docker compose --env-file .env.local up --build -d` runs the packaged
single-instance build in production mode with real Auth0. Vercel deployment
needs a private Blob store, Sandbox access and a worker snapshot built with
`scripts/create-worker-snapshot.mjs`. Both are described in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Environment variables that matter

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTH0_SECRET`, `APP_BASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | none | Sign-in. `AUTH0_SECRET` also encrypts the provider-key cookie. |
| `AUTH_DISABLED` | unset | `1` skips auth for local development; refused in production. |
| `OPENSRCER_EXEC` | `auto` | `auto`, `docker`, `host`, `remote` or `off`. |
| `OPENSRCER_EXEC_IMAGE` | `opensrcer-exec:2` | Image for the local exec box. |
| `OPENSRCER_HOSTED_EXEC` | off | `1` gives hosted runs a credential-free exec VM. |
| `OPENSRCER_HOSTED_SUBSCRIPTION` | off | `1` offers Claude sign-in inside the hosted run VM. |
| `OPENSRCER_LOCAL_SUBSCRIPTION` | off | `1` uses the host's CLI logins; single-operator instances only. |
| `OPENSRCER_PRS_PER_REPO` / `OPENSRCER_DAILY_PR_CAP` | 1 / 3 | Publish caps per user. |
| `OPENSRCER_AI_DISCLOSURE` | on | `0` turns disclosure off for private-organization runs only. |
| `OPENSRCER_RUN_TESTS` | `off` | Legacy host test runner. Runs repository code as the server user; leave off and use the exec box. |
| `OPENSRCER_ACCESS`, `OPENSRCER_INVITED_GITHUB_IDS` | open | `invite` makes the app invite-only by numeric GitHub id. |
| `BLOB_READ_WRITE_TOKEN`, `OPENSRCER_WORKER_SNAPSHOT_ID` | none | Hosted storage and worker snapshot. Hosted mode is automatic on Vercel (`OPENSRCER_EXECUTION=sandbox` elsewhere). |

Run-scale knobs (turns, budgets, timeouts, exec box memory and CPU) are in
`lib/limits.ts`. Provider API keys are entered in Settings and stored in an
encrypted, account-bound `httpOnly` cookie; there is no server-side fallback.

## Testing

```sh
npm test                  # unit tests (node --test, lib/__tests__)
npm run typecheck
npm run lint
npm run build:worker
npm --prefix mcp-server test
npm run build
```

CI (`.github/workflows/ci.yml`) has four jobs:

- **secrets**: Gitleaks over the full Git history.
- **check**: dependency audits, typecheck, lint, unit tests, worker build, MCP
  server build/audit/tests, the real Claude CLI's restricted tool
  configuration (`smoke-worker-tools.mjs`), the production build, then against
  a running server: `smoke-production`, `smoke-session`, `smoke-browser`,
  `smoke-beginner`, `smoke-review`, `smoke-lists`, `smoke-graph-ui`; the
  unconfigured-Auth0 smokes; and the invite-only smoke.
- **graph**: installs and audits the pinned graph runtime and builds a real
  graph (`smoke-graph.mjs`).
- **container**: builds the production image, requires a healthy boot, and runs
  `smoke-production` and `smoke-secret-gate` inside it.

CodeQL runs separately (`codeql.yml`), and `uptime.yml` checks production every
30 minutes. Browser smokes use mocked APIs and fake sessions; they do not prove
live OAuth or paid provider behavior. Manual commands are in
[DEPLOYMENT.md](DEPLOYMENT.md#repeatable-checks).

Scripts for real runs, not in CI: `scripts/smoke-dispatch.cjs` (end-to-end
dispatch on a real issue without publishing; `--plan` swaps the model for the
scripted stand-in), `scripts/smoke-codex-tools.mjs`, and
`scripts/warm-exec.cjs` (pre-install a repository's exec environment).

### Evaluating on merged fixes

`scripts/eval-merged.cjs <owner/repo> <merged PR #>` is a SWE-bench-style
replay. It pins the checkout to the commit before a human fix, runs opensrcer
as a dry run on the linked issue, then applies only the human PR's test changes
in the exec box and runs them with opensrcer's patch and with its source change
reverted. Nothing is pushed or posted. Results so far:

- React #37795 and Flask #6093: the maintainers' tests pass on opensrcer's fix.
  Flask's tests were written by the issue reporter.
- pydantic #14041 and vLLM #58227: verified, but narrower than the maintainers'
  fix.

## Project layout

| Path | Contents |
| --- | --- |
| `app/` | Next.js pages and API routes (`app/api/`), including `/demo` (product tour) and `/demo/stage` (presenter demo). |
| `components/` | React UI: publish panel, change chat, own-words gate, scanners, tour. |
| `lib/` | Server logic: dispatch, guards, verification, exec box, hosted workers, payment, GitHub. Tests in `lib/__tests__/`. |
| `mcp-server/` | The repository tools the agent uses (read, search, definitions, graph queries; edit and run commands with an exec box). Own package. |
| `scripts/` | Hosted worker entry points, exec server and image, snapshot builder, smokes, eval and lifecycle scripts. |
| `public/` | Static assets for the demos. |
| `.github/workflows/` | CI, CodeQL and uptime. |
| `Dockerfile`, `compose.yaml` | Single-instance production image. |

## Limitations

- opensrcer does not run the project's own GitHub Actions. Verification re-runs
  the targeted tests and lints the agent declared, in the exec box. The
  project's CI runs only after the PR is opened, where the follow-up loop can
  pick up a failure.
- Without Docker locally, or without the hosted exec VM, runs use the text-diff
  path and are clearly marked unverified.
- A verified fix can still be narrower than what a maintainer would write
  (pydantic #14041 and vLLM #58227 above). The instructions to cover variants
  and sibling cases reduce this; they do not remove it.
- Guards rely on text heuristics: the AI-policy and maintainer-comment phrase
  lists can miss wording they do not know.
- The own-words check and practice review are a comprehension aid in the
  browser, not an enforcement mechanism.
- Hosted Claude sign-in is off by default. Hosted runs otherwise need the
  user's Anthropic API key, and ChatGPT plans are local only.
- Large installs (for example CPU torch) can use most of a hosted run's 40
  minutes.
- Issue scoring is heuristic. Graphs are capped at 8 MB and four-minute builds.
  The Docker runtime has no restart recovery.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and data handling.

## Contributing

Open an issue describing the problem or intended behavior before a substantial
change. Keep PRs focused, include relevant validation, and update
DEPLOYMENT.md when runtime requirements change. Never include credentials,
private repository content or environment files in an issue or PR.

## License

[MIT](LICENSE).
