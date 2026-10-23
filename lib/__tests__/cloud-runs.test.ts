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
const fakeSandbox = {
  APIError: class extends Error { response = { status: 500 }; },
  Sandbox: {
    async get({ name }: { name: string }) {
      return {
        status: "running",
        async stop() {},
        async writeFiles(files: Array<{ path: string; content: Buffer; mode?: number }>) { writes.push({ sandbox: name, files }); },
      };
    },
  },
};
const req = createRequire(__filename);
for (const [id, fake] of [["@vercel/blob", fakeBlob], ["@vercel/sandbox", fakeSandbox], ["@vercel/blob/client", {}]] as const) {
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
