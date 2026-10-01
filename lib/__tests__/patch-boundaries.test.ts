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

test("patch modes are allowlisted, however git would spell a symlink", async () => {
  const { hasUnsafeMode } = await import("../apply-diff");
  // git reads modes with strtoul: a sign, leading \v \f \r, any 012xxxx value
  // (symlink), 0160000 (submodule), and the mode field of an index line.
  const unsafe = [
    "new file mode 120000", "new file mode 120000 ", "new file mode 0120000", "new file mode 120755",
    "new file mode +120000", "new file mode \v120000", "new file mode \f120000", "new file mode \r120000",
    "new mode 160000", "old mode 120000", "deleted file mode 120000", "index 0000000..e69de29 120000",
  ];
  for (const line of unsafe) {
    assert.equal(hasUnsafeMode(`diff --git a/s b/s\n${line}\n`), true, JSON.stringify(line));
  }
  const safe = ["new file mode 100644", "new file mode 100755", "old mode 100644", "index 0000000..e69de29", "index 83db48f..bf269f4 100644"];
  for (const line of safe) {
    assert.equal(hasUnsafeMode(`diff --git a/f b/f\n${line}\n`), false, JSON.stringify(line));
  }
});
