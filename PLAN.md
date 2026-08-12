# opensrcer — remediation plan

Ordered by blast radius. Each phase is independently shippable and ends with a
runnable check. Do not batch phases — P0 changes auth behavior and you want a
clean bisect point if something breaks.

Estimated total: ~2 focused days. P0+P1 is ~4 hours and covers every real bug.

---

## P0 — Security (do today)

### 0.1 Close the prefetch auth bypass

`middleware.ts:57-59` returns `NextResponse.next()` for any request with
`purpose: prefetch` or `next-router-prefetch: 1`. Both are attacker-controlled
headers. 32 of 40 API routes have no other gate.

**Delete the block.** Prefetch requests carry cookies; `getSession()` handles
them correctly. The block was added to stop `getSession` running on RSC
prefetches — the `matcher` already excludes static assets, and the cost is a
cookie decrypt.

If prefetch latency actually regresses, narrow the skip to GET page routes only
— never `/api/*`, never non-GET:

```ts
const isPrefetch = req.headers.get("next-router-prefetch") === "1";
if (isPrefetch && req.method === "GET" && !pathname.startsWith("/api/")) {
  return NextResponse.next();
}
```

### 0.2 Add in-handler session guards (defense in depth)

Middleware must not be the only gate. Extract the pattern already used in the 11
crucible/settings routes into one helper:

```ts
// lib/require-session.ts
import { getSession } from "@auth0/nextjs-auth0";

/** Returns null when authorized, or a 401 Response to return immediately. */
export async function requireSession(): Promise<Response | null> {
  if (process.env.AUTH_DISABLED === "1") return null;
  const session = await getSession();
  if (session?.user) return null;
  return Response.json({ error: "Not authenticated" }, { status: 401 });
}
```

Add as the first line of every mutating route:

```ts
const unauth = await requireSession();
if (unauth) return unauth;
```

**Apply to** (all currently unguarded):
`api/run/{route,agentic,hunt,solve,target}`, `api/prs/{fix,push,reply,draft-reply,review,verify}`,
`api/dispatches/[id]/cancel`, `api/issues/scan`, `api/discover`,
`api/graph/generate`, `api/graph/query`, `api/fixes` (POST only — see 0.4).

**Leave public:** `api/health`, `api/crucible/github/webhook` (HMAC-authed),
`api/crucible/github/install-callback` (nonce-authed), `api/fixes/[id]` GET,
`api/fixes` GET.

Then refactor the 11 existing routes to use the helper — they currently
duplicate it inline.

### 0.3 Stop writing tokens into `.git/config`

Two leaks, same fix. Replace tokenized remote URLs with a per-invocation header
so nothing lands on disk:

```ts
// lib/git-auth.ts
export function gitAuthArgs(token?: string): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraheader=AUTHORIZATION: basic ${basic}`];
}
```

**Site A — `mcp-server/src/repo-cache.ts:80-86`.** Clone with a clean URL:
```ts
await execFileAsync("git", [
  ...gitAuthArgs(process.env.GITHUB_TOKEN),
  "clone", "--depth=1", "--single-branch",
  `https://github.com/${ref.full}.git`, dir,
]);
```
(The MCP server needs its own copy of the helper — it's a separate tsconfig.)

**Site B — `lib/agentic-pr.ts:243-245`.** Delete the `remote set-url origin
<tokenUrl>` entirely, delete the restore at `:508-511`, and pass
`...gitAuthArgs(env.GITHUB_TOKEN)` to the `push` at `:494`. This also removes
the 6 early-return paths that currently leave the token behind.

**Cleanup for machines already affected:**
```bash
git -C ~/.contribai/repos/<owner>__<name> remote set-url origin https://github.com/<owner>/<name>.git
```
Do it for every cached clone. Then rotate any GitHub App installation token
that ran through the old path.

### 0.4 Gate and bound `/api/fixes`

`app/api/fixes/route.ts` — POST is unauthenticated with a `writeFileSync` per
call. Add `requireSession()` to POST. Keep GET public (it's the share feature).
Cap the directory: if `.fixes/` exceeds 1000 entries, delete the oldest on
write. Also add `.fixes/` to `.gitignore` — three fix records are currently
committed.

**Check for P0:**
```bash
npm run dev
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/prs/push \
  -H "purpose: prefetch" -H "content-type: application/json" -d '{}'   # expect 401
grep -rn "x-access-token:" lib mcp-server/src                          # expect 0 hits
```

---

## P1 — Correctness bugs

### 1.1 Register agentic dispatches so cancel works

`lib/agentic-dispatcher.ts` never calls `registry.set` / `children.set`, so
`cancelDispatch()` (`lib/dispatcher.ts:342`) finds nothing and every agentic
cancel returns `{ok:false}`. The cancel button is dead on the primary path.

Export a registrar from `dispatcher.ts`:
```ts
export function registerDispatch(d: Dispatch, child: ChildProcess) {
  registry.set(d.id, d);
  children.set(d.id, child);
  child.on("close", () => children.delete(d.id));
}
```
Call it in **both** `startAgenticDispatch` and `startFindingDispatch` right
after `spawn` — or once, after the dedup in P4.1, which is the reason to do
P4.1 first if you'd rather not touch this twice.

### 1.2 Fix the concurrency-slot leaks

`lib/concurrency.ts` — add the wrapper and delete every manual
`acquireSlot`/`releaseSlot` pair:

```ts
export class SlotBusy extends Error {
  constructor(public key: string, public active: number, public max: number) {
    super(`Too many concurrent ${key} operations (${active}/${max}).`);
  }
}

export async function withSlot<T>(key: string, max: number, fn: () => Promise<T>): Promise<T> {
  if (!acquireSlot(key, max)) throw new SlotBusy(key, activeSlots(key), max);
  try { return await fn(); } finally { releaseSlot(key); }
}
```

**Leaking now:**
- `app/api/prs/push/route.ts:60` — acquires, then returns 401 at `:69` *before*
  the `try/finally`. Three unauthenticated hits wedge pushes until restart.
- `app/api/explore/route.ts:47` — two early returns (`:55` MCP not built,
  `:63` no key) never release.
- `app/api/prs/fix/route.ts` — releases in 8 scattered branches; correct today,
  fragile forever.

Streaming routes need care: `withSlot` must wrap until the stream *closes*, not
until the `Response` is returned. For those, release in the stream's
`cancel`/`close` handler and add an `AbortSignal` listener so a client
disconnect frees the slot.

### 1.3 Machine-specific hardcoded path

`C:/Users/rahul/crg-pkg` is the fallback in four files
(`app/api/graph/query/route.ts:339`, `:487`, `app/api/prs/verify/route.ts:364`,
`lib/graph-build.ts:92`). Nobody else has that directory, and the failure is a
confusing Python traceback.

Replace with: read `CRG_PYTHONPATH`; if unset, skip the CRG feature and return
`{ available: false, reason: "CRG_PYTHONPATH not configured" }`. One shared
`crgPythonPath()` in `lib/graph-build.ts`, imported by the other three.

**Check for P1:** start an agentic dispatch, hit cancel, confirm the process
dies and the log shows the kill marker. Then hammer `/api/prs/push` with 5
unauthenticated requests and confirm a legitimate push still works.

---

## P2 — Make the README true

Pick one per row: implement the claim, or soften the text. Do not leave the gap.

### 2.1 Test gating for public repos

`lib/agentic-pr.ts:438` — `if (args.orgCtx)` means the test suite runs **only**
for private-org flows. Every public PR opens unverified, while the dashboard
says "Verified."

**Recommended:** drop the `orgCtx` condition and run `runTests` on every flow.
The runner already returns `skipped` for unrecognized ecosystems, and `skipped`
already permits the PR. Then make the *UI* distinguish `tests_passed` from
`skipped` — right now `pr_status` has a `tests_passed` state that public flows
can never reach.

Add a `OPENSRCER_REQUIRE_TESTS=0` escape for repos with hostile test suites.

### 2.2 Gemini review is advisory, not a gate

`lib/agentic-pr.ts:402-412` logs the review and continues unconditionally.
Either ask for a structured verdict and block on `critical`:

```ts
// append to the prompt: 'End with exactly one line: VERDICT: clean|concerns|critical'
if (/^VERDICT:\s*critical/im.test(reviewResult)) {
  await cleanupWorktree();
  return { ok: false, reason: "gemini review flagged the patch as critical" };
}
```
…or change the README from "Reviews its own work" to "Annotates the PR with an
advisory review." Blocking is the better story given the project's pitch.

### 2.3 Kill or label the seeded data

`lib/seed.ts` generates fake repos and PR counts via a seeded PRNG. It backs
`/api/{stats,repos,runs,sessions,health}` and the `/runs` page renders it with
no disclaimer. `/stats` already uses the real aggregator (`lib/stats.ts`).

**Recommended:** delete `lib/seed.ts`, `lib/data.ts`, `lib/api.ts`,
`lib/enrich.ts`, and the `/runs` + `/repos` seeded paths. That's ~600 lines and
removes the `CONTRIBAI_API_URL` proxy indirection nothing uses. Point `/runs`
at `listDispatches()` instead — same data, real.

If you want the demo for screenshots, keep it behind `/demo` (which already
exists) and nowhere else.

### 2.4 Rewrite `.env.example`

Currently two commented lines; missing all five required Auth0 vars. Make it
copy-paste runnable and match the README table. Delete the `ANTHROPIC_API_KEY`
row from the README — `lib/api-keys.ts:73` has no env fallback, so that row is
fiction.

---

## P3 — Replace log-scraping with real state

The load-bearing design flaw. `listDispatches()` (`lib/dispatcher.ts:410-499`)
reads every `.log` file fully, then `enrichWithPrStatus()` (`:153`) reads each
one *again* and runs 6 regexes to reconstruct status. The UI polls it every
2.5s and the log endpoint every 1.5s, resending up to 200KB each time.

### 3.1 Status sidecars

Write `.dispatches/<id>.json` at each transition — the dispatcher already knows
these values when they happen, so nothing needs to be inferred:

```ts
type DispatchRecord = Dispatch & { pr_url?: string };
function persist(d: DispatchRecord) {
  writeFileSync(join(DISPATCH_DIR, `${d.id}.json`), JSON.stringify(d));
}
```

Call it on: spawn, `close`, auto-PR start, auto-PR result, gitleaks block, test
result. Then `listDispatches()` becomes `readdir + JSON.parse` over ~1KB files.

Keep `enrichWithPrStatus` as a **fallback for logs with no sidecar** so old
dispatches still render, and delete it once you don't care about them. Keep the
`.log` files — they're for humans, not for parsing.

### 3.2 Incremental log tailing

`app/api/dispatches/[id]/route.ts` — accept `?since=<byteOffset>`, return only
the new bytes plus the new offset. Client appends instead of replacing. Drops
per-poll transfer from ~200KB to ~2KB.

Upgrade to SSE only if polling still feels laggy after this — a 1.5s poll of a
2KB delta is fine, and SSE adds reconnect handling you don't need yet.

### 3.3 Cross-process clone locking

`~/.contribai/repos/<repo>/` is shared by the MCP server, `lib/pre-index.ts`,
and `agentic-pr`'s worktree, but the only lock is an in-memory `Map` inside one
process (`mcp-server/src/repo-cache.ts:56`). A TTL-triggered `rm -rf` while
another run holds a worktree there will corrupt an in-flight dispatch.

Lazy fix: `proper-lockfile` on the clone dir, or an `O_EXCL` lockfile with a
stale timeout. Also stop using `.git` dir mtime for the TTL check (`:69`) —
git touches it on every operation, so a busy repo never refreshes.

---

## P4 — Delete duplication

### 4.1 Collapse the two dispatchers

`startFindingDispatch` (`lib/agentic-dispatcher.ts:604-757`) is a ~150-line
copy of `startAgenticDispatch`: identical spawn args, timeout, kill logic, close
handler, auto-PR hook. Only the prompt builder and the branch-name source
differ.

```ts
type DispatchTarget =
  | { kind: "issue"; issueNumber: number }
  | { kind: "finding"; finding: FindingInput };

function startDispatch(repoUrl: string, target: DispatchTarget, opts: StartAgenticOpts): Dispatch
```
Keep both exported names as thin wrappers so callers don't change. Net −150
lines, and P1.1's `registerDispatch` call happens once.

### 4.2 One diff-apply ladder

Two divergent implementations:
- `lib/agentic-pr.ts:337-396` — 4 git tiers + GNU patch, `--index --recount`
- `app/api/prs/push/route.ts:100-140` — 4 different git tiers + `patch -p1` +
  `patch -p0` + a bespoke `tryDirectEdit`

Extract `lib/apply-diff.ts` exporting
`applyDiff(dir, diff, opts) → {ok, tier} | {ok:false, errors}`. Take the union
of strategies (the push route's `-p0` fallback and `tryDirectEdit` are real
additions; agentic-pr's `--index` staging is the better default). Both callers
shrink to one line.

This is also the first thing to unit-test — it's pure-ish and the failure mode
is silent.

### 4.3 Dead code

- `fetchGithubToken()` — `return undefined` in both
  `lib/agentic-dispatcher.ts:76` and `lib/dispatcher.ts:212`. Delete, and drop
  the `?? fetchGithubToken()` at each call site.
- `fetchIssueBody` (`lib/agentic-dispatcher.ts:86`) — unused.
- `diffFirstPath` (`lib/agentic-pr.ts:591`) — unused since the commit message
  switched to Claude's PR title.
- Stale comment `mcp-server/src/tools.ts:6-9` ("Why not tree-sitter…") — you
  shipped tree-sitter in `indexer.ts`. Rewrite or delete.

### 4.4 Three symbol indexers

Tree-sitter (`mcp-server/src/indexer.ts`), regex (`lib/pre-index.ts:127`), and
the CRG graph all extract symbols. `pre-index.ts` exists only to build the
prompt's symbol map — have it read the tree-sitter index the MCP server already
writes to `<clone>/.opensrcer-index.json` instead of re-scanning with regexes.
Deletes ~100 lines and makes the prompt map match what the tools return.

---

## P5 — Repo hygiene

### 5.1 Evict ContribAI

61k LOC of Rust + Python. The Next app references it exactly once —
`next.config.ts:6`, *to exclude it from the build trace*. Real coupling is a
`CONTRIBAI_BIN` env var pointing at a prebuilt binary.

Move it to its own repo (or a submodule). Clone size drops ~10x and the build
stops tracing 61k files it discards.

Then decide: is the deterministic path still part of the story? If not, also
delete `lib/dispatcher.ts`'s spawn path, `app/api/run/{target,solve,hunt}`,
`components/draft-preview.tsx`, and the `CONTRIBAI_*` env vars. Keep the
`Dispatch` type and registry — the agentic path uses them.

### 5.2 Dependency bumps

| Package | Current | Action |
|---|---|---|
| `@auth0/nextjs-auth0` | ^3.8.0 | → v4. Breaking (middleware-native), but it restructures exactly the code P0.1/P0.2 touch. Do it right after P0 lands, not during. |
| `next` | 15.1.6 (pinned) | → latest 15.x, then evaluate 16. |
| `@modelcontextprotocol/sdk` | ^1.0.4 | → latest 1.x. Very early pin. |
| `zod` | ^3.23.8 | → v4 (mcp-server only; small surface). |
| `web-tree-sitter` | ^0.22.6 | **Leave pinned.** `indexer.ts:33-37` documents the ABI reason correctly. |
| `react-diff-viewer-continued` | ^4.2.0 | Sole reason for `--legacy-peer-deps`. Either accept it or replace with a ~50-line renderer over the diff you already parse. |

### 5.3 Model IDs

`gemini-2.0-flash` is hardcoded in `lib/agentic-pr.ts:706` and `lib/enrich.ts:46`
(plus the `v1beta` endpoint). Your own `ContribAI/config.example.yaml` already
uses `gemini-2.5-flash`. Hoist to one `lib/models.ts` constant and bump.

### 5.4 Deployment honesty

`.dispatches/` under `process.cwd()`, in-memory registry, `spawn("claude")`,
`taskkill`, local git worktrees — this runs on one long-lived box, not
serverless. Say so in the README, and add a `Dockerfile` bundling Claude Code
CLI + `gh` + GNU patch + gitleaks + Python so "clone and run" works for someone
who isn't on your Windows machine.

---

## P6 — Tests and CI

Zero tests today, on a project whose pitch is "prove it works."

### 6.1 One test file, four pure functions

`node --test` — no framework, no config, already in Node 22:

```
lib/__tests__/parsing.test.ts
  extractFirstDiff        (agentic-pr.ts:44)   — fenced/bare/patch variants, missing trailing newline
  buildPrContent          (agentic-pr.ts:625)  — missing sections, >90-char titles, Fixes #N injection
  classifyScope           (scope.ts)           — leaf/doc/broad bucketing, the fast-path boundary
  enrichWithPrStatus      (dispatcher.ts:153)  — marker precedence: opened > gitleaks > tests_failed > skipped
  applyDiff               (P4.2)               — each tier, using a temp git repo
```

These are the regex-heavy functions where a silent break costs you a bad PR on
someone else's repo. Everything else can stay untested.

### 6.2 CI

`.github/workflows/ci.yml` — `npm ci --legacy-peer-deps`, `tsc --noEmit` (both
tsconfigs), `next lint`, `node --test`. Nothing else. The repo has no
`.github/` at all right now, which also means no issue templates or
`CONTRIBUTING.md` — ironic for a tool that reads other repos' contribution
guides.

---

## Sequencing

```
P0 ──► P1 ──► P2 ──► P4 ──► P3 ──► P5 ──► P6
(4h)   (2h)   (3h)   (3h)   (4h)   (2h)   (2h)
```

P4 before P3 because deduplicating the dispatchers first means the sidecar
persistence in P3 gets written once instead of twice. P6 last is a deliberate
concession — the checks embedded in P0/P1 cover those phases, and the functions
worth testing don't reach final shape until P4.2.

**Stop after P2 if time is short.** P0–P2 fixes every real bug and closes every
gap between the README and the code. P3–P6 are quality-of-life on a system that
already works.
