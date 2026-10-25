import { test } from "node:test";
import assert from "node:assert/strict";
import { dependentsByHop, impactContext, questionSubject, type GraphData } from "../graph";

// app.py re-exports render; views calls render; tests/test_views imports views;
// a note node mentions render but is never the subject.
const graph = {
  nodes: [
    { id: "render", label: "render_template()", community: 0, file_type: "code", source_file: "src/templating.py", source_location: "L136" },
    { id: "init", label: "__init__.py", community: 0, file_type: "code", source_file: "src/__init__.py" },
    { id: "views", label: "views.py", community: 1, file_type: "code", source_file: "src/views.py" },
    { id: "tv", label: "test_views.py", community: 2, file_type: "code", source_file: "tests/test_views.py" },
    { id: "note_rationale_1", label: "render_template docs", community: 0, file_type: "code", source_file: "src/templating.py" },
    { id: "truncate", label: "truncate()", community: 3, file_type: "code", source_file: "src/truncate.ts" },
  ],
  links: [
    { source: "init", target: "render", relation: "re_exports" },
    { source: "views", target: "render", relation: "calls" },
    { source: "tv", target: "views", relation: "imports" },
    { source: "render", target: "init", relation: "contains" },
  ],
} as unknown as GraphData;

for (const [question, expected] of [
  ["Where is render_template used, and what breaks if I change it?", "render"],
  ["what breaks if I change render_template()?", "render"],
  ["Where is truncate used?", "truncate"],
  ["Where is the config read?", null],
  ["", null],
] as Array<[string, string | null]>) {
  test(`questionSubject: ${JSON.stringify(question)}`, () => {
    assert.equal(questionSubject(graph, question)?.id ?? null, expected);
  });
}

test("dependentsByHop: follows dependency relations only, by hop, without repeats", () => {
  const hops = dependentsByHop(graph, "render");
  assert.deepEqual(hops.map((h) => h.map((n) => n.id).sort()), [["init", "views"], ["tv"]]);
  assert.deepEqual(dependentsByHop(graph, "tv"), []);
  assert.deepEqual(dependentsByHop(graph, "unknown"), []);
});

test("impactContext: exact counts, files, hops and test files for the subject", () => {
  const text = impactContext(graph, "What breaks if I change render_template?");
  assert.match(text, /^IMPACT DATA for render_template\(\) \(src\/templating\.py:L136\)/);
  assert.match(text, /3 places depend on it within 3 hops, in 3 files \(2 at hop 1, 1 at hop 2\)/);
  assert.match(text, /Test files among them: tests\/test_views\.py/);
  assert.match(impactContext(graph, "Where is truncate used?"), /Nothing in the graph depends on it\./);
  assert.equal(impactContext(graph, "Where is the config read?"), "");
});
