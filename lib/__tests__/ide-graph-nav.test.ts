// lib/ide/graph-nav.ts: go-to-definition and references from the code graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRAPH_NAV_LIMIT, graphLine, graphNav } from "../ide/graph-nav";
import type { GraphData } from "../graph";

const graph = {
  nodes: [
    { id: "render", label: "render_template()", community: 0, file_type: "code", source_file: "src/flask/templating.py", source_location: "L136" },
    { id: "method", label: ".render_template()", community: 0, file_type: "code", source_file: "src/flask/app.py", source_location: "L900" },
    { id: "file", label: "templating.py", community: 0, file_type: "code", source_file: "src/flask/templating.py", source_location: "L1" },
    { id: "views", label: "index()", community: 1, file_type: "code", source_file: "examples/views.py", source_location: "L10" },
    { id: "nofile", label: "render_template()", community: 2, file_type: "code", source_file: "" },
    { id: "prefix", label: "render_template_string()", community: 0, file_type: "code", source_file: "src/flask/templating.py", source_location: "L151" },
  ],
  links: [
    { source: "views", target: "render", relation: "calls", source_file: "examples/views.py", source_location: "L12" },
    { source: "views", target: "render", relation: "calls", source_file: "examples/views.py", source_location: "L12" },
    { source: "file", target: "render", relation: "contains", source_file: "src/flask/templating.py", source_location: "L136" },
    { source: "doc", target: "render", relation: "rationale_for", source_file: "src/flask/templating.py", source_location: "L137" },
    { source: "views", target: "method", relation: "references", source_file: "examples/other.py" },
    { source: "views", target: "prefix", relation: "calls", source_file: "examples/views.py", source_location: "L20" },
  ],
} as unknown as GraphData;

test("graphNav finds functions and methods by exact name, and their uses", () => {
  assert.deepEqual(graphNav(graph, "render_template"), {
    definitions: [{ file: "src/flask/templating.py", line: 136 }, { file: "src/flask/app.py", line: 900 }],
    // Duplicates collapse; contains/rationale edges are structure, not uses; no location means line 1.
    references: [{ file: "examples/views.py", line: 12 }, { file: "examples/other.py", line: 1 }],
  });
});

test("graphNav: unknown, blank and prefix-only symbols find nothing", () => {
  for (const symbol of ["nope", "", "   ", "render", "templating"]) {
    assert.deepEqual(graphNav(graph, symbol), { definitions: [], references: [] }, symbol);
  }
  assert.deepEqual(graphNav({ nodes: [], links: [] }, "x"), { definitions: [], references: [] });
});

test("graphNav caps each list", () => {
  const many = {
    nodes: [{ id: "f", label: "f()", community: 0, file_type: "code", source_file: "f.py", source_location: "L1" }],
    links: Array.from({ length: GRAPH_NAV_LIMIT + 5 }, (_, i) => ({ source: `c${i}`, target: "f", relation: "calls", source_file: "c.py", source_location: `L${i + 1}` })),
  } as unknown as GraphData;
  assert.equal(graphNav(many, "f").references.length, GRAPH_NAV_LIMIT);
});

for (const [location, line] of [["L136", 136], ["L0", 1], ["L12-L20", 12], [undefined, 1], ["", 1], ["136", 1], ["Lx", 1]] as Array<[string | undefined, number]>) {
  test(`graphLine(${JSON.stringify(location)}) is ${line}`, () => assert.equal(graphLine(location), line));
}
