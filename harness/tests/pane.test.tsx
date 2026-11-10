// The lesson map pane (hooks/register.tsx), run in the engine's test kit:
// claude plugin test harness
import { expect, test } from "claude-code/testing";

// What the MCP server writes after a lesson step (graph.mjs lessonMapData), made by the real builder.
const MAP = {"lesson":"l_0b3a5c1e-0000-4000-8000-000000000001","stage":"explain","title":"acme/app #12","communities":[{"label":"janitor/functions","count":1,"level":"explored","x":0.9199999999999999,"y":0.86,"r":18},{"label":"janitor/functions","count":1,"level":"unseen","x":0.5210155232177244,"y":0.4610361797467704,"r":18},{"label":"janitor","count":1,"level":"changed","x":0.08,"y":0.08,"r":18}],"edges":[[0,1,1],[1,2,1]],"explored":["janitor/functions/fill.py"],"changed":["janitor/io.py"],"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 430\" width=\"640\" height=\"430\" font-family=\"sans-serif\"><line x1=\"588.8\" y1=\"344.0\" x2=\"333.4\" y2=\"184.4\" stroke=\"#8a8a8a\" stroke-opacity=\"0.45\" stroke-width=\"0.85\"/><line x1=\"333.4\" y1=\"184.4\" x2=\"51.2\" y2=\"32.0\" stroke=\"#8a8a8a\" stroke-opacity=\"0.45\" stroke-width=\"0.85\"/><circle cx=\"588.8\" cy=\"344.0\" r=\"18.0\" fill=\"#4E79A7\" stroke=\"#fff\" stroke-width=\"1.5\"><title>janitor/functions: 1 nodes</title></circle><circle cx=\"333.4\" cy=\"184.4\" r=\"18.0\" fill=\"#4b4b4b\" stroke=\"#777\" stroke-width=\"0.5\"><title>janitor/functions: 1 nodes</title></circle><circle cx=\"51.2\" cy=\"32.0\" r=\"18.0\" fill=\"#EDC948\" stroke=\"#fff\" stroke-width=\"1.5\"><title>janitor: 1 nodes</title></circle><text x=\"588.8\" y=\"323.0\" font-size=\"11\" text-anchor=\"middle\" fill=\"#9a9a9a\">janitor/functions</text><text x=\"333.4\" y=\"163.4\" font-size=\"11\" text-anchor=\"middle\" fill=\"#9a9a9a\">janitor/functions</text><text x=\"51.2\" y=\"11.0\" font-size=\"11\" text-anchor=\"middle\" fill=\"#9a9a9a\">janitor</text><circle cx=\"14\" cy=\"415\" r=\"5\" fill=\"#4b4b4b\"/><text x=\"24\" y=\"419\" font-size=\"11\" fill=\"#9a9a9a\">not looked at</text><circle cx=\"184\" cy=\"415\" r=\"5\" fill=\"#4E79A7\"/><text x=\"194\" y=\"419\" font-size=\"11\" fill=\"#9a9a9a\">your starting points</text><circle cx=\"354\" cy=\"415\" r=\"5\" fill=\"#EDC948\"/><text x=\"364\" y=\"419\" font-size=\"11\" fill=\"#9a9a9a\">changed by the fix</text></svg>"};

// The module loads only with its required userConfig, as in a session.
const OPTIONS = { options: { opensrcer_token: "osh_tttttttttttttttttttttttttttttttt" } };

const PANE = {
  plugin: "opensrcer",
  component: "Pane",
  requestId: "opensrcer-map",
  props: { title: "Code map", isFocused: false, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const;

test("a lesson tool call opens the map; the terminal gets cells, the other surfaces the SVG", OPTIONS, async ($, on) => {
  const opened: string[] = [];
  on("fs.read", (_, e) => (String(e.path).endsWith("current.json") ? { value: JSON.stringify(MAP) } : { error: "ENOENT" }));
  on("ui.open", (_, e) => { opened.push(e.title ?? ""); return { value: { isPlaced: true } }; });
  on("tool.call", () => ({ result: {} }));

  const ran = await $.tool.call({ tool: "mcp__plugin_opensrcer_opensrcer__lesson_reveal", lesson: MAP.lesson });
  expect(opened).toEqual(["Code map: acme/app #12"]);
  expect(String((ran as { context?: string[] }).context)).toMatch(/opensrcer pane beside the chat/);

  const terminal = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await terminal.find({ type: "Raster" })).toBeTruthy();
  expect((await terminal.find({ type: "Markdown" }))?.text).toMatch(/Changed by the fix:.*janitor\/io.py/);
  await terminal.unmount();

  for (const surface of ["desktop", "vscode", "mobile"] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: "Svg" })).toBeTruthy();
    expect((await ui.find({ type: "Markdown" }))?.text).toMatch(/Your starting points:.*janitor\/functions\/fill.py/);
    await ui.unmount();
  }
});

test("other tools leave the pane alone", OPTIONS, async ($, on) => {
  const opened: string[] = [];
  on("fs.read", () => ({ value: JSON.stringify(MAP) }));
  on("ui.open", (_, e) => { opened.push(e.title ?? ""); return { value: { isPlaced: true } }; });
  on("tool.call", () => ({ result: {} }));
  await $.tool.call({ tool: "Bash", command: "ls" });
  await $.tool.call({ tool: "mcp__plugin_opensrcer_opensrcer__repo_profile", repo: "acme/app" });
  expect(opened).toEqual([]);
});

test("before any lesson the pane says so", OPTIONS, async ($) => {
  const ui = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await ui.find({ type: "Text" }))?.text).toMatch(/No lesson map yet/);
  await ui.unmount();
});
