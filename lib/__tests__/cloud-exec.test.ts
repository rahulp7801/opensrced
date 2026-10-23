import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";

// Sandbox stand-in: records what the exec VM is created and started with.
type Created = { params: Record<string, unknown>; commands: Array<Record<string, unknown>> };
const created: Created[] = [];
let protocolMarker = "7";
let domainUrl = "";
const fakeSandbox = {
  APIError: class extends Error {},
  Sandbox: {
    async create(params: Record<string, unknown>) {
      const entry: Created = { params, commands: [] };
      created.push(entry);
      return {
        name: params.name,
        async readFileToBuffer() { return Buffer.from(`${protocolMarker}\n`); },
        async runCommand(command: Record<string, unknown>) { entry.commands.push(command); return {}; },
        domain(port: number) { assert.equal(port, 7070); return domainUrl; },
      };
    },
  },
};
const req = createRequire(__filename);
const resolved = req.resolve("@vercel/sandbox");
req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fakeSandbox } as never;

const TOKEN = "a".repeat(64);
// Names that would mean a credential reached the exec VM.
const CREDENTIAL = /GITHUB|GH_|ANTHROPIC|OPENAI|BLOB|OIDC|VERCEL|AUTH0|GEMINI|CLAUDE|SECRET|PASSWORD|_KEY$/i;

test("the exec server's env is its own token and limits, nothing else, even when the host holds credentials", async () => {
  const { execServerEnv } = await import("../cloud-exec");
  const saved = { ...process.env };
  Object.assign(process.env, { GITHUB_TOKEN: "ghp_x", ANTHROPIC_API_KEY: "sk-x", BLOB_READ_WRITE_TOKEN: "blob", VERCEL_OIDC_TOKEN: "oidc", AUTH0_SECRET: "s" });
  try {
    const env = execServerEnv(TOKEN, 40 * 60_000);
    assert.deepEqual(Object.keys(env).sort(), ["EXEC_CMD_TIMEOUT_MS", "EXEC_HOST", "EXEC_MAX_LIFETIME_MS", "EXEC_OUTPUT_BYTES", "EXEC_PORT", "EXEC_SETUP_MS", "EXEC_TOKEN", "EXEC_TOTAL_MS"]);
    for (const [key, value] of Object.entries(env)) {
      assert.ok(!CREDENTIAL.test(key), key);
      assert.ok(!["ghp_x", "sk-x", "blob", "oidc", "s"].includes(value), key);
    }
    assert.equal(env.EXEC_TOKEN, TOKEN);
    assert.equal(env.EXEC_MAX_LIFETIME_MS, String(40 * 60_000));
  } finally {
    process.env = saved;
  }
});

test("execServerEnv refuses a token that is not 32 random bytes in hex", async () => {
  const { execServerEnv } = await import("../cloud-exec");
  for (const bad of ["", "short", "g".repeat(64), `${TOKEN}\nX=1`]) assert.throws(() => execServerEnv(bad, 1000), RangeError);
});

test("hosted caps flow to both the exec server and the worker, and the worker gets remote mode", async () => {
  const { execServerEnv, workerExecEnv } = await import("../cloud-exec");
  const saved = { ...process.env };
  Object.assign(process.env, { OPENSRCER_HOSTED_EXEC_SETUP_MS: "60000", OPENSRCER_HOSTED_EXEC_AGENT_MS: "120000", OPENSRCER_HOSTED_EXEC_CMD_TIMEOUT_MS: "30000" });
  try {
    const server = execServerEnv(TOKEN, 1000);
    const worker = workerExecEnv({ url: "https://sb-x.vercel.run", token: TOKEN });
    assert.deepEqual(worker, {
      OPENSRCER_EXEC: "remote", OPENSRCER_EXEC_URL: "https://sb-x.vercel.run", OPENSRCER_EXEC_TOKEN: TOKEN,
      OPENSRCER_EXEC_CMD_TIMEOUT_MS: "30000", OPENSRCER_EXEC_SETUP_MS: "60000", OPENSRCER_EXEC_TOTAL_MS: "120000",
      OPENSRCER_AGENTIC_TIMEOUT_MS: "120000",
    });
    assert.equal(server.EXEC_CMD_TIMEOUT_MS, worker.OPENSRCER_EXEC_CMD_TIMEOUT_MS);
    assert.equal(server.EXEC_SETUP_MS, worker.OPENSRCER_EXEC_SETUP_MS);
    assert.equal(server.EXEC_TOTAL_MS, worker.OPENSRCER_EXEC_TOTAL_MS);
  } finally {
    process.env = saved;
  }
});

test("execSandboxName derives the exec VM from the run's VM name", async () => {
  const { execSandboxName } = await import("../cloud-exec");
  assert.equal(execSandboxName("c-1761234567890-abcdef123456"), "c-1761234567890-abcdef123456-exec");
});

/** A local stand-in for the exec server's /health behind the VM's port. */
async function healthServer(token: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((q, s) => {
    const ok = q.headers.authorization === `Bearer ${token}` && q.url === "/health";
    s.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
    s.end(JSON.stringify(ok ? { ok: true } : { error: "unauthorized" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test("startExecVm creates a credential-free VM with one exposed port and the exec egress, and waits for health", async () => {
  const { startExecVm } = await import("../cloud-exec");
  const { EXEC_EGRESS } = await import("../sandbox-egress");
  created.length = 0;
  protocolMarker = "7";
  // The token is minted inside; accept any bearer for this server.
  const server = http.createServer((q, s) => { s.writeHead(/^Bearer [a-f0-9]{64}$/.test(String(q.headers.authorization)) ? 200 : 401); s.end("{}"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  domainUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const vm = await startExecVm("c-1-x-exec", "snap_test", 40 * 60_000);
    assert.equal(vm.url, domainUrl);
    assert.equal(vm.host, new URL(domainUrl).hostname);
    assert.match(vm.token, /^[a-f0-9]{64}$/);
    assert.equal(created.length, 1);
    const { params, commands } = created[0];
    assert.equal(params.name, "c-1-x-exec");
    assert.deepEqual(params.ports, [7070]);
    assert.deepEqual(params.networkPolicy, EXEC_EGRESS);
    assert.equal(params.timeout, 40 * 60_000);
    assert.equal(params.persistent, false);
    assert.equal(params.env, undefined, "no VM-wide env");
    assert.equal(commands.length, 1);
    assert.equal(commands[0].detached, true);
    assert.match(String((commands[0].args as string[])[1]), /exec node scripts\/exec-server\.cjs$/);
    const env = commands[0].env as Record<string, string>;
    assert.equal(env.EXEC_TOKEN, vm.token);
    for (const key of Object.keys(env)) assert.ok(key.startsWith("EXEC_") && !CREDENTIAL.test(key), key);
  } finally {
    server.close();
  }
});

test("startExecVm refuses a snapshot from another protocol and never starts the server", async () => {
  const { startExecVm } = await import("../cloud-exec");
  created.length = 0;
  protocolMarker = "6";
  await assert.rejects(startExecVm("c-1-x-exec", "snap_old", 60_000), /incompatible/);
  assert.equal(created[0].commands.length, 0);
  protocolMarker = "7";
});

test("startExecVm fails when the server never answers with the minted token", async () => {
  const { startExecVm } = await import("../cloud-exec");
  const wrong = await healthServer("b".repeat(64));
  domainUrl = wrong.url;
  try {
    await assert.rejects(startExecVm("c-1-x-exec", "snap_test", 60_000), /never became healthy/);
  } finally {
    wrong.close();
  }
});
