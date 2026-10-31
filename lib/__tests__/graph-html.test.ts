import { test } from "node:test";
import assert from "node:assert/strict";
import { graphHtmlResponse, MAP_COLORS, withMapOverlay } from "../graph-html";

test("repository-generated graph HTML cannot use the application origin or shared caches", () => {
  const response = graphHtmlResponse("<html>graph</html>");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const policy = response.headers.get("Content-Security-Policy")!;
  assert.ok(policy.includes("sandbox allow-scripts;"));
  assert.ok(!policy.includes("allow-same-origin"));
  assert.ok(policy.includes("default-src 'none'"));
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
});

const VIZ = "<html><body><script>const nodesDS = new vis.DataSet([]);</script></body></html>";

test("withMapOverlay: recolours graphify's nodes from the user's levels, before </body>", () => {
  const html = withMapOverlay(VIZ, new Map([["a", "changed"], ["b", "explored"]]));
  assert.ok(html.endsWith("</script>\n</body></html>"));
  assert.ok(html.startsWith(VIZ.slice(0, VIZ.lastIndexOf("</body>"))), "the original page is kept");
  assert.ok(html.includes('"a":"changed"') && html.includes(MAP_COLORS.changed) && html.includes("nodesDS.update"));
  // No levels: everything is grey (unseen), still with the legend.
  assert.ok(withMapOverlay(VIZ, new Map()).includes('"levels":{}'));
});

test("withMapOverlay: node ids cannot close the script; pages without graphify's nodes are unchanged", () => {
  const html = withMapOverlay(VIZ, new Map([["</script><script>alert(1)//", "explored"]]));
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("\\u003c/script>"), "escaped in the JSON");
  const tooLarge = "<html><body><h2>Graph too large</h2></body></html>";
  assert.equal(withMapOverlay(tooLarge, new Map([["a", "changed"]])), tooLarge);
  assert.equal(withMapOverlay("", new Map()), "");
});
