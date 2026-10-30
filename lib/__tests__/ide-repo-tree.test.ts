// lib/ide/repo-tree.ts: the IDE's view of a repo at a pinned commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryIndex, rawFileUrl, treeFiles, validSha } from "../ide/repo-tree";

const SHA = "d086db856be187255b8ec61ef409357393020f32";

for (const [value, ok] of [
  [SHA, true], [SHA.toUpperCase(), true], [SHA.slice(0, 39), false], [`${SHA}0`, false],
  ["main", false], ["", false], [undefined, false], [null, false], [42, false], [`${SHA.slice(0, 39)}g`, false],
] as Array<[unknown, boolean]>) {
  test(`validSha(${JSON.stringify(value)}) is ${ok}`, () => assert.equal(validSha(value), ok));
}

test("treeFiles keeps blobs only and reports truncation", () => {
  const { files, truncated } = treeFiles({
    truncated: true,
    tree: [
      { path: "src", type: "tree" },
      { path: "src/app.py", type: "blob", size: 12 },
      { path: "vendor/lib", type: "commit" },
      { path: "README.md", type: "blob" },
      { path: "", type: "blob", size: 1 },
      null,
    ],
  });
  assert.deepEqual(files, [{ path: "src/app.py", size: 12 }, { path: "README.md", size: 0 }]);
  assert.equal(truncated, true);
});

test("treeFiles: an empty tree is fine, a missing one is an error", () => {
  assert.deepEqual(treeFiles({ tree: [] }), { files: [], truncated: false });
  for (const bad of [null, {}, { tree: "x" }, "nope"]) assert.throws(() => treeFiles(bad), /no tree/);
});

test("directoryIndex lists each directory's children with their kind", () => {
  const index = directoryIndex(["README.md", "src/flask/app.py", "src/flask/cli.py", "src/main.py"]);
  assert.deepEqual([...index.get("")!], [["README.md", "file"], ["src", "dir"]]);
  assert.deepEqual([...index.get("src")!], [["flask", "dir"], ["main.py", "file"]]);
  assert.deepEqual([...index.get("src/flask")!], [["app.py", "file"], ["cli.py", "file"]]);
  assert.equal(index.has("src/flask/app.py"), false);
  assert.deepEqual([...directoryIndex([])], [["", new Map()]]);
});

test("rawFileUrl pins the commit and encodes each path segment", () => {
  assert.equal(rawFileUrl("pallets/flask", SHA, "docs/a b#?.md"), `https://raw.githubusercontent.com/pallets/flask/${SHA}/docs/a%20b%23%3F.md`);
});
