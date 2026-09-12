# Deployment and release checks

## Vercel deployment (migration in progress)

Vercel serves Next.js; isolated Vercel Sandboxes execute agent jobs. Private Blob
stores run results, cancellation markers, organization connections, and shared
fixes. Shared fixes stop resolving after 30 days and expired objects are removed
opportunistically. Jobs receive only user provider credentials and two write tokens,
each scoped to its full run record or compact history summary. The Runs page polls
summaries without repeatedly downloading live logs. Three Blob leases bound agent concurrency across web instances.
Workers stop after 40 minutes; abandoned records expire after 45 minutes.

1. Link the repository to the intended Vercel project. The committed
   `vercel.json` supplies the required install command.
2. Configure the five Auth0 values from `.env.example`, a private Blob store
   (`BLOB_READ_WRITE_TOKEN`), and Vercel Sandbox access through project OIDC.
3. From an authenticated environment, run
   `node scripts/create-worker-snapshot.mjs <full-committed-sha>`.
   Save its output as `OPENSRCER_WORKER_SNAPSHOT_ID` in the project.
   Rebuild this snapshot whenever agent or MCP code changes.
4. Deploy, configure Auth0 callback/logout origins, and verify health, login,
   key storage, preview, cancellation, and controlled live PR creation.

The cloud path has passed local compilation and unit tests; it has not yet been
provisioned or exercised against Vercel. Agent runs, exploration, deep fixes, graph generation, and patch pushes use
isolated workers. Quick fixes, replies, and graph questions use bounded API
requests. Activity, PR history, and graph storage are scoped to their owners. Do not treat deployment alone as release
acceptance. Repository test execution remains off inside workers because tests
could access user credentials supplied to the agent.

## Local single-instance alternative

The Docker path needs one long-lived Node process, persistent disk, and CLI
tools. Its local dispatch ownership and capacity remain process-local. It allows
three simultaneous runs, including PR post-processing; excess submissions get
HTTP 429. Local runs do not survive process restarts.

## Start a single instance

1. Copy `.env.example` to `.env.local` and set the five required Auth0 values.
   Generate a unique `AUTH0_SECRET` with `openssl rand -hex 32`. Keep this file
   outside source control. Set `APP_BASE_URL` to the public HTTPS origin.
2. In Auth0, allow `<origin>/auth/callback` and the same origin for logout. Enable
   the GitHub connection and the token-to-session Action described in README.
3. Run `docker compose --env-file .env.local up --build -d`.
4. Put an HTTPS reverse proxy in front of `127.0.0.1:3000`. Preserve cookies and
   streaming responses. Configure the proxy for the long-running SSE requests.
5. Visit `/api/health`. `status: degraded` identifies missing runtime tools;
   HTTP 200 means the server is alive, not that GitHub or Anthropic works.
6. Sign in with GitHub, enter an Anthropic key in Settings, and preview a small
   issue in a repository you own. Confirm the log reaches a terminal state and
   that preview creates no PR. Then test a live run on that controlled repository.

The Compose configuration persists dispatch history, shared fixes, cloned
repositories, and generated graphs. Back up all four volumes and keep `AUTH0_SECRET` stable. Drain
active runs before restarting. There is no durable job queue or restart recovery
yet, so a rolling deployment is not safe while jobs are running.

Target-repository test execution is **off** in Compose. Those tests execute
repository-controlled commands on the host; a worktree and a non-root user are
not a security sandbox. Keep this off until execution runs in isolated workers
without the web server's secrets or filesystem. Such runs must remain unverified
in the UI. The current container is suitable for controlled staging, not an
unrestricted public multi-tenant execution service.

## Repeatable checks

```sh
npm ci --legacy-peer-deps
npm test
npm run typecheck
npm audit --audit-level=high
npm --prefix mcp-server ci
npm --prefix mcp-server run build
npm --prefix mcp-server audit --audit-level=high
npm run build
python -m pip install -r requirements-graph.txt
node scripts/smoke-graph.mjs
# In another terminal, with Auth0 configured:
npm start -- --port 3100
node scripts/smoke-production.mjs
npx playwright install chromium
node scripts/smoke-browser.mjs
```

The HTTP smoke script checks six pages, anonymous authorization including
middleware-bypass headers, and 200 health requests with 20 concurrent clients.
It does not call an AI provider, open a PR, or prove authenticated workflows.
The browser smoke test covers public pages at desktop/mobile widths, demo tabs,
login prompts, and authentication-link prefetching. Mocked API interactions check
preview retries, both issue actions, and failed cancellation recovery without
starting real jobs.
Set `SMOKE_BASE_URL` to test a staging deployment. CI runs the same checks.

Next.js stays on the patched 15.x line. Its pinned PostCSS dependency is
overridden to 8.5.28 for security fixes; remove the override when the framework
ships a safe dependency. Both package lockfiles must remain committed.

## Acceptance evidence (September 12, 2026)

The production acceptance evidence on the current main branch includes:

- 152 application tests, MCP tests, app/worker type checks, dependency audits,
  the real restricted Claude CLI, and the optimized production build.
- The production Docker image built on a Linux runner, booted as its non-root
  user, reported every required runtime dependency healthy, and passed the HTTP
  production smoke suite from inside the container.
- Browser checks across 16 public and authenticated page states at desktop and
  mobile widths: login prompts, settings recovery, repository pagination/retry,
  issue previews, PR review, graph interactions, demo transitions, and
  cancellation error recovery. Serious and critical Axe findings are gated.
- PR checks include the actual head repository as the push target, no automatic
  write retries, recoverable diff errors, single comment submission, and fresh
  follow-up state for each generated fix. Browser mutations use mocked APIs.
- Local encrypted-session tests verify private profile fields, settings round
  trips, and isolation between accounts. These use an isolated fake Auth0
  configuration; they do not exercise an OAuth callback against a real tenant.
- Local no-Auth0 mode passed middleware and private-API requests, encrypted key
  round trips, and desktop/mobile browser rendering. The development CSP allows
  Next.js evaluation only outside production; the production smoke test rejects
  any deployed policy containing `unsafe-eval`.
- A separate production server with Auth0 deliberately unconfigured kept the
  landing, demo, and login pages available, reported degraded health, and returned
  cache-disabled 503 responses from protected APIs instead of throwing in middleware.
- Read-only GitHub integration through the production app returned 200 for owned
  and contributed repositories, cursor pagination, PR lists, issue scans, PR
  comments, and diffs. The PR head repository matched GitHub's source metadata.
  This used the existing local GitHub credential in memory and a local session
  fixture, with no GitHub writes or paid provider requests.
- 200 health requests at concurrency 20 completed with p95 63 ms on the CI app
  server and 37 ms in the production container. This is a smoke result, not an
  authenticated workload or production capacity estimate.
- Full-history secret scanning passed; GitHub reported zero secret-scanning
  alerts. The real pinned Claude CLI exposed nine read-only MCP tools and no
  built-in tools in its restricted worker configuration.
- The landing, settings, discovery, suggested-issue, and repository-scan journeys were reviewed at desktop and
  mobile sizes using the existing Geist and Phosphor design stack. The browser
  gate covers the discovery controls, help-dialog focus, issue filtering and actions, and the mobile
  onboarding prompt. The local optimized build reported an LCP of 1,428 ms and
  CLS below 0.001; CI repeats the browser behavior and accessibility gates.
- Hosted worker jobs use explicit input allowlists. Target-controlled install
  and test commands cannot receive the PR workflow's GitHub or provider tokens
  through their process environment. Repository tests remain disabled in the
  hosted worker until the execution itself is isolated from the worker host.
- Hosted run history uses compact owner-scoped summaries. A one-time fallback
  backfills recent legacy records, and the worker protocol prevents an older
  snapshot from starting without the summary writer.

CI runs `smoke-session.mjs`, `smoke-browser.mjs`, `smoke-review.mjs`,
`smoke-lists.mjs`, `smoke-graph-ui.mjs`, and the HTTP/graph/runtime checks.
Use the isolated environment defined in `.github/workflows/ci.yml` for the
session fixtures; never use its fake credentials for a deployment.

Hosting setup is paused at the user's request. The gates below remain open.

## Outstanding release gates

- Connect the selected Vercel account and configure Auth0, private Blob, and worker snapshots.
- If the local alternative is used, exercise the CI-verified Linux image on its
  target host with the real reverse proxy and persistent volumes.
- Verify Auth0 login/logout, GitHub token scopes, saved keys, preview, live PR,
  cancellation, and private-org access against controlled test repositories.
- Isolate repository code execution before enabling it for untrusted users.
- Verify the cloud worker lifecycle and all UI entry points on the deployed project.
- Load-test authenticated scans and real jobs against an agreed workload and
  provider budget; health endpoint concurrency is only a smoke test.

The graph worker was also exercised locally against this public repository:
1,322 nodes and 2,798 edges in 15.5 seconds, with no provider credentials.
Its pinned Python dependencies passed pip-audit. This is a local runtime check,
not a Vercel deployment test. Graphs are capped at 8 MB and builds at four minutes.

## Public repository secret review

The September 11, 2026 review scanned all fetched Git history with Gitleaks
8.30.1. Three findings were verified false positives: two demo log strings with
only a token prefix, and one historical Slack URL-format test containing fake
markers in every token segment. `.gitleaksignore` exempts only those exact
commit/file/line fingerprints. The complete history scan then passed.

CI repeats the full-history scan and dependency audits. Environment files,
private key files, scanner reports, and runtime caches are excluded from Git and
the container build where applicable. No actual credential was identified in
this scan; automated scanning cannot establish that every possible secret or
sensitive value is absent. If one is later identified, revoke it first and
coordinate history removal rather than merely deleting the current file.

API-key cookie upgrade: saved provider keys are now cryptographically bound to the signed-in account and expire after 30 days. Users with an older cookie must enter their keys again; an unbound legacy cookie is deliberately rejected. Logout deletes the key cookie.
