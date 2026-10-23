import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  boxPatch, boxRequest, dockerRunArgs, ExecBoxError, initBox, resolveExecMode, runInBox, startExecBox, type ExecBox,
} from "../exec-box";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined)));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("docker box is unprivileged, loopback-only and carries no credentials", () => {
  const args = withEnv({ GITHUB_TOKEN: "ghp_canary", ANTHROPIC_API_KEY: "sk-canary" }, () => dockerRunArgs("box1", "t".repeat(64), "/srv/exec-server.cjs"));
  const joined = args.join(" ");
  for (const flag of ["--rm", "--cap-drop ALL", "--security-opt no-new-privileges", "--user node", "--pids-limit", "--memory", "--cpus"]) {
    assert.ok(joined.includes(flag), `missing ${flag}`);
  }
  assert.ok(args.includes("127.0.0.1::7070"), "port must publish on loopback only");
  assert.ok(!joined.includes("canary"), "host credentials must never reach the box");
  const mounts = args.flatMap((a, i) => (args[i - 1] === "-v" ? [a] : []));
  assert.deepEqual(mounts, ["/srv/exec-server.cjs:/opt/opensrcer/exec-server.cjs:ro"]);
  assert.ok(!args.includes("--privileged") && !args.includes("--network=host"));
  // A per-repository package cache is the only other mount, and only with a safe name.
  const cached = dockerRunArgs("box1", "t".repeat(64), "/srv/exec-server.cjs", "opensrcer-cache-vllm-project_vllm");
  assert.ok(cached.includes("opensrcer-cache-vllm-project_vllm:/home/node/.cache"));
  const bad = dockerRunArgs("box1", "t".repeat(64), "/srv/exec-server.cjs", "/etc:/host");
  assert.equal(bad.filter((a) => a === "-v").length, 1, "a malformed cache name never becomes a mount");
});

test("resolveExecMode honors explicit modes and rejects unknown ones", async () => {
  assert.equal((await resolveExecMode({ OPENSRCER_EXEC: "off" })).mode, "off");
  assert.equal((await resolveExecMode({ OPENSRCER_EXEC: "host" })).mode, "host");
  assert.equal((await resolveExecMode({ OPENSRCER_EXEC: "docker" })).mode, "docker");
  assert.equal((await resolveExecMode({ OPENSRCER_EXEC: "remote" })).mode, "off", "remote without a URL is not usable");
  assert.equal((await resolveExecMode({ OPENSRCER_EXEC: "remote", OPENSRCER_EXEC_URL: "https://x", OPENSRCER_EXEC_TOKEN: "y" })).mode, "remote");
  await assert.rejects(resolveExecMode({ OPENSRCER_EXEC: "yes" }), ExecBoxError);
});

function fixtureRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-exec-repo-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  git("init", "-q");
  writeFileSync(path.join(dir, "math.js"), "exports.add = (a, b) => a - b;\n");
  writeFileSync(path.join(dir, ".gitattributes"), "hidden.txt export-ignore\n");
  writeFileSync(path.join(dir, "hidden.txt"), "tests that export-ignore would drop\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  return { dir, sha: git("rev-parse", "HEAD") };
}

async function withHostBox(fn: (box: ExecBox) => Promise<void>, env: Record<string, string> = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "opensrcer-exec-work-"));
  const repo = fixtureRepo();
  const saved = { ...process.env };
  Object.assign(process.env, env);
  let box: ExecBox | undefined;
  try {
    box = await startExecBox("host", "d_test", work);
    await initBox(box, repo.dir, repo.sha);
    await fn(box);
  } finally {
    await box?.stop();
    process.env = saved;
    rmSync(work, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

test("host box: edit, run, and the patch is git diff of the workspace", async () => {
  await withHostBox(async (box) => {
    const read = await boxRequest<{ lines: string[] }>(box, "POST", "/read", { path: "hidden.txt" });
    assert.match(read.lines[0], /export-ignore would drop/, "export-ignore must not hide files from the box");
    await boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "a - b", new_string: "a + b" });
    await boxRequest(box, "POST", "/write", { path: "test/math.test.js", content: "require('assert').equal(require('../math').add(2, 2), 4);\n" });
    const run = await runInBox(box, "node test/math.test.js && echo ok");
    assert.equal(run.exit_code, 0, run.output);
    assert.match(run.output, /ok/);
    const patch = await boxPatch(box);
    assert.match(patch, /^-exports\.add = \(a, b\) => a - b;$/m);
    assert.match(patch, /^\+exports\.add = \(a, b\) => a \+ b;$/m);
    assert.match(patch, /^\+\+\+ b\/test\/math\.test\.js$/m, "new files are part of the patch");
    // Taking the patch must not disturb the workspace's own `git diff`.
    assert.match((await runInBox(box, "git diff --stat")).output, /math\.js/);
  });
});

test("host box: commands never see host credentials", async () => {
  await withHostBox(async (box) => {
    const run = await runInBox(box, "env");
    assert.equal(run.exit_code, 0);
    for (const canary of ["ghp_canary_value", "sk-ant-canary", "auth0-canary"]) assert.ok(!run.output.includes(canary), `${canary} leaked`);
    assert.ok(!/EXEC_TOKEN/.test(run.output), "the box capability is not handed to repository code");
  }, { GITHUB_TOKEN: "ghp_canary_value", ANTHROPIC_API_KEY: "sk-ant-canary", AUTH0_SECRET: "auth0-canary" });
});

test("host box: timeouts kill the command, output is capped, paths are contained", async () => {
  await withHostBox(async (box) => {
    const started = Date.now();
    const slow = await runInBox(box, "sleep 30", 1_000);
    assert.equal(slow.timed_out, true);
    assert.ok(Date.now() - started < 15_000, "the process tree was killed, not waited for");
    const loud = await runInBox(box, "head -c 200000 /dev/zero | tr '\\0' 'x'");
    assert.equal(loud.truncated, true);
    assert.ok(loud.output.length < 60_000);
    for (const bad of ["../escape.txt", "/etc/passwd", ".git/config", "a/../../b"]) {
      await assert.rejects(boxRequest(box, "POST", "/write", { path: bad, content: "x" }), ExecBoxError, bad);
    }
    await assert.rejects(boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "nope", new_string: "x" }), /not found/);
    await assert.rejects(boxRequest({ url: box.url, token: "wrong" }, "GET", "/health"), /unauthorized/);
  }, { OPENSRCER_EXEC_OUTPUT_BYTES: "8192" });
});

test("host box: the total command budget is enforced", async () => {
  await withHostBox(async (box) => {
    await runInBox(box, "sleep 2");
    await assert.rejects(runInBox(box, "echo too late"), /total command time/);
  }, { OPENSRCER_EXEC_TOTAL_MS: "1500" });
});

test("initBox refuses anything but a full SHA", async () => {
  const fake = { mode: "host" as const, url: "http://127.0.0.1:1", token: "x", stop: async () => {} };
  await assert.rejects(initBox(fake, tmpdir(), "HEAD"), /full commit SHA/);
});
