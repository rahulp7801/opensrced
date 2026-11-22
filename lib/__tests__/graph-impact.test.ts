import test from "node:test";
import assert from "node:assert/strict";
import { analyzeImpactFromDiff, changedOldLines, editedNodeIds, touchedNodeIds } from "../graph-impact";
import type { GraphData } from "../graph";

test("touchedNodeIds: nodes in changed files and changed definitions, nothing else", () => {
  const graph = {
    nodes: [
      { id: "s", label: "searchUsers", source_file: "src/users.ts", community: 1 },
      { id: "h", label: "helper", source_file: "src/other.ts", community: 1 },
      { id: "r", label: "usersRoute", source_file: "src/routes.ts", community: 2 },
    ],
    links: [],
  } as unknown as GraphData;
  assert.deepEqual([...touchedNodeIds(graph, "+++ b/src/users.ts\n+x")], ["s"]);
  assert.deepEqual([...touchedNodeIds(graph, "+++ b/src/none.ts\n+function helper() {}")], ["h"], "a changed definition elsewhere");
  assert.deepEqual([...touchedNodeIds(graph, "")], []);
});

test("graph impact follows downstream callers and ignores unrelated links", () => {
  const graph = {
    nodes: [
      { id: "search", label: "searchUsers", source_file: "src/users.ts", community: 1 },
      { id: "route", label: "usersRoute", source_file: "src/routes.ts", community: 2 },
      { id: "app", label: "app", source_file: "src/app.ts", community: 2 },
      { id: "doc", label: "readme", source_file: "README.md", community: 3 },
      { id: "unknown", label: "unknown", source_file: "", community: 4 },
    ],
    links: [
      { source: "route", target: "search", relation: "calls" },
      { source: "app", target: "route", relation: "imports" },
      { source: "doc", target: "search", relation: "documents" },
    ],
  } as GraphData;
  const result = analyzeImpactFromDiff(graph, "+++ b/src/users.ts\n+function searchUsers() {}");

  assert.equal(result.totalAffected, 2);
  assert.equal(result.affectedModules, 2);
  assert.deepEqual(result.affectedLabels, ["usersRoute", "app"]);
  assert.equal(result.topNode, "searchUsers");
});

test("graph impact returns an empty result when the patch has no indexed match", () => {
  const graph = { nodes: [], links: [] } as unknown as GraphData;
  assert.deepEqual(analyzeImpactFromDiff(graph, "+++ b/src/new.ts\n+const added = true"), {
    totalAffected: 0,
    affectedModules: 0,
    affectedLabels: [],
    topNode: "",
  });
});

test("graph impact handles a production-size dependency chain", { timeout: 2_000 }, () => {
  const count = 10_000;
  const graph = {
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `node-${index}`,
      label: `node${index}`,
      source_file: index === 0 ? "src/entry.ts" : `src/generated/${index}.ts`,
      community: index % 10,
    })),
    links: Array.from({ length: count - 1 }, (_, index) => ({
      source: `node-${index + 1}`,
      target: `node-${index}`,
      relation: "calls",
    })),
  } as GraphData;

  const result = analyzeImpactFromDiff(graph, "+++ b/src/entry.ts\n+const entry = true");
  assert.equal(result.totalAffected, count - 1);
  assert.equal(result.affectedModules, 10);
  assert.equal(result.topNode, "node0");
});

test("changedOldLines: removed lines where they were, added ones at the line they follow, hunk headers' names", () => {
  const diff = [
    "diff --git a/pkg/core.py b/pkg/core.py", "--- a/pkg/core.py", "+++ b/pkg/core.py",
    "@@ -10,4 +10,5 @@ class Option(Parameter):", " a", "-b", "+B", "+C", " d",
    "@@ -40,2 +41,2 @@ def get_error_hint(self, ctx):", " x", "--- a dashed line the fix removes",
  ].join("\n");
  assert.deepEqual([...changedOldLines(diff)], [["pkg/core.py", { lines: [11, 11, 11, 41], headers: ["option", "get_error_hint"], adds: false }]]);
});

test("changedOldLines: a run of additions that defines a new function is new, not a change to the one above it (or its hunk header)", () => {
  // tempfile #444: a test appended after the file's last one, whose name git puts in the header.
  const appended = "--- a/tests/t.rs\n+++ b/tests/t.rs\n@@ -700,3 +700,9 @@ fn test_last() {\n     }\n }\n+\n+#[cfg(windows)]\n+#[test]\n+fn test_new() {\n+    keep();\n+}\n";
  assert.deepEqual([...changedOldLines(appended)], [["tests/t.rs", { lines: [], headers: [], adds: true }]]);
  // A guard added inside a function still counts, as does a new function that replaces old lines.
  const guard = "--- a/src/a.rs\n+++ b/src/a.rs\n@@ -10,2 +10,3 @@ fn keep() {\n     let x = 1;\n+    if x == 0 { return; }\n }\n";
  assert.deepEqual([...changedOldLines(guard)], [["src/a.rs", { lines: [10], headers: ["keep"], adds: false }]]);
  const rewritten = "--- a/src/a.py\n+++ b/src/a.py\n@@ -5,2 +5,2 @@\n-def old():\n+def new():\n     pass\n";
  assert.deepEqual(changedOldLines(rewritten).get("src/a.py")?.lines, [5, 5]);
});

test("changedOldLines: new cases in a decorator belong to the function it decorates, not the one above (requests #7647)", () => {
  // Lines 646-649 close test_get_encoding_from_headers' @pytest.mark.parametrize; its def is line 652.
  const parametrize = "--- a/tests/test_utils.py\n+++ b/tests/test_utils.py\n@@ -647,6 +647,8 @@ def test__parse_content_type_header(value, expected):\n             \"ISO-8859-1\",\n         ),\n+        (CaseInsensitiveDict({\"content-type\": \"TEXT/PLAIN\"}), \"ISO-8859-1\"),\n+        (CaseInsensitiveDict({\"content-type\": \"APPLICATION/JSON\"}), \"utf-8\"),\n     ),\n )\n def test_get_encoding_from_headers(value, expected):\n";
  assert.deepEqual(changedOldLines(parametrize).get("tests/test_utils.py")?.lines, [651, 651]);
  // A change at the end of a function, then a blank line before the next: it stays where it is.
  const tail = "--- a/src/a.py\n+++ b/src/a.py\n@@ -10,3 +10,4 @@\n     x = f(\n+        y,\n     )\n \n def g():\n";
  assert.deepEqual(changedOldLines(tail).get("src/a.py")?.lines, [10]);
});

test("editedNodeIds: a file the fix only appends a new function to is edited as a file, not in the function above", () => {
  const node = (id: string, label: string, file: string, line: number) => ({ id, label, community: 0, file_type: "code", source_file: file, source_location: `L${line}` });
  const graph = { nodes: [node("t_file", "t.rs", "tests/t.rs", 1), node("t_last", "test_last()", "tests/t.rs", 690)], links: [] } as unknown as GraphData;
  const appended = "--- a/tests/t.rs\n+++ b/tests/t.rs\n@@ -700,3 +700,6 @@ fn test_last() {\n     }\n }\n+\n+fn test_new() {\n+}\n";
  assert.deepEqual([...editedNodeIds(graph, appended)], ["t_file"]);
});

test("editedNodeIds: the function each changed line sits in, not every node of a big changed file", () => {
  const node = (id: string, label: string, file: string, line?: number) => ({ id, label, community: 0, file_type: "code", source_file: file, ...(line ? { source_location: `L${line}` } : {}) });
  const graph = {
    nodes: [
      node("core", "core.py", "pkg/core.py", 1), node("opt", "Option", "pkg/core.py", 10),
      node("hint", ".get_error_hint()", "pkg/core.py", 20), node("help", ".get_help_extra()", "pkg/core.py", 40),
      node("t_old", "test_old()", "tests/test_core.py", 5), node("t_cli", "cli()", "tests/test_other.py", 3),
      node("far", "progressbar()", "pkg/termui.py", 1),
    ],
    links: [{ source: "far", target: "help", relation: "calls" }],
  } as unknown as GraphData;
  const diff = [
    "--- a/pkg/core.py", "+++ b/pkg/core.py", "@@ -21,2 +21,3 @@", "     result = 1", "+    result = 2",
    "--- a/tests/test_core.py", "+++ b/tests/test_core.py", "@@ -8,1 +8,4 @@", " x", "+def test_new():", "+    def cli():", "+        pass",
  ].join("\n");
  assert.deepEqual([...editedNodeIds(graph, diff)].sort(), ["hint", "t_old"], "get_error_hint and the test the new one follows; not core.py's other nodes, not every cli()");
  assert.ok(touchedNodeIds(graph, diff).has("help"), "(touchedNodeIds takes the whole file)");
  // Without line numbers: the hunk header names the function; failing that, the whole file.
  const flat = { nodes: graph.nodes.map((n) => ({ ...n, source_location: undefined })), links: [] } as unknown as GraphData;
  assert.deepEqual([...editedNodeIds(flat, "--- a/pkg/core.py\n+++ b/pkg/core.py\n@@ -21,2 +21,3 @@ def get_error_hint(self):\n+x\n")], ["hint"]);
  assert.equal(editedNodeIds(flat, "--- a/pkg/core.py\n+++ b/pkg/core.py\n@@ -21,2 +21,3 @@\n+x\n").size, 4);
});
