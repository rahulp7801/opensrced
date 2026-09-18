# opensrcer

[![CI](https://github.com/rahulp7801/opensrced/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rahulp7801/opensrced/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rahulp7801/opensrced/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/rahulp7801/opensrced/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/rahulp7801/opensrced?include_prereleases)](https://github.com/rahulp7801/opensrced/releases)

A workspace for turning GitHub issues into reviewed draft pull requests.
Discover issues, explore the affected code, generate a patch with a bounded AI
agent, and review the result before publishing it.

[Try the demo](https://opensrced.vercel.app/demo) ·
[Deployment guide](DEPLOYMENT.md) ·
[Report a bug](https://github.com/rahulp7801/opensrced/issues) ·
[Releases](https://github.com/rahulp7801/opensrced/releases)

## Project status

**Beta — authenticated production acceptance is still pending.** The web app
is deployed on Vercel and its public demo is available. Auth0, private Blob
storage, and worker snapshots must be configured and tested before hosted agent
workflows can be used. Protected operations fail closed while that configuration
is missing.

| Environment | Branch | Endpoint | Access |
| --- | --- | --- | --- |
| Production | `main` | [opensrced.vercel.app](https://opensrced.vercel.app) | Public preview and demo |
| Staging | `staging` | [opensrced-staging.vercel.app](https://opensrced-staging.vercel.app) | Vercel authentication required |

`GET /api/health` reports readiness and missing dependencies. HTTP 200 confirms
liveness; `status: degraded` means the application is not ready for its complete
workflow. Release acceptance and outstanding gates are tracked in
[DEPLOYMENT.md](DEPLOYMENT.md#outstanding-release-gates).

## What it does

| Workflow | Capabilities |
| --- | --- |
| Discover | Search public repositories, score issues, and narrow work by scope. |
| Explore | Inspect repository code with read-only tools and codebase graphs. |
| Fix | Generate a patch in an isolated worker with a spend limit and timeout. |
| Review | Inspect logs, diffs, review feedback, and verification status. |
| Publish | Open a draft PR using the requesting user's GitHub identity after configured gates pass. |

Private organization workflows use an optional GitHub App connection. The demo
illustrates the interface without an account, provider key, or live agent run.
AI-generated patches require human review and validation in the target repository.

## Architecture

The Next.js application handles sessions, UI, and bounded API requests. Long
agent jobs run separately in Vercel Sandbox; private Vercel Blob storage retains
account-scoped results and coordinates concurrency across web instances.

```text
Browser → Next.js on Vercel → Auth0 / GitHub OAuth
                         ├─ Private Blob: runs, history, graphs, cancellation
                         └─ Vercel Sandbox worker
                              → Claude CLI + read-only repository MCP tools
                              → Patch + secret scan + optional Gemini review
                              → Draft GitHub pull request
```

Workers have a 40-minute limit. Blob leases cap concurrent agent jobs, compact
summaries support history views, and cancellation markers prevent late worker
uploads from reviving stopped runs. A versioned worker protocol rejects
incompatible snapshots. Deployment details are in [DEPLOYMENT.md](DEPLOYMENT.md).

The Docker image provides a single-instance alternative with the required CLI
and graph tools. It uses persistent volumes for history but does not resume
active jobs after a process restart.

## Local development

Use **Node.js 24**, Git, and GitHub CLI. Graph features additionally require
Python 3.11 or later. Local agent execution requires Claude CLI and Gitleaks;
the Docker image packages those runtimes.

```sh
npm ci --legacy-peer-deps
npm --prefix mcp-server ci
npm --prefix mcp-server run build
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local` for the last command.
`--legacy-peer-deps` is required because the diff viewer has not declared React
19 support. Keep `.env.local` out of source control.

### Without Auth0

Leave the Auth0 domain and client values unset, then set these in `.env.local`:

```dotenv
AUTH_DISABLED=1
AUTH0_SECRET=<unique-local-encryption-secret>
APP_BASE_URL=http://localhost:3000
# GITHUB_TOKEN=<optional-token-for-local-github-operations>
```

Generate the secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run dev
```

Open [localhost:3000](http://localhost:3000). Provider keys are entered in
Settings and stored in an encrypted cookie. This local mode is refused in
production. It does not validate the real OAuth login flow.

### With Auth0

Disable local bypass and configure `AUTH0_SECRET`, `APP_BASE_URL`,
`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_CLIENT_SECRET`. Use a bare domain
such as `example.us.auth0.com` and enable the GitHub social connection.

- Allowed callback URL: `http://localhost:3000/auth/callback`
- Allowed logout URL: `http://localhost:3000`
- Session token claim: `https://opensrcer.dev/github_token`

The Auth0 Action must place the user's GitHub provider token in that claim.
The application strips it from the browser-facing profile. See
[lib/auth0.ts](lib/auth0.ts) and [lib/auth-session.ts](lib/auth-session.ts).

For graphs, install `requirements-graph.txt` in a Python virtual environment
and set `OPENSRCER_GRAPH_PYTHON` to that environment's Python executable.
For the packaged local runtime:

```sh
docker compose --env-file .env.local up --build -d
```

Docker runs in production mode and requires real Auth0 configuration. See the
[single-instance setup](DEPLOYMENT.md#start-a-single-instance) for volumes,
streaming, and reverse-proxy requirements.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm audit --audit-level=high
npm run build:worker
npm --prefix mcp-server test
npm --prefix mcp-server audit --audit-level=high
npm run build
```

CI also scans the complete Git history with Gitleaks, checks the real Claude
CLI's restricted tool configuration, builds a graph, boots the production
Docker image, and runs HTTP, desktop/mobile browser, accessibility, and
concurrency smoke tests. Browser coverage includes unavailable authentication
and mocked authenticated interactions; it does not prove live OAuth or paid
provider behavior. Repeatable smoke commands are in
[DEPLOYMENT.md](DEPLOYMENT.md#repeatable-checks).

New commits cancel superseded CI runs on the same branch. A cancelled historical
run is expected; use the checks attached to the exact commit being promoted.

## Security and limitations

GitHub operations use the requesting user's credentials. Provider keys are
encrypted, bound to the signed-in account, and held in an `httpOnly` cookie with
a 30-day maximum age. Workers receive an allowlisted environment and read-only
repository tools. Secret scanning gates generated changes before optional
external review or publication. Private records are scoped to their owners.

Publication scanning includes the raw patch's deleted and context lines as well
as the resulting source. Target scan configuration, ignore files, and inline
allow comments cannot weaken that gate. Direct Anthropic text requests also
reject recognized credential patterns in source or prompt content before
contacting the provider; this heuristic does not identify every possible secret.

Hosted target-repository install and test commands remain disabled because
repository-controlled code must be isolated from worker credentials. Patches
remain visibly unverified until checked in the target repository's CI or a
separate credential-free sandbox. Other limits include heuristic issue scoring,
8 MB graph artifacts, four-minute graph builds, and no restart recovery in the
Docker runtime. See [SECURITY.md](SECURITY.md) for private vulnerability reporting
and data-handling expectations.

## Contributing

Open an issue describing the problem or intended behavior before a substantial
change. Keep PRs focused, include relevant validation, and update deployment
documentation when runtime requirements change. Never include credentials,
private repository content, or deployment environment files in an issue or PR.

## License

[MIT](LICENSE).
