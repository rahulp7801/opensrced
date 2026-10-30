// lib/ide/diff.ts: the contributor's edits as a git-style unified diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gitDiff } from "../ide/diff";

test("gitDiff: an edit is a git-style hunk with a/ b/ prefixes", () => {
  const diff = gitDiff([{ path: "src/app.py", base: "a = 1\nb = 2\nc = 3\n", current: "a = 1\nb = 20\nc = 3\n" }]);
  assert.equal(diff, [
    "diff --git a/src/app.py b/src/app.py",
    "--- a/src/app.py",
    "+++ b/src/app.py",
    "@@ -1,3 +1,3 @@",
    " a = 1",
    "-b = 2",
    "+b = 20",
    " c = 3",
    "",
  ].join("\n"));
});

test("gitDiff: a created file diffs against /dev/null with a new-file header", () => {
  assert.equal(gitDiff([{ path: "notes.txt", base: null, current: "hi\n" }]), [
    "diff --git a/notes.txt b/notes.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/notes.txt",
    "@@ -0,0 +1,1 @@",
    "+hi",
    "",
  ].join("\n"));
});

test("gitDiff: a missing final newline is marked the way git marks it", () => {
  assert.match(gitDiff([{ path: "a.txt", base: "x\n", current: "x" }]), /-x\n\+x\n\\ No newline at end of file\n$/);
});

test("gitDiff skips unchanged files, sorts by path, and is empty with no edits", () => {
  assert.equal(gitDiff([]), "");
  assert.equal(gitDiff([{ path: "same.py", base: "x\n", current: "x\n" }]), "");
  const diff = gitDiff([
    { path: "z.py", base: "1\n", current: "2\n" },
    { path: "same.py", base: "x\n", current: "x\n" },
    { path: "a.py", base: "1\n", current: "2\n" },
  ]);
  assert.deepEqual([...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]), ["a.py", "z.py"]);
});

test("gitDiff: an emptied file and an empty new file", () => {
  assert.match(gitDiff([{ path: "a.txt", base: "x\n", current: "" }]), /@@ -1,1 \+0,0 @@\n-x\n$/);
  // An empty new file has no hunk; the header alone records it.
  assert.equal(gitDiff([{ path: "empty.txt", base: null, current: "" }]), "diff --git a/empty.txt b/empty.txt\nnew file mode 100644\n--- /dev/null\n+++ b/empty.txt\n");
});
