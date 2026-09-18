import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

test("PR pushes use the user's identity, preserve unrelated files, and block a failed scan", async t => {
  const root = mkdtempSync(join(tmpdir(), "opensrcer-push-test-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const git = (args: string[]) => childProcess.execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const originalExecFile = childProcess.execFile;
    const callOriginal = originalExecFile as unknown as (
      command: string,
      args: string[],
      options: unknown,
      callback: unknown,
    ) => childProcess.ChildProcess;
  try {
    git(["init", "--bare", remote]);
    mkdirSync(seed);
    git(["-C", seed, "init", "-b", "main"]);
    writeFileSync(join(seed, "file.txt"), "old\n");
    writeFileSync(join(seed, "keep.orig"), "legitimate tracked file\n");
    git(["-C", seed, "add", "."]);
    git(["-C", seed, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]);
    git(["-C", seed, "push", remote, "main"]);
    // Redirect only the clone to a local bare repository. No network or real PR.
    childProcess.execFile = ((cmd: string, args: string[], options: unknown, callback: unknown) => {
      const redirected = args.map(arg => arg === "https://github.com/acme/app.git" ? remote : arg);
      return callOriginal(cmd, redirected, options, callback);
    }) as typeof childProcess.execFile;
    Object.defineProperty(childProcess.execFile, promisify.custom, { value: (cmd: string, args: string[], options: object) => new Promise((resolve, reject) => {
      childProcess.execFile(cmd, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    }) });
    t.mock.method(globalThis, "fetch", async () => Response.json({ login: "alice", id: 42 }));
    const scanner = await import("../gitleaks-scanner");
    let scanClean = true;
    t.mock.method(scanner, "scanSecrets", async (scanRoot: string) => {
      assert.ok(existsSync(join(scanRoot, "fix.patch")), "scan must include the raw patch");
      assert.ok(existsSync(join(scanRoot, "repo", "file.txt")), "scan must also include final source");
      return { status: scanClean ? "clean" : "error", findings: [], findingCount: 0, durationMs: 0 };
    });
    const { pushPrPatch } = await import("../pr-push");
    const input = { repo: "acme/app", branch: "main", diff: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n", commit_message: "fix feedback" };
    const result = await pushPrPatch(input, "test-user-token");
    assert.equal(result.ok, true);
    assert.equal(git(["--git-dir", remote, "show", "main:file.txt"]), "new");
    assert.equal(git(["--git-dir", remote, "show", "main:keep.orig"]), "legitimate tracked file");
    assert.equal(git(["--git-dir", remote, "log", "main", "-1", "--format=%an <%ae>"]), "alice <42+alice@users.noreply.github.com>");
    const before = git(["--git-dir", remote, "rev-parse", "main"]);
    scanClean = false;
    await assert.rejects(pushPrPatch({ ...input, diff: input.diff.replace("-old\n+new", "-new\n+another") }, "test-user-token"), /Secret scan did not pass/);
    assert.equal(git(["--git-dir", remote, "rev-parse", "main"]), before);
  } finally {
    childProcess.execFile = originalExecFile;
    rmSync(root, { recursive: true, force: true });
  }
});
