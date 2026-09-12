import test from "node:test";
import assert from "node:assert/strict";
import { analyzeImpactFromDiff } from "../graph-impact";
import type { GraphData } from "../graph";

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
