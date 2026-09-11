# Deployment and release checks

## Vercel deployment (migration in progress)

Vercel serves Next.js; isolated Vercel Sandboxes execute agent jobs. Private Blob
stores run results, cancellation markers, organization connections, and shared
fixes. Jobs receive only user provider credentials and a write token scoped to
one result file. Three Blob leases bound agent concurrency across web instances.
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
provisioned or exercised against Vercel. Exploration, graph tools, PR follow-up
actions, and activity statistics still need their remaining local-process or
filesystem dependencies migrated. Do not treat deployment alone as release
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

The Compose configuration persists dispatch history, shared fixes, and cloned
repositories. Back up all three volumes and keep `AUTH0_SECRET` stable. Drain
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
# In another terminal, with Auth0 configured:
npm start -- --port 3100
node scripts/smoke-production.mjs
```

The HTTP smoke script checks six pages, anonymous authorization including
middleware-bypass headers, and 200 health requests with 20 concurrent clients.
It does not call an AI provider, open a PR, or prove authenticated workflows.
Set `SMOKE_BASE_URL` to test a staging deployment. CI runs the same checks.

Next.js stays on the patched 15.x line. Its pinned PostCSS dependency is
overridden to 8.5.28 for security fixes; remove the override when the framework
ships a safe dependency. Both package lockfiles must remain committed.

## Outstanding release gates

- Connect the selected Vercel account and configure Auth0, private Blob, and worker snapshots.
- Build and boot the Linux container on the target host; only Compose syntax and
  the local Node production build have been verified in this environment.
- Verify Auth0 login/logout, GitHub token scopes, saved keys, preview, live PR,
  cancellation, and private-org access against controlled test repositories.
- Isolate repository code execution before enabling it for untrusted users.
- Finish migration of the remaining routes and verify the cloud worker lifecycle.
- Load-test authenticated scans and real jobs against an agreed workload and
  provider budget; health endpoint concurrency is only a smoke test.

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
