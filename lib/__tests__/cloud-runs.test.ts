import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// In-memory Blob and Sandbox stand-ins (same approach as cloud-capacity.test.ts).
const store = new Map<string, { body: string; etag: string }>();
const fakeBlob = {
  BlobPreconditionFailedError: class extends Error {},
  BlobNotFoundError: class extends Error {},
  async get(path: string) {
    const entry = store.get(path);
    return entry ? { statusCode: 200, stream: entry.body, blob: { size: entry.body.length, etag: entry.etag } } : null;
  },
  async put(path: string, body: string) { store.set(path, { body, etag: "1" }); return { pathname: path }; },
  async list() { return { blobs: [] }; },
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
      };
    },
    async create(params: Record<string, unknown>) {
      if (failCreate?.(String(params.name))) throw new Error("create failed");
      const entry = { params, commands: [] as Array<Record<string, unknown>> };
      creates.push(entry);
      return {
        async readFileToBuffer() { return Buffer.from("7\n"); },
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

const SIGN_IN = { url: "https://claude.com/cai/oauth/authorize?code=true&state=s", status: "waiting" as const };
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

test("the owner's waiting run receives the code in its VM, as a 0600 file", async () => {
  const { relaySignInCode } = await import("../cloud-runs");
  const { SIGN_IN_CODE_PATH } = await import("../hosted-sign-in");
  const id = await seed("alice");
  writes.length = 0;
  assert.equal(await relaySignInCode("alice", id, CODE), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].sandbox, id.replaceAll("_", "-"));
  assert.equal(writes[0].files[0].path, SIGN_IN_CODE_PATH);
  assert.equal(writes[0].files[0].mode, 0o600);
  assert.equal(writes[0].files[0].content.toString(), CODE);
  // Nothing about the code is written to the run record or anywhere in Blob.
  assert.ok(![...store.values()].some((entry) => entry.body.includes(CODE)));
});

test("another user's run, a run not waiting, a finished run and a bad code are refused without a write", async () => {
  const { relaySignInCode } = await import("../cloud-runs");
  const cases: Array<[string, string, string]> = [
    ["mallory", await seed("alice"), CODE],
    ["alice", await seed("alice", { sign_in: { ...SIGN_IN, status: "signed_in" } }), CODE],
    ["alice", await seed("alice", { sign_in: undefined }), CODE],
    ["alice", await seed("alice", { status: "failed", ended_at: new Date().toISOString(), sandbox_stopped: true }), CODE],
    ["alice", await seed("alice"), "bad code\nsecond line"],
    ["alice", "c_123_not-an-id", CODE],
  ];
  writes.length = 0;
  for (const [viewer, id, code] of cases) assert.equal(await relaySignInCode(viewer, id, code), false, `${viewer} ${id}`);
  assert.equal(writes.length, 0);
});

test("signInRelayable is true only for a live run waiting on sign-in", async () => {
  const { signInRelayable } = await import("../cloud-runs");
  const base = { status: "running", expires_at: Date.now() + 60_000, sign_in: SIGN_IN } as never;
  assert.equal(signInRelayable(base), true);
  assert.equal(signInRelayable(null), false);
  assert.equal(signInRelayable({ ...(base as object), sign_in: { ...SIGN_IN, status: "failed" } } as never), false);
  assert.equal(signInRelayable({ ...(base as object), status: "killed" } as never), false);
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
    assert.deepEqual((agent.params.networkPolicy as { allow: string[] }).allow, [...(AGENT_EGRESS as { allow: string[] }).allow, new URL(execDomain).host]);
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
