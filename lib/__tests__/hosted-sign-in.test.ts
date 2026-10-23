import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractSignInUrl, HostedSignInError, signInInVm, takeSignInCode, validSignInCode, validSignInState, validSignInUrl,
} from "../hosted-sign-in";

// The URL shape claude 2.1.269 printed in a Linux container (parameter values replaced).
const URL_LINE = "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=c&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=x&code_challenge_method=S256&state=s\nPaste code here if prompted > ";

test("the sign-in URL is taken from CLI output and only Anthropic's authorize pages qualify", () => {
  const url = extractSignInUrl("\x1b[2mOpening browser to sign in…\x1b[0m\n" + URL_LINE);
  assert.ok(url?.startsWith("https://claude.com/cai/oauth/authorize?code=true"));
  assert.ok(url?.endsWith("state=s"));
  assert.equal(extractSignInUrl("visit https://evil.example/cai/oauth/authorize?x=1"), null);
  assert.equal(extractSignInUrl("no url here"), null);
  assert.equal(validSignInUrl("https://claude.ai/oauth/authorize?a=b"), true);
  assert.equal(validSignInUrl("https://claude.com.evil.example/cai/oauth/authorize?a=b"), false);
  assert.equal(validSignInUrl("javascript:alert(1)"), false);
  assert.equal(validSignInState({ url: "https://claude.ai/oauth/authorize?a=b", status: "waiting" }), true);
  assert.equal(validSignInState({ url: "https://claude.ai/oauth/authorize?a=b", status: "done" }), false);
  assert.equal(validSignInState(null), false);
});

test("sign-in codes are one line of safe characters", () => {
  assert.equal(validSignInCode("AbC-123_xyz#state-456"), true);
  for (const bad of ["", "short", "two\nlines", "a b c d e f g h", "x".repeat(1025), 42]) assert.equal(validSignInCode(bad), false, String(bad));
});

test("takeSignInCode reads the dropped code once and deletes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-sign-in-test-"));
  try {
    const path = join(dir, "code");
    assert.equal(takeSignInCode(path), null);
    writeFileSync(path, "abc-123#state\n");
    assert.equal(takeSignInCode(path), "abc-123#state");
    assert.equal(existsSync(path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A stand-in for `claude auth login`: prints the URL, reads one line, and
// succeeds only for the expected code. Never a real login.
const STUB = `
const expected = process.env.STUB_EXPECTED;
process.stdout.write(${JSON.stringify(URL_LINE)});
process.stdin.once("data", (line) => {
  if (String(line).trim() === expected) { process.stdout.write("Login successful.\\n"); process.exit(0); }
  process.stderr.write("Login failed: Request failed with status code 400\\n"); process.exit(1);
});
`;

test("the URL is reported, the pasted code is relayed to stdin, and success resolves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-sign-in-test-"));
  const script = join(dir, "stub.cjs");
  writeFileSync(script, STUB);
  try {
    const urls: string[] = [];
    let code: string | null = "good-code-123#state";
    await signInInVm({
      bin: process.execPath, env: { PATH: process.env.PATH, STUB_EXPECTED: "good-code-123#state" } as unknown as NodeJS.ProcessEnv,
      args: [script], onUrl: (url) => { urls.push(url); },
      takeCode: () => { const c = code; code = null; return c; }, timeoutMs: 10_000,
    });
    assert.equal(urls.length, 1);
    assert.ok(validSignInUrl(urls[0]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a rejected code, a malformed code and a timeout fail with named errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-sign-in-test-"));
  const script = join(dir, "stub.cjs");
  writeFileSync(script, STUB);
  const base = { bin: process.execPath, env: { PATH: process.env.PATH, STUB_EXPECTED: "good-code-123#state" } as unknown as NodeJS.ProcessEnv, args: [script], onUrl: () => {} };
  try {
    let wrong: string | null = "wrong-code-123#state";
    await assert.rejects(signInInVm({ ...base, takeCode: () => { const c = wrong; wrong = null; return c; }, timeoutMs: 10_000 }),
      (error: Error) => error instanceof HostedSignInError && /did not accept/.test(error.message));
    await assert.rejects(signInInVm({ ...base, takeCode: () => "bad code with spaces", timeoutMs: 10_000 }),
      (error: Error) => error instanceof HostedSignInError && /not valid/.test(error.message));
    await assert.rejects(signInInVm({ ...base, takeCode: () => null, timeoutMs: 1_500 }),
      (error: Error) => error instanceof HostedSignInError && /not completed in time/.test(error.message));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
