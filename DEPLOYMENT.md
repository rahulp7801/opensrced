# Deployment and release checks

This app needs one long-lived Node process, persistent disk, and the CLI tools
in `Dockerfile`. Do not deploy it as serverless functions or multiple replicas:
dispatch ownership and capacity are currently tracked in one process. The
agentic pipeline allows three simultaneous runs, including PR post-processing;
excess submissions receive HTTP 429. Runs do not survive a process restart.

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

- Select the hosting account, domain, and persistent storage/backup policy.
- Build and boot the Linux container on the target host; only Compose syntax and
  the local Node production build have been verified in this environment.
- Verify Auth0 login/logout, GitHub token scopes, saved keys, preview, live PR,
  cancellation, and private-org access against controlled test repositories.
- Isolate repository code execution before enabling it for untrusted users.
- Add durable jobs and shared state before scaling beyond a single process.
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
