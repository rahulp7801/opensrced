# opensrcer

opensrcer helps a signed-in GitHub user find an issue, understand the affected
code, generate a bounded patch, review it, and open a draft pull request.

The application is under active production hardening. The application test,
browser smoke, dependency audit, secret scan, graph runtime, and Linux container
checks run in CI. The Vercel project, Auth0 tenant, private Blob store, and worker
snapshot still need to be provisioned and tested together before the hosted app
is considered released. See [DEPLOYMENT.md](DEPLOYMENT.md) for the current
acceptance evidence and open release gates.

## Product workflow

1. **Find** searches public GitHub repositories and scores open issues.
2. **Explore** answers questions about a repository with read-only code tools.
3. **Fix** starts an isolated Claude agent with a user-controlled spend limit.
4. **Review** shows the run log, generated patch, check results, and PR state.
5. **Ship** opens a draft pull request only after the configured gates pass.

The public `/demo` page exercises the interface without an account or API key.
Authenticated workflows use the signed-in user's GitHub identity and the
provider keys they save in Settings.

## Runtime architecture

The production design separates the web application from long-running work:

```text
Browser
  -> Next.js application on Vercel
       -> Auth0 session and GitHub OAuth token
       -> private Vercel Blob records
          -> compact run summaries for dashboard polling
       -> bounded GitHub and provider requests
       -> isolated Vercel Sandbox worker
            -> Claude CLI with read-only repository MCP tools
            -> shallow repository clone
            -> patch, Gitleaks check, optional Gemini review
            -> draft pull request
```

Vercel Blob stores account-scoped runs, cancellation markers, graphs,
organization connections, activity, and shared fixes. Blob leases cap concurrent
agent jobs across web instances. Sandbox workers have a 40-minute limit and run
records expire after 45 minutes.

The Docker image is a supported single-instance staging alternative. It contains
the Node application, Claude CLI, Gitleaks, GitHub CLI, Python graph runtime, and
MCP server. Persisted history survives through the mounted volumes, but active
subprocesses do not resume after a process restart, so this mode does not provide
rolling deployment or durable queue semantics.

Three legacy deterministic endpoints can use an external `CONTRIBAI_BIN` during
local development. They are not part of the Vercel execution path. The product
UI uses `/api/run/agentic`.

## Safety and data handling

- Auth0 gates authenticated pages and API routes. Mutating routes also perform
  their own session checks.
- GitHub operations use the current user's OAuth token. There is no deployer
  credential fallback in authenticated operation.
- Anthropic and Gemini keys live in an encrypted, account-bound, `httpOnly`
  cookie with a 30-day maximum age. `AUTH0_SECRET` is the encryption root.
- Agent subprocesses receive an allowlisted environment containing only the
  credentials required for that run.
- Claude runs with built-in tools disabled and only the repository's read-only
  MCP tools allowed. Issue bodies, review comments, and user prompts are treated
  as untrusted input.
- Gitleaks is a fail-closed gate before generated code can be pushed.
- Run, organization, graph, activity, and shared-fix records are scoped to their
  owners. Public shared fixes require an unguessable ID, cannot be listed, and
  expire 30 days after creation.
- Full Git history is scanned with Gitleaks in CI. GitHub currently reports no
  open secret-scanning or Dependabot alerts.

Target-repository tests remain disabled in hosted workers. Running arbitrary
repository install or test commands beside user credentials would weaken worker
isolation. A hosted patch therefore remains visibly unverified until it is
checked in the target repository's own CI or another credential-free sandbox.

## Local development

Requirements:

- Node.js 24
- Python 3.11 or later for graph features
- Git and GitHub CLI
- Auth0 credentials for authenticated workflows

Install and run:

```sh
npm ci --legacy-peer-deps
npm --prefix mcp-server ci
npm --prefix mcp-server run build
cp .env.example .env.local
npm run dev
```

Set these five Auth0 values in `.env.local`:

```dotenv
AUTH0_SECRET=
APP_BASE_URL=http://localhost:3000
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
```

Use a bare Auth0 domain such as `example.us.auth0.com`. Add
`http://localhost:3000/auth/callback` to allowed callback URLs and
`http://localhost:3000` to allowed logout URLs. Enable the GitHub social
connection. The session must receive the provider token in the custom claim
`https://opensrcer.dev/github_token`; the session hook removes that credential
from `/auth/profile` before it reaches browser code.

For local development without an Auth0 tenant, leave the domain and client
values unset and use:

```dotenv
AUTH_DISABLED=1
AUTH0_SECRET=<unique-local-encryption-secret>
# GITHUB_TOKEN=<optional-token-for-github-operations>
```

The secret encrypts locally saved provider keys; it is not an Auth0 tenant
credential. This mode is refused when `NODE_ENV=production`.

Graph features also need a Python environment with
`requirements-graph.txt` installed and `OPENSRCER_GRAPH_PYTHON` set to that
environment's Python executable.

## Docker staging

```sh
docker compose --env-file .env.local up --build -d
curl http://localhost:3000/api/health
```

Persist the four volumes defined in `compose.yaml` and keep
`AUTH0_SECRET` stable. Put an HTTPS reverse proxy in front of the service and
preserve streaming responses. `/api/health` reports `degraded` when Auth0,
hosted storage, a worker snapshot, or a required local runtime tool is absent;
HTTP 200 alone is only a liveness signal.

## Vercel configuration

The hosted path requires:

| Variable | Purpose |
|---|---|
| `AUTH0_SECRET` | Auth0 session secret and provider-key encryption root |
| `APP_BASE_URL` | Public HTTPS origin |
| `AUTH0_DOMAIN` | Auth0 tenant host without a URL scheme |
| `AUTH0_CLIENT_ID` | Auth0 application client ID |
| `AUTH0_CLIENT_SECRET` | Auth0 application client secret |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob access |
| `OPENSRCER_WORKER_SNAPSHOT_ID` | Prebuilt agent worker snapshot |

Vercel supplies `VERCEL_OIDC_TOKEN` to authorize Sandbox operations. Create a
worker snapshot from an exact committed SHA:

```sh
node scripts/create-worker-snapshot.mjs <40-character-commit-sha>
```

Rebuild the snapshot whenever the agent, MCP server, graph runtime, or worker
bootstrap changes. Snapshot creation verifies every worker entry script, the
real Claude CLI's restricted MCP tool surface, and a real graph build before it
publishes an image. Increment `.opensrcer-worker-protocol` when a web change is
incompatible with existing snapshots; every cloud entry point checks that
marker before starting work. Follow the full sequence and hosted acceptance checklist in
[DEPLOYMENT.md](DEPLOYMENT.md).

Optional GitHub App support for private organizations uses
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, and
`GITHUB_APP_WEBHOOK_SECRET`. Public repository workflows do not need this app.

## Quality checks

```sh
npm test
npm run typecheck
npm run lint
npm audit --audit-level=high
npm run build:worker
npm --prefix mcp-server run build
npm --prefix mcp-server audit --audit-level=high
npm run build
node scripts/smoke-graph.mjs
node scripts/smoke-production.mjs
node scripts/smoke-browser.mjs
```

CI additionally performs a full-history Gitleaks scan, builds and boots the
Linux production image as its non-root user, verifies required runtime health,
and runs browser checks at desktop and mobile widths.

## Main API surface

| Area | Routes |
|---|---|
| Health | `GET /api/health` |
| Discovery | `GET /api/discover`, `GET /api/issues/scan`, `GET /api/issues/suggested` |
| Runs | `POST /api/run/agentic`, `GET /api/dispatches`, `GET /api/dispatches/[id]`, `POST /api/dispatches/[id]/cancel` |
| Explore and graph | `POST /api/explore`, `POST /api/graph/generate`, `POST /api/graph/query`, `GET /api/graph/[owner]/[repo]/viz` |
| Pull requests | `/api/prs`, `/api/prs/github`, `/api/prs/review`, `/api/prs/diff`, `/api/prs/fix`, `/api/prs/push`, `/api/prs/reply` |
| Settings and activity | `/api/settings/keys`, `GET /api/activity` |
| Private organizations | `/api/crucible/*` |
| Shared fixes | `POST /api/fixes`, `GET /api/fixes/[id]` |

All routes except health, Auth0 callbacks, the signed GitHub webhook, and a
single public shared-fix read require an authenticated session. Request bodies
and response details are best read from the route handlers while the API is
still evolving.

## Current limits

- Vercel provisioning and live OAuth acceptance have not been completed.
- Hosted target-repository tests are off, so hosted patches are unverified.
- The Runs page lists the latest 20 records; impact metrics cover the latest 50.
- The Docker mode has no durable job queue or restart recovery.
- Issue scoring and scope classification are heuristics.
- Generated diffs can still require manual repair or target-repository CI.
- Graphs are capped at 8 MB and builds at four minutes.

## License

MIT
