import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDiff } from "../apply-diff";

test("patches cannot change Git configuration or escape through a directory link", async () => {
  const root = mkdtempSync(join(tmpdir(), "opensrcer-patch-boundary-"));
  try {
    const repo = join(root, "repo");
    const outside = join(root, "outside");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(repo, ".git", "config"), "original\n");
    writeFileSync(join(outside, "secret.txt"), "original\n");
    symlinkSync(outside, join(repo, "link"), process.platform === "win32" ? "junction" : "dir");
    for (const file of [".git/config", "link/secret.txt"]) {
      const result = await applyDiff(repo, `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-original\n+changed\n`, join(root, "fix.patch"));
      assert.equal(result.ok, false);
    }
    assert.equal(readFileSync(join(repo, ".git", "config"), "utf8"), "original\n");
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "original\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
