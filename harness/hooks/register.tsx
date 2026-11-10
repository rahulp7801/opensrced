// The lesson's code map in a pane beside Claude Code's chat, for hosts that
// don't draw the MCP Apps panel (views/lesson.html). The MCP server writes
// the map (graph.mjs lessonMapData) to .maps/current.json in this plugin's
// folder after every lesson step that changes it; this redraws the pane
// after each lesson tool call. VS Code, the desktop and the mobile apps draw
// the SVG; the terminal draws the same layout in character cells.

import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";

import type { LessonMap, MapLevel } from "../types";

const PANE = "opensrcer-map";
const LESSON_TOOLS = "mcp__plugin_opensrcer_opensrcer__lesson_";
// Change the tag when LessonMap's fields change: it declines what an earlier version stored.
const map = atom({ plugin: "opensrcer", key: "map" } as const, null, { shape: "map-1" });

const LEGEND = "Clusters of related code from graphify, sized by how much code each holds. Blue: your starting points. Yellow: changed by the fix. Grey: not looked at yet.";
/** Cell colours (0x00RRGGBB); grey is lighter than the SVG's to read on a dark terminal. */
const CELL: Record<MapLevel, number> = { unseen: 0x8a8a8a, explored: 0x4e79a7, changed: 0xedc948 };
const DEFAULT = 0x01000000;

async function load($: { plugin: { root: string }; fs: { read: (path: string) => Promise<string> } }): Promise<LessonMap | null> {
  try {
    return JSON.parse(await $.fs.read(`${$.plugin.root}/.maps/current.json`)) as LessonMap;
  } catch {
    // ponytail: no map written yet (no lesson started here) reads as no map.
    return null;
  }
}

/** The map in terminal cells: dotted links, o/O for clusters, labels for the
 *  ones the lesson touches. Returns the Raster's base64 `cells`. */
function cells(m: LessonMap, columns: number, rows: number): string {
  const grid = new Uint32Array(columns * rows * 3);
  const put = (x: number, y: number, ch: number, fg: number) => {
    if (x < 0 || y < 0 || x >= columns || y >= rows) return;
    const i = (y * columns + x) * 3;
    grid[i] = ch; grid[i + 1] = fg; grid[i + 2] = DEFAULT;
  };
  for (let i = 0; i < columns * rows; i++) put(i % columns, Math.floor(i / columns), 0x20, DEFAULT);
  const at = (c: { x: number; y: number } | undefined): [number, number] => (c ? [Math.round(c.x * (columns - 1)), Math.round(c.y * (rows - 1))] : [-1, -1]);
  for (const [a, b] of m.edges) {
    const [x0, y0] = at(m.communities[a]);
    const [x1, y1] = at(m.communities[b]);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 1; s < steps; s++) put(Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps), 0x2e, 0x5a5a5a);
  }
  // Touched clusters last, so they sit on top.
  const order = [...m.communities].sort((a, b) => Number(a.level !== "unseen") - Number(b.level !== "unseen"));
  for (const c of order) {
    const [x, y] = at(c);
    put(x, y, c.r > 10 ? 0x4f : 0x6f, CELL[c.level]);
    if (c.level === "unseen") continue;
    // ASCII only: a cell takes one printable width-1 character.
    [...c.label.slice(0, 24)].forEach((ch, i) => put(x + 2 + i, y, /[ -~]/.test(ch) ? ch.charCodeAt(0) : 0x3f, CELL[c.level]));
  }
  // The engine's runtime has Uint8Array#toBase64 (RasterProps' own example uses it); es2023's types don't.
  return (new Uint8Array(grid.buffer) as Uint8Array & { toBase64(): string }).toBase64();
}

function notes(m: LessonMap): string {
  const lines = [];
  if (m.explored.length) lines.push(`**Your starting points:** ${m.explored.map((f) => `\`${f}\``).join(", ")}`);
  if (m.changed.length) lines.push(`**Changed by the fix:** ${m.changed.map((f) => `\`${f}\``).join(", ")}`);
  return lines.join("\n\n");
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "opensrcer-map", description: "Show the opensrcer lesson's code map beside the chat" });
    return next(e);
  });

  on("command.run", { command: "opensrcer-map" }, async ($) => {
    const m = await load($);
    if (!m) return { text: "No lesson map yet: start a lesson (lesson_start) first." };
    await update($, map, () => m);
    const opened = await $.ui.open({ id: PANE, title: `Code map: ${m.title}` });
    return { text: opened.isPlaced ? `Opened the code map for ${m.title}.` : "This surface can't show a pane beside the chat." };
  });

  on("tool.call", async ($, e, next) => {
    const ran = await next(e);
    if (!e.tool.startsWith(LESSON_TOOLS) || ran.deny !== undefined || ran.isError) return ran;
    // The map is extra: whatever goes wrong drawing it, the lesson call's result stands.
    const shown = await (async () => {
      const m = await load($);
      if (!m) return false;
      await update($, map, () => m);
      return (await $.ui.open({ id: PANE, title: `Code map: ${m.title}` })).isPlaced;
    })().catch((error: unknown) => {
      $.ui.log(`opensrcer map: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
    if (!shown) return ran;
    // The model learns the map is on screen, so it can point the user to it.
    return { ...ran, context: [...(ran.context ?? []), "The lesson's code map is in the opensrcer pane beside the chat: blue marks the user's starting points, yellow what the fix changes (after the reveal). Point the user to it when it helps; /opensrcer-map reopens it."] };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const m = await read($, map);
    const { Box, Text, Markdown } = $.ui.resolve(e);
    if (!m) return <Text dimColor>No lesson map yet. Start a lesson and it appears here.</Text>;
    const text = notes(m);
    if (e.surface === "terminal") {
      const { Raster } = $.ui.resolve({ ...e, surface: "terminal" as const });
      const columns = Math.max(20, Math.min(512, (e.viewport?.columns ?? 80) - 2));
      const rows = Math.max(8, Math.min(256, (e.viewport?.rows ?? 24) - 9));
      return (
        <Box flexDirection="column">
          <Raster key="map" columns={columns} rows={rows} cells={cells(m, columns, rows)} />
          <Text dimColor>{LEGEND}</Text>
          {text && <Markdown text={text} />}
        </Box>
      );
    }
    const { Svg } = $.ui.resolve({ ...e, surface: e.surface === "vscode" ? ("vscode" as const) : e.surface === "mobile" ? ("mobile" as const) : ("desktop" as const) });
    return (
      <Box flexDirection="column">
        <Svg source={m.svg} alt={`Code map of ${m.title}: ${m.communities.length} clusters of code. ${text.replace(/[*`]/g, "")}`} isInteractive />
        <Text dimColor>{LEGEND}</Text>
        {text && <Markdown text={text} />}
      </Box>
    );
  });
};
