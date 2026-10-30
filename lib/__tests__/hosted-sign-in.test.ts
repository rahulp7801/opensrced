import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HostedSignInError, MAX_TTY_INPUT_BYTES, ptyCommand, serveSignInTerminal, validSignInState, validTtyToken,
} from "../hosted-sign-in";

const TOKEN = "a".repeat(64);

test("sign-in states carry only a status; a legacy url is ignored", () => {
  assert.equal(validSignInState({ status: "waiting" }), true);
  assert.equal(validSignInState({ url: "https://claude.ai/oauth/authorize?a=b", status: "signed_in" }), true);
  for (const bad of [null, [], {}, { status: "done" }]) assert.equal(validSignInState(bad), false, JSON.stringify(bad));
});

test("terminal capabilities are 32 bytes of hex", () => {
  assert.equal(validTtyToken(TOKEN), true);
  for (const bad of ["", "a".repeat(63), "A".repeat(64), undefined]) assert.equal(validTtyToken(bad), false, String(bad));
});

test("the login runs on a fixed-size pty, its arguments quoted for the shell", () => {
  const { bin, args } = ptyCommand("claude", ["auth", "login", "it's"]);
  assert.equal(bin, "script");
  assert.deepEqual([args[0], args[2]], ["-qfec", "/dev/null"]);
  assert.equal(args[1], "stty cols 100 rows 30 2>/dev/null; exec 'claude' 'auth' 'login' 'it'\\''s'");
});

// A stand-in for the login CLI: prints a prompt, then echoes every byte it is
// given (as a terminal would), and exits when it reads "quit". Never a real login.
const STUB = `
process.stdout.write("prompt> ");
process.stdin.on("data", (chunk) => {
  if (chunk.toString("latin1").includes("quit")) process.exit(0);
  process.stdout.write(chunk);
});
`;

async function withStub(run: (script: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-sign-in-test-"));
  const script = join(dir, "stub.cjs");
  writeFileSync(script, STUB);
  try { await run(script); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function start(script: string, signedIn: () => Promise<boolean>, timeoutMs = 10_000) {
  let port = 0;
  let ready = () => {};
  const listening = new Promise<void>((resolve) => { ready = resolve; });
  const done = serveSignInTerminal({
    command: { bin: process.execPath, args: [script] }, env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv,
    token: TOKEN, port: 0, host: "127.0.0.1", signedIn, timeoutMs, pollMs: 50,
    onListening: (p) => { port = p; ready(); },
  });
  // Tests that expect a rejection attach their own handler.
  done.catch(() => {});
  return { done, listening, url: () => `http://127.0.0.1:${port}/tty` };
}

const auth = { authorization: `Bearer ${TOKEN}` };

/** Read a byte stream until `want` has arrived (or fail after 5 s). */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, want: Uint8Array): Promise<Uint8Array> {
  let seen = new Uint8Array();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen = new Uint8Array([...seen, ...value]);
    if (Buffer.from(seen).includes(Buffer.from(want))) return seen;
  }
  throw new Error(`did not see ${Buffer.from(want).toString("hex")} in ${Buffer.from(seen).toString("hex")}`);
}

test("only the run's capability opens the terminal, and only at /tty", async () => {
  await withStub(async (script) => {
    let signed = false;
    const server = start(script, async () => signed);
    await server.listening;
    try {
      assert.equal((await fetch(server.url())).status, 401);
      assert.equal((await fetch(server.url(), { headers: { authorization: `Bearer ${"b".repeat(64)}` } })).status, 401);
      assert.equal((await fetch(server.url().replace("/tty", "/other"), { headers: auth })).status, 404);
      assert.equal((await fetch(server.url(), { method: "PUT", headers: auth })).status, 405);
    } finally {
      signed = true;
      await server.done;
    }
  });
});

test("output written before anyone attached arrives, and typed bytes reach the CLI unchanged", async () => {
  await withStub(async (script) => {
    let signed = false;
    const server = start(script, async () => signed);
    await server.listening;
    try {
      const output = await fetch(server.url(), { headers: auth });
      assert.equal(output.status, 200);
      const reader = output.body!.getReader();
      await readUntil(reader, new TextEncoder().encode("prompt> "));
      // Escape sequences, a carriage return and a non-UTF-8 byte, as a terminal sends them.
      const typed = new Uint8Array([0x1b, 0x5b, 0x41, 0x63, 0x6f, 0x64, 0x65, 0x0d, 0xff]);
      assert.equal((await fetch(server.url(), { method: "POST", headers: auth, body: typed })).status, 204);
      await readUntil(reader, typed);
      // A reconnect takes over; the first viewer's stream ends.
      const second = await fetch(server.url(), { headers: auth });
      assert.equal((await reader.read()).done, true);
      const again = second.body!.getReader();
      await fetch(server.url(), { method: "POST", headers: auth, body: "next" });
      await readUntil(again, new TextEncoder().encode("next"));
      signed = true;
      await server.done;
      assert.equal((await again.read().catch(() => ({ done: true }))).done, true, "the stream ends once signed in");
    } finally {
      signed = true;
      await server.done;
    }
  });
});

test("an oversized input is cut off instead of being typed", async () => {
  await withStub(async (script) => {
    let signed = false;
    const server = start(script, async () => signed);
    await server.listening;
    try {
      const huge = new Uint8Array(MAX_TTY_INPUT_BYTES + 1024).fill(0x61);
      const sent = await fetch(server.url(), { method: "POST", headers: auth, body: huge }).then((r) => r.status, () => "reset");
      assert.notEqual(sent, 204);
    } finally {
      signed = true;
      await server.done;
    }
  });
});

test("the CLI exiting without a login, a timeout and a bad capability fail with named errors", async () => {
  await withStub(async (script) => {
    const exits = start(script, async () => false);
    await exits.listening;
    await fetch(exits.url(), { method: "POST", headers: auth, body: "quit" });
    await assert.rejects(exits.done!, (error: Error) => error instanceof HostedSignInError && /did not complete/.test(error.message));

    const slow = start(script, async () => false, 300);
    await slow.listening;
    await assert.rejects(slow.done!, (error: Error) => error instanceof HostedSignInError && /not completed in time/.test(error.message));

    await assert.rejects(serveSignInTerminal({
      command: { bin: process.execPath, args: [script] }, env: {} as NodeJS.ProcessEnv, token: "short", port: 0, signedIn: async () => true, timeoutMs: 1000,
    }), HostedSignInError);
  });
});
