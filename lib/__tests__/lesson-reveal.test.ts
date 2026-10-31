import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSplitHunks } from "../diff-view";
import { changedNames, diffFiles, hunkVerdicts } from "../lesson/reveal";

const AI = [
  "diff --git a/src/flask/sessions.py b/src/flask/sessions.py",
  "--- a/src/flask/sessions.py",
  "+++ b/src/flask/sessions.py",
  "@@ -340,3 +340,4 @@ def save_session(self, app, session, response):",
  "     if not session:",
  "+        is_redirect = 300 <= response.status_code < 400",
  "         return",
  "diff --git a/tests/test_basic.py b/tests/test_basic.py",
  "--- a/tests/test_basic.py",
  "+++ b/tests/test_basic.py",
  "@@ -1,1 +1,2 @@",
  " import flask",
  "+def test_redirect(): pass",
  "",
].join("\n");
const hunks = parseSplitHunks(AI);

test("changedNames: code-shaped names on changed rows only", () => {
  assert.deepEqual(changedNames(hunks[0]), ["is_redirect", "status_code"]);
  assert.deepEqual(changedNames(hunks[1]), ["test_redirect"]);
});

test("diffFiles: the files a diff changes, deleted files excluded", () => {
  assert.deepEqual(diffFiles(AI), ["src/flask/sessions.py", "tests/test_basic.py"]);
  assert.deepEqual(diffFiles("--- a/x\n+++ /dev/null\n"), []);
  assert.deepEqual(diffFiles(""), []);
});

test("path A: a hunk matches when the plan names its file or a changed name", () => {
  assert.deepEqual(hunkVerdicts(hunks, { plan: "Look at sessions.py; the cookie is skipped." }), ["match", "miss"]);
  assert.deepEqual(hunkVerdicts(hunks, { plan: "check status_code and add test_redirect" }), ["match", "match"]);
  assert.deepEqual(hunkVerdicts(hunks, { plan: "mysessions.py and session handling" }), ["miss", "miss"], "partial names and plain words don't count");
  assert.deepEqual(hunkVerdicts(hunks, { plan: "" }), ["miss", "miss"]);
});

test("path B: a hunk matches when the contributor's diff changes the same file", () => {
  assert.deepEqual(hunkVerdicts(hunks, { diff: "--- a/src/flask/sessions.py\n+++ b/src/flask/sessions.py\n@@ -1 +1 @@\n-a\n+b\n" }), ["match", "miss"]);
  assert.deepEqual(hunkVerdicts(hunks, { diff: "" }), ["miss", "miss"]);
  assert.deepEqual(hunkVerdicts([], { diff: AI }), []);
});
