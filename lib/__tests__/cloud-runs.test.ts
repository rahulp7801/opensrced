import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// In-memory Blob and Sandbox stand-ins (same approach as cloud-capacity.test.ts).
const store = new Map<string, { body: string; etag: string }>();
const ops = { list: 0, reads: [] as string[] };
const fakeBlob = {
  BlobPreconditionFailedError: class extends Error {},
  BlobNotFoundError: class extends Error {},
  async get(path: string) {
    ops.reads.push(path);
    const entry = store.get(path);
    return entry ? { statusCode: 200, stream: entry.body, blob: { size: entry.body.length, etag: entry.etag } } : null;
  },
  async put(path: string, body: string) { store.set(path, { body, etag: "1" }); return { pathname: path }; },
  async list({ prefix }: { prefix: string }) {
    ops.list++;
    return { blobs: [...store.keys()].filter((key) => key.startsWith(prefix)).sort().map((pathname) => ({ pathname })), hasMore: false };
  },
  async del() {},
};
const writes: Array<{ sandbox: string; files: Array<{ path: string; content: Buffer; mode?: number }> }> = [];
const stops: string[] = [];
const creates: Array<{ params: Record<string, unknown>; commands: Array<Record<string, unknown>> }> = [];
let execDomain = "";
let failCreate: ((name: string) => boolean) | null = null;
const fakeSandbox = {
  APIError: class extends Error { response = { status: 500 }; },
  Sandbox: {
    async get({ name }: { name: string }) {
      return {
        status: "running",
        async stop() { stops.push(name); },
        async writeFiles(files: Array<{ path: string; content: Buffer; mode?: number }>) { writes.push({ sandbox: name, files }); },
        domain(port: number) { return `https://${name}-${port}.vm.test`; },
      };
    },
    async create(params: Record<string, unknown>) {
      if (failCreate?.(String(params.name))) throw new Error("create failed");
      const entry = { params, commands: [] as Array<Record<string, unknown>> };
      creates.push(entry);
      return {
        async readFileToBuffer() { return Buffer.from("8\n"); },
        async runCommand(command: Record<string, unknown>) { entry.commands.push(command); return {}; },
        domain() { return execDomain; },
      };
    },
  },
};
const fakeBlobClient = { async generateClientTokenFromReadWriteToken(o: { pathname: string }) { return `client-token-for:${o.pathname}`; } };
const req = createRequire(__filename);
for (const [id, fake] of [["@vercel/blob", fakeBlob], ["@vercel/sandbox", fakeSandbox], ["@vercel/blob/client", fakeBlobClient]] as const) {
  const resolved = req.resolve(id);
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fake } as never;
}

const SIGN_IN = { status: "waiting" as const };
const CODE = "good-code-123#state";

async function seed(owner: string, overrides: Record<string, unknown> = {}) {
  const { newCloudRunId, runPath } = await import("../cloud-run-state");
  const id = newCloudRunId();
  const log = "Preparing isolated agent worker...\n";
  const run = {
    id, auth0_user_id: owner, repo_url: "https://github.com/acme/app", issue_number: 1, mode: "agentic", dry_run: true,
    started_at: new Date().toISOString(), status: "running", log_path: "", sandbox_name: id.replaceAll("_", "-"),
    expires_at: Date.now() + 30 * 60_000, log, log_size: Buffer.byteLength(log), sign_in: SIGN_IN, ...overrides,
  };
  store.set(runPath(owner, id), { body: JSON.stringify(run), etag: "1" });
  return id;
}

// ── Hosted Claude sign-in terminal (lib/hosted-sign-in.ts) ─────────────

/** A stand-in for the VM's terminal port: records each request, answers GET
 *  with the given bytes and POST with 204. */
function fakeVm(output: Uint8Array<ArrayBuffer>, status = 200) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: Uint8Array | null }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = init.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : null;
    calls.push({ url, method: String(init.method), auth: new Headers(init.headers).get("authorization"), body });
    if (status !== 200) return new Response("no", { status });
    return init.method === "GET" ? new Response(output) : new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// Escape sequences, a carriage return and a byte that is not UTF-8: whatever
// the terminal sends must arrive exactly as sent.
const TTY_BYTES = new Uint8Array([0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x68, 0x69, 0x0d, 0x0a, 0xff, 0x00]);

test("the owner's terminal output streams from their run's VM, byte for byte, with the run's own capability", async () => {
  const { proxySignInTerminal, signInTtyToken } = await import("../cloud-runs");
  const saved = process.env.AUTH0_SECRET;
  process.env.AUTH0_SECRET = "unit-test-secret";
  try {
    const id = await seed("alice");
    const vm = fakeVm(TTY_BYTES);
    const response = await proxySignInTerminal("alice", id, { method: "GET" }, vm.impl);
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(new Uint8Array(await response!.arrayBuffer()), TTY_BYTES);
    assert.equal(vm.calls[0].url, `https://${id.replaceAll("_", "-")}-7071.vm.test/tty`);
    assert.equal(vm.calls[0].auth, `Bearer ${signInTtyToken(id)}`);
    assert.match(signInTtyToken(id), /^[a-f0-9]{64}$/);
    assert.notEqual(signInTtyToken(id), signInTtyToken(await seed("alice")), "one capability per run");
  } finally {
    if (saved === undefined) delete process.env.AUTH0_SECRET; else process.env.AUTH0_SECRET = saved;
  }
});

test("typed bytes reach the VM unchanged, and nothing of them is kept in Blob", async () => {
  const { proxySignInTerminal } = await import("../cloud-runs");
  const saved = process.env.AUTH0_SECRET;
  process.env.AUTH0_SECRET = "unit-test-secret";
  try {
    const id = await seed("alice");
    const vm = fakeVm(new Uint8Array());
    const typed = new TextEncoder().encode(`${CODE}\r`);
    const response = await proxySignInTerminal("alice", id, { method: "POST", body: new Response(typed).body }, vm.impl);
    assert.equal(response?.status, 204);
    assert.equal(vm.calls[0].method, "POST");
    assert.deepEqual(vm.calls[0].body, typed);
    assert.ok(![...store.values()].some((entry) => entry.body.includes(CODE)));
    // A VM that refuses (wrong capability, worker gone) is a 502, not a pass-through.
    assert.equal((await proxySignInTerminal("alice", id, { method: "GET" }, fakeVm(TTY_BYTES, 401).impl))?.status, 502);
    assert.equal((await proxySignInTerminal("alice", id, { method: "POST", body: new Response(typed).body }, fakeVm(TTY_BYTES, 401).impl))?.status, 502);
  } finally {
    if (saved === undefined) delete process.env.AUTH0_SECRET; else process.env.AUTH0_SECRET = saved;
  }
});

test("another user's run, a run not waiting and a finished run never reach a VM", async () => {
  const { proxySignInTerminal } = await import("../cloud-runs");
  const cases: Array<[string, string]> = [
    ["mallory", await seed("alice")],
    ["alice", await seed("alice", { sign_in: { status: "signed_in" } })],
    ["alice", await seed("alice", { sign_in: undefined })],
    ["alice", await seed("alice", { status: "failed", ended_at: new Date().toISOString(), sandbox_stopped: true })],
    ["alice", "c_123_not-an-id"],
  ];
  const vm = fakeVm(TTY_BYTES);
  for (const [viewer, id] of cases) assert.equal(await proxySignInTerminal(viewer, id, { method: "GET" }, vm.impl), null, `${viewer} ${id}`);
  assert.equal(vm.calls.length, 0);
});

test("signInOpen is true only for a live run waiting on sign-in; the capability needs the server secret", async () => {
  const { signInOpen, signInTtyToken } = await import("../cloud-runs");
  const base = { status: "running", expires_at: Date.now() + 60_000, sign_in: SIGN_IN } as never;
  assert.equal(signInOpen(base), true);
  assert.equal(signInOpen(null), false);
  assert.equal(signInOpen({ ...(base as object), sign_in: { status: "failed" } } as never), false);
  assert.equal(signInOpen({ ...(base as object), status: "killed" } as never), false);
  assert.throws(() => signInTtyToken("c_1", ""), /AUTH0_SECRET/);
});

// ── Hosted exec VM (OPENSRCER_HOSTED_EXEC) ─────────────────────────────

/** A stand-in for the exec VM's port: answers /health for any minted token. */
async function execHealth() {
  const http = await import("node:http");
  const server = http.createServer((q, s) => { s.writeHead(/^Bearer [a-f0-9]{64}$/.test(String(q.headers.authorization)) ? 200 : 401); s.end("{}"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  execDomain = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  return server;
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { process.env = saved; }
}

const HOSTED = { OPENSRCER_WORKER_SNAPSHOT_ID: "snap_test", BLOB_READ_WRITE_TOKEN: "blob-secret", OPENSRCER_HOSTED_EXEC: "1" };
const CREDENTIAL = /GITHUB|GH_|ANTHROPIC|OPENAI|BLOB|OIDC|VERCEL|AUTH0|GEMINI|UPLOAD|SECRET/i;

test("with OPENSRCER_HOSTED_EXEC=1 an issue run gets a credential-free exec VM first and the agent VM may reach only it in addition", async () => {
  const { startCloudRun } = await import("../cloud-runs");
  const { AGENT_EGRESS, EXEC_EGRESS } = await import("../sandbox-egress");
  const server = await execHealth();
  creates.length = 0;
  store.clear();
  try {
    const run = await withEnv(HOSTED, () => startCloudRun("https://github.com/acme/app", 3, {
      auth0UserId: "alice-exec", dryRun: true, anthropicKey: "sk-ant-secret", provider: "anthropic-key", token: undefined,
    }));
    assert.equal(creates.length, 2);
    const [exec, agent] = creates;
    assert.equal(exec.params.name, `${run.sandbox_name}-exec`);
    assert.deepEqual(exec.params.ports, [7070]);
    assert.deepEqual(exec.params.networkPolicy, EXEC_EGRESS);
    // Everything the exec VM is given: no credential anywhere.
    const execEnv = exec.commands[0].env as Record<string, string>;
    for (const [key, value] of Object.entries(execEnv)) {
      assert.ok(key.startsWith("EXEC_") && !CREDENTIAL.test(key), key);
      assert.ok(!["sk-ant-secret", "blob-secret"].includes(value) && !value.startsWith("client-token-for:"), key);
    }
    assert.ok(!JSON.stringify(exec.params).includes("sk-ant-secret") && !JSON.stringify(exec.params).includes("blob-secret"));
    // The agent VM: its usual hosts plus exactly the exec VM's host.
    assert.equal(agent.params.name, run.sandbox_name);
    assert.deepEqual((agent.params.networkPolicy as { allow: string[] }).allow, [...(AGENT_EGRESS as { allow: string[] }).allow, new URL(execDomain).hostname]);
    const workerEnv = agent.commands[0].env as Record<string, string>;
    assert.equal(workerEnv.OPENSRCER_EXEC, "remote");
    assert.equal(workerEnv.OPENSRCER_EXEC_URL, execDomain);
    assert.equal(workerEnv.OPENSRCER_EXEC_TOKEN, execEnv.EXEC_TOKEN);
    assert.equal(workerEnv.OPENSRCER_AGENTIC_TIMEOUT_MS, String(20 * 60_000));
  } finally {
    server.close();
  }
});

test("with the gate off nothing changes: one VM, today's egress and worker env", async () => {
  const { startCloudRun } = await import("../cloud-runs");
  const { AGENT_EGRESS } = await import("../sandbox-egress");
  creates.length = 0;
  store.clear();
  await withEnv({ ...HOSTED, OPENSRCER_HOSTED_EXEC: undefined }, () => startCloudRun("https://github.com/acme/app", 3, { auth0UserId: "bob-exec", dryRun: true }));
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].params.networkPolicy, AGENT_EGRESS);
  assert.equal(creates[0].params.ports, undefined);
  const env = creates[0].commands[0].env as Record<string, string>;
  assert.ok(!Object.keys(env).some((k) => k.startsWith("OPENSRCER_EXEC")));
  assert.equal(env.OPENSRCER_AGENTIC_TIMEOUT_MS, String(30 * 60_000));
});

test("a Claude-plan run exposes only its sign-in terminal port and gets that run's capability", async () => {
  const { startCloudRun, signInTtyToken } = await import("../cloud-runs");
  const { SUBSCRIPTION_AGENT_EGRESS } = await import("../sandbox-egress");
  creates.length = 0;
  store.clear();
  const vars = { ...HOSTED, OPENSRCER_HOSTED_EXEC: undefined, AUTH0_SECRET: "unit-test-secret" };
  const run = await withEnv(vars, () => startCloudRun("https://github.com/acme/app", 3, { auth0UserId: "frank-tty", dryRun: true, provider: "claude-subscription" }));
  assert.deepEqual(creates[0].params.ports, [7071]);
  assert.deepEqual(creates[0].params.networkPolicy, SUBSCRIPTION_AGENT_EGRESS);
  const env = creates[0].commands[0].env as Record<string, string>;
  assert.equal(env.OPENSRCER_TTY_TOKEN, await withEnv(vars, async () => signInTtyToken(run.id)));
});

test("an OpenRouter-key run may reach OpenRouter, and its key goes only into the agent VM's job", async () => {
  const { startCloudRun } = await import("../cloud-runs");
  const { OPENROUTER_AGENT_EGRESS } = await import("../sandbox-egress");
  const server = await execHealth();
  creates.length = 0;
  store.clear();
  try {
    await withEnv(HOSTED, () => startCloudRun("https://github.com/acme/app", 3, {
      auth0UserId: "gina-or", dryRun: true, provider: "openrouter-key", openrouterKey: "sk-or-secret", agentModel: "z-ai/glm-5.3",
    }));
    const [exec, agent] = creates;
    assert.ok(!JSON.stringify(exec).includes("sk-or-secret"), "never in the exec VM");
    assert.deepEqual((agent.params.networkPolicy as { allow: string[] }).allow.slice(0, -1), (OPENROUTER_AGENT_EGRESS as { allow: string[] }).allow);
    assert.equal(agent.params.ports, undefined);
    const job = JSON.parse((agent.commands[0].env as Record<string, string>).OPENSRCER_JOB);
    assert.equal(job.opts.openrouterKey, "sk-or-secret");
    assert.equal(job.opts.agentModel, "z-ai/glm-5.3");
  } finally {
    server.close();
  }
});

test("a failed exec VM fails the start, stops both VMs by name and frees the slot", async () => {
  const { startCloudRun } = await import("../cloud-runs");
  creates.length = 0;
  stops.length = 0;
  store.clear();
  failCreate = (name) => name.endsWith("-exec");
  try {
    await assert.rejects(withEnv(HOSTED, () => startCloudRun("https://github.com/acme/app", 3, { auth0UserId: "carol-exec", dryRun: true })), /create failed/);
  } finally {
    failCreate = null;
  }
  assert.equal(creates.length, 0, "no agent VM after the exec VM failed");
  assert.equal(stops.length, 2);
  assert.ok(stops.some((n) => n.endsWith("-exec")) && stops.some((n) => !n.endsWith("-exec")));
  const leases = [...store.entries()].filter(([k]) => k.startsWith("capacity/")).map(([, v]) => JSON.parse(v.body));
  assert.ok(leases.every((l) => l.expires === 0), "lease released");
});

test("cancelling a run stops its agent VM and its exec VM", async () => {
  const { cancelCloudRun } = await import("../cloud-runs");
  const id = await seed("dave", { sign_in: undefined });
  stops.length = 0;
  assert.equal(await cancelCloudRun("dave", id), true);
  const name = id.replaceAll("_", "-");
  assert.deepEqual([...stops].sort(), [name, `${name}-exec`]);
});

test("reading a finished run stops both VMs once; an unknown run stops nothing", async () => {
  const { getCloudRun } = await import("../cloud-runs");
  const id = await seed("erin", { sign_in: undefined, status: "succeeded", pr_status: "none", ended_at: new Date().toISOString() });
  stops.length = 0;
  await getCloudRun("erin", id);
  const name = id.replaceAll("_", "-");
  assert.deepEqual([...stops].sort(), [name, `${name}-exec`]);
  stops.length = 0;
  assert.equal(await getCloudRun("erin", "c_0000000000000_000000000000"), null);
  assert.equal(stops.length, 0);
});

test("run history lists storage once to build its index, then polls with reads only", async () => {
  const { listCloudRunSummaries, indexRuns } = await import("../cloud-runs");
  const { cloudRunSummary, runIndexPath, runPath, runSummaryPath } = await import("../cloud-run-state");
  const owner = "history";
  const done = await seed(owner, { status: "succeeded", pr_status: "none", sign_in: undefined });
  // Expired on the clock, but its worker finished: it must not read as timed out.
  const live = await seed(owner, { sign_in: undefined, expires_at: Date.now() - 1000 });
  const summary = (id: string, overrides: Record<string, unknown> = {}) =>
    cloudRunSummary({ ...JSON.parse(store.get(runPath(owner, id))!.body), ...overrides });
  for (const id of [done, live]) store.set(runSummaryPath(owner, id), { body: JSON.stringify(summary(id)), etag: "1" });

  ops.list = 0;
  const first = await listCloudRunSummaries(owner);
  assert.ok(ops.list > 0, "the first read builds the index from a listing");
  assert.deepEqual(first.map((run) => run.id).sort(), [done, live].sort());
  assert.ok(store.has(runIndexPath(owner)));

  ops.list = 0;
  store.set(runSummaryPath(owner, live), { body: JSON.stringify(summary(live, { status: "succeeded", pr_status: "none" })), etag: "2" });
  const second = await listCloudRunSummaries(owner);
  assert.equal(ops.list, 0, "polling never lists once the index exists");
  assert.equal(second.find((run) => run.id === live)?.status, "succeeded", "a finished run reads as finished, not timed out");
  assert.equal(second.find((run) => run.id === live)?.pr_failure_reason, undefined);
  const indexed = JSON.parse(store.get(runIndexPath(owner))!.body).runs as Array<{ id: string; status: string }>;
  assert.equal(indexed.find((run) => run.id === live)?.status, "succeeded", "the finished run is folded into the index");

  ops.reads.length = 0;
  await listCloudRunSummaries(owner);
  assert.equal(ops.list, 0);
  assert.ok(!ops.reads.some((path) => path.includes("run-summaries/")), "finished runs are not re-read");

  // Server-side summary writes keep the index current.
  await indexRuns(owner, [summary(done, { pr_status: "opened", pr_url: "https://github.com/acme/app/pull/9" })]);
  assert.equal((await listCloudRunSummaries(owner)).find((run) => run.id === done)?.pr_status, "opened");
});

test("index writes never create an index, so the first history read still sees every run", async () => {
  const { indexRuns } = await import("../cloud-runs");
  const { cloudRunSummary, runIndexPath, runPath } = await import("../cloud-run-state");
  const id = await seed("fresh", { sign_in: undefined });
  await indexRuns("fresh", [cloudRunSummary(JSON.parse(store.get(runPath("fresh", id))!.body))]);
  assert.equal(store.has(runIndexPath("fresh")), false);
});
