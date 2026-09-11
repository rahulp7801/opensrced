import { test } from "node:test";
import assert from "node:assert/strict";
import { graphHtmlResponse } from "../graph-html";

test("repository-generated graph HTML cannot use the application origin or shared caches", () => {
  const response = graphHtmlResponse("<html>graph</html>");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const policy = response.headers.get("Content-Security-Policy")!;
  assert.ok(policy.includes("sandbox allow-scripts;"));
  assert.ok(!policy.includes("allow-same-origin"));
  assert.ok(policy.includes("default-src 'none'"));
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
});
