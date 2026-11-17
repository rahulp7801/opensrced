// The code graph: graphify on the local checkout, built the way the site
// builds it (lib/graph-worker.ts): a disposable clone of the commit, source
// links removed, `python -I -m graphify update .`. Its graph.json is what the
// lesson's steps are graded against; its graph.html is the map in the panel,
// recoloured by the lesson (as lib/graph-html.ts withMapOverlay does on the site).
//
// Python comes from OPENSRCER_GRAPH_PYTHON (the site's setting), else
// `python`; graphify is the version the site pins in requirements-graph.txt.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const GRAPHIFY_VERSION = "0.9.73";
export const GRAPHIFY_INSTALL = `pip install graphifyy==${GRAPHIFY_VERSION}`;
const TIMEOUT_MS = 15 * 60_000;

export class GraphifyError extends Error {}
/** graphify (or Python) isn't installed here: the map can come from opensrcer instead. */
export class GraphifyMissing extends GraphifyError {}

/** Only the fields the lesson reads (lib/graph-worker.ts compactGraph):
 *  graphify's provenance fields roughly double the size. Pure. */
export function compactGraph(raw) {
  return {
    nodes: raw.nodes.map(({ id, label, community, file_type, source_file, source_location, norm_label }) => ({ id, label, community, file_type, source_file: source_file ?? "", source_location, norm_label })),
    links: (raw.links ?? raw.edges ?? []).map(({ source, target, relation, confidence, confidence_score, source_file, source_location, weight }) => ({ source, target, relation, confidence, confidence_score, source_file: source_file ?? "", source_location, weight })),
  };
}

/** The graphify version installed in `python`, or null when there is none. */
export async function localGraphifyVersion(python = process.env.OPENSRCER_GRAPH_PYTHON || "python") {
  return run(python, ["-I", "-c", "import importlib.metadata as m; print(m.version('graphifyy'))"], { encoding: "utf8", windowsHide: true, timeout: 20_000 })
    .then(({ stdout }) => stdout.trim() || null, () => null);
}

/** graphify's graph of `top` at its HEAD commit: {graph, html, sha, cached}.
 *  Cached under `cacheRoot/<version>/<sha>`. Throws GraphifyError with what to do;
 *  GraphifyMissing also when the installed graphify isn't the pinned version, since
 *  a different version draws a different graph than the one the site grades with. */
export async function graphify(top, cacheRoot, python = process.env.OPENSRCER_GRAPH_PYTHON || "python") {
  const version = await localGraphifyVersion(python);
  if (version && version !== GRAPHIFY_VERSION) throw new GraphifyMissing(`graphify ${version} is installed in "${python}", but opensrcer uses ${GRAPHIFY_VERSION} (${GRAPHIFY_INSTALL}).`);
  const sha = (await run("git", ["-C", top, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
  const cache = join(cacheRoot, GRAPHIFY_VERSION, sha);
  if (existsSync(join(cache, "graph.json")) && existsSync(join(cache, "graph.html"))) {
    return { graph: JSON.parse(readFileSync(join(cache, "graph.json"), "utf8")), html: readFileSync(join(cache, "graph.html"), "utf8"), sha, cached: true };
  }
  const root = mkdtempSync(join(tmpdir(), "opensrcer-graph-"));
  const source = join(root, "repo");
  const output = join(root, "output");
  try {
    // The commit, not the working tree: the map shows the project as it is upstream.
    await run("git", ["clone", "-q", "--shared", top, source], { timeout: 120_000 });
    // Never let repository links point the parser at files outside the clone.
    const { stdout } = await run("git", ["-C", source, "ls-files", "--stage", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const entry of stdout.split("\0")) {
      if (!entry.startsWith("120000 ")) continue;
      const target = resolve(source, entry.slice(entry.indexOf("\t") + 1));
      const rel = relative(source, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new GraphifyError("The checkout has a link that points outside it; refusing to map it.");
      rmSync(target, { force: true });
    }
    try {
      // -I: a repository's own graphify.py can't shadow the installed package.
      await run(python, ["-I", "-m", "graphify", "update", "."], { cwd: source, env: { ...process.env, GRAPHIFY_OUT: output }, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    } catch (error) {
      const said = `${error.stderr ?? ""}${error.stdout ?? ""}`;
      if (error.code === "ENOENT" || /Python was not found/.test(said)) throw new GraphifyMissing(`The code map needs Python with graphify, and "${python}" wasn't found. Install it (${GRAPHIFY_INSTALL}) and set OPENSRCER_GRAPH_PYTHON to that Python.`);
      if (/No module named graphify/.test(said)) throw new GraphifyMissing(`The code map needs graphify in "${python}": ${GRAPHIFY_INSTALL} (or set OPENSRCER_GRAPH_PYTHON to a Python that has it).`);
      if (error.killed) throw new GraphifyError("graphify took longer than 15 minutes on this checkout.");
      throw new GraphifyError(`graphify failed: ${said.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`);
    }
    const graph = compactGraph(JSON.parse(readFileSync(join(output, "graph.json"), "utf8")));
    const html = readFileSync(join(output, "graph.html"), "utf8");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "graph.json"), JSON.stringify(graph));
    writeFileSync(join(cache, "graph.html"), html);
    return { graph, html, sha, cached: false };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const norm = (s) => s.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\(\)$/, "").replace(/^`|`$/g, "").toLowerCase();

/** What the panel colours: nodes the fix touches ("changed", as
 *  lib/graph-impact.ts touchedNodeIds reads a diff) and the nodes the user
 *  picked as starting points ("explored"). Pure. */
const CODE_EXT = /\.(?:py|pyi|js|mjs|cjs|jsx|ts|tsx|go|rs|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|scala|sh|md|rst|toml|ya?ml|json|cfg|ini|txt|html|css)$/i;

export function overlayLevels(graph, picks, keyDiff) {
  const levels = new Map();
  for (const pick of picks.map(norm).filter(Boolean)) {
    // As lib/lesson/steps/s7.ts pickNodes: a path or a real file extension is a file;
    // "Serializer.loads" is a method, matched by graphify's qualified id (…_serializer_loads).
    const isFile = pick.includes("/") || CODE_EXT.test(pick);
    const suffix = pick.includes(".") && !isFile ? `_${pick.split(".").join("_")}` : null;
    for (const n of graph.nodes) {
      const file = norm(n.source_file || "");
      const label = norm(n.label).replace(/^\./, "");
      const hit = isFile ? file && (file === pick || file.endsWith(`/${pick}`)) : suffix ? n.id.toLowerCase().endsWith(suffix) : label === pick;
      if (hit) levels.set(n.id, "explored");
    }
  }
  if (keyDiff) {
    const files = [...keyDiff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((m) => norm(m[1]));
    const symbols = new Set([...keyDiff.matchAll(/^[+-]\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/gm)].map((m) => m[1].toLowerCase()));
    for (const n of graph.nodes) {
      const file = norm(n.source_file || "");
      if ((file && files.some((f) => file.includes(f) || f.includes(file))) || symbols.has(norm(n.label))) levels.set(n.id, "changed");
    }
  }
  return levels;
}

export const MAP_COLORS = { unseen: "#4b4b4b", explored: "#4E79A7", changed: "#EDC948" };
const MAP_LABELS = { unseen: "not looked at", explored: "your starting points", changed: "changed by the fix" };

/** graphify's viz recoloured by the lesson, with a legend. HTML without
 *  graphify's node DataSet comes back unchanged. Node ids come from the
 *  repository, so the JSON is escaped against closing the script tag. Pure. */
export function withOverlay(html, levels) {
  const end = html.lastIndexOf("</body>");
  if (end < 0) return html;
  // graphify's viewer is readable and its legend checkboxes have names, whatever the lesson colours.
  const access = `<style>#stats, .empty { color: #a0a0b8 !important; }</style>
<script>
(() => {
  const name = () => document.querySelectorAll("input[type=checkbox]:not([aria-label])").forEach((cb) => {
    const text = (cb.closest("label, .legend-item") ?? cb.parentElement)?.textContent?.trim();
    cb.setAttribute("aria-label", text || "Show this group");
  });
  name();
  new MutationObserver(name).observe(document.body, { childList: true, subtree: true });
})();
</script>
`;
  // graphify labels its biggest nodes at 12 graph units, which a fitted narrow tab scales under
  // vis-network's 5 px cutoff: no text at all. Keep those labels (and the lesson's own nodes)
  // LABEL_SCREEN_PX on screen at any zoom, outlined so they read over edges.
  // ponytail: of the lesson's nodes only the fix's get a label; starting points are many and already coloured.
  const lesson = JSON.stringify([...levels].filter(([, l]) => l === "changed").map(([id]) => id)).replace(/</g, "\\u003c");
  const labelScript = `<script>
(() => {
  if (typeof nodesDS === "undefined" || typeof network === "undefined") return;
  const lesson = new Set(${lesson});
  // A code name has no spaces; docstring nodes have sentences for labels and stay hover-only.
  const code = (n) => !/\\s/.test(String(n.label ?? "").trim());
  const fix = nodesDS.get().filter((n) => lesson.has(n.id) && code(n)).map((n) => n.id);
  // The rest by degree: ${LABEL_FIT_COUNT} when the graph is fitted, more as the user zooms in.
  const busiest = nodesDS.get().filter((n) => !lesson.has(n.id) && n.font && n.font.size > 0)
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0)).map((n) => n.id);
  let fitScale = 0;
  const size = () => {
    const s = Math.max(network.getScale(), 0.01);
    fitScale ||= s;
    const shown = new Set([...fix, ...busiest.slice(0, Math.round(${LABEL_FIT_COUNT} * Math.max(1, (s / fitScale) ** 2)))]);
    const font = { size: Math.max(${LABEL_SCREEN_PX} / s, 12), color: "#ffffff", strokeWidth: 3 / Math.min(s, 1), strokeColor: "#0f0f1a" };
    nodesDS.update([...fix, ...busiest].map((id) => ({ id, font: shown.has(id) ? font : { size: 0 } })));
  };
  network.once("stabilizationIterationsDone", () => { fitScale = 0; size(); });
  network.on("zoom", size);
  size();
})();
</script>
`;
  if (!html.includes("nodesDS")) return html.slice(0, end) + access + html.slice(end);
  if (levels.size === 0) return html.slice(0, end) + access + labelScript + html.slice(end);
  const data = JSON.stringify({ colors: MAP_COLORS, labels: MAP_LABELS, levels: Object.fromEntries(levels) }).replace(/</g, "\\u003c");
  const script = `${access}<script>
(() => {
  if (typeof nodesDS === "undefined") return; // vis-network didn't load: nothing to recolour
  const { colors, labels, levels } = ${data};
  const paint = (c) => ({ background: c, border: c, highlight: { background: "#ffffff", border: c } });
  nodesDS.update(nodesDS.getIds().map((id) => ({ id, color: paint(colors[levels[id]] ?? colors.unseen) })));
  const legend = document.createElement("div");
  legend.setAttribute("role", "note");
  legend.style.cssText = "position:fixed;left:12px;bottom:12px;padding:8px 10px;background:rgba(13,13,13,.85);color:#ddd;font:12px sans-serif;border-radius:6px;z-index:10";
  for (const [level, c] of Object.entries(colors)) {
    const item = document.createElement("span");
    item.style.cssText = "margin-right:12px;white-space:nowrap";
    const dot = document.createElement("span");
    dot.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:" + c;
    item.append(dot, labels[level]);
    legend.append(item);
  }
  document.body.append(legend);
})();
</script>
${labelScript}`;
  return html.slice(0, end) + script + html.slice(end);
}

// ── The lesson map for a pane beside the chat (hooks/register.tsx) ──────
// graphify's graph has thousands of nodes; a pane has room for a few dozen.
// So the pane shows graphify's communities (its clusters of related code),
// sized by how much code each holds, joined by how often they call each
// other, and coloured by the lesson like the panel's map.

const MAP_MAX_COMMUNITIES = 36;
const MAP_MAX_EDGES = 80;

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** A community's name: the file most of its code lives in, with its folder. */
const fileLabel = (file) => norm(file || "").split("/").filter(Boolean).slice(-2).join("/");

/** Fruchterman–Reingold on the unit square, seeded on a spiral so the same
 *  graph always draws the same way. Pure. */
function layout(n, edges) {
  const pos = Array.from({ length: n }, (_, i) => ({ x: 0.5 + 0.35 * Math.sqrt((i + 0.5) / n) * Math.cos(i * 2.39996), y: 0.5 + 0.35 * Math.sqrt((i + 0.5) / n) * Math.sin(i * 2.39996) }));
  if (n < 2) return pos.map(() => ({ x: 0.5, y: 0.5 }));
  const k = 1.6 * Math.sqrt(1 / n);
  for (let step = 0, t = 0.1; step < 300; step++, t *= 0.985) {
    const d = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, dist = Math.max(1e-4, Math.hypot(dx, dy)), f = (k * k) / dist;
      d[i].x += (dx / dist) * f; d[i].y += (dy / dist) * f; d[j].x -= (dx / dist) * f; d[j].y -= (dy / dist) * f;
    }
    for (const [a, b, w] of edges) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, dist = Math.max(1e-4, Math.hypot(dx, dy)), f = ((dist * dist) / k) * Math.min(3, Math.log1p(w)) / 8;
      d[a].x -= (dx / dist) * f; d[a].y -= (dy / dist) * f; d[b].x += (dx / dist) * f; d[b].y += (dy / dist) * f;
    }
    pos.forEach((p, i) => {
      const len = Math.max(1e-9, Math.hypot(d[i].x, d[i].y));
      p.x += (d[i].x / len) * Math.min(len, t); p.y += (d[i].y / len) * Math.min(len, t);
      // A weak pull to the middle keeps loose communities on the canvas.
      p.x += (0.5 - p.x) * 0.01; p.y += (0.5 - p.y) * 0.01;
    });
  }
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pos.map((p) => ({ x: 0.08 + 0.84 * ((p.x - x0) / Math.max(1e-9, x1 - x0)), y: 0.08 + 0.78 * ((p.y - y0) / Math.max(1e-9, y1 - y0)) }));
}

/** The pane's map of a lesson: graphify's communities, the lesson's colours
 *  (`levels` from overlayLevels), a layout and the SVG for surfaces that draw
 *  one. Pure. */
export function lessonMapData(graph, levels, title) {
  const groups = new Map();
  const nodeGroup = new Map();
  const files = { explored: new Set(), changed: new Set() };
  for (const node of graph.nodes) {
    const id = node.community ?? -1;
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { community: id, count: 0, folders: new Map(), touched: { explored: new Map(), changed: new Map() }, level: "unseen" }));
    g.count++;
    nodeGroup.set(node.id, id);
    const folder = fileLabel(node.source_file);
    if (folder) g.folders.set(folder, (g.folders.get(folder) ?? 0) + 1);
    const level = levels.get(node.id);
    if (level === "changed" || (level === "explored" && g.level === "unseen")) g.level = level;
    if (level && node.source_file) {
      files[level].add(norm(node.source_file));
      g.touched[level].set(folder, (g.touched[level].get(folder) ?? 0) + 1);
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count);
  // The biggest communities, and every one the lesson touches.
  const kept = ranked.filter((g, i) => i < MAP_MAX_COMMUNITIES || g.level !== "unseen");
  const index = new Map(kept.map((g, i) => [g.community, i]));
  const weights = new Map();
  for (const link of graph.links ?? []) {
    const a = index.get(nodeGroup.get(link.source)), b = index.get(nodeGroup.get(link.target));
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }
  const edges = [...weights].sort((x, y) => y[1] - x[1]).slice(0, MAP_MAX_EDGES).map(([key, w]) => [...key.split(",").map(Number), w]);
  const pos = layout(kept.length, edges);
  const biggest = kept[0]?.count ?? 1;
  const communities = kept.map((g, i) => ({
    // A coloured cluster is named for the file that coloured it, not its biggest one.
    label: [...(g.level === "unseen" ? g.folders : g.touched[g.level])].sort((x, y) => y[1] - x[1])[0]?.[0] || `group ${g.community}`,
    count: g.count,
    level: g.level,
    x: pos[i].x,
    y: pos[i].y,
    r: 4 + 14 * Math.sqrt(g.count / biggest),
  }));
  // The communities feed the terminal's cell map (hooks/register.tsx); the SVG
  // is graphify's own picture, node by node (nodeSvg).
  return { title, communities, edges, explored: [...files.explored].slice(0, 12), changed: [...files.changed].slice(0, 12), svg: nodeSvg(graph, levels) };
}

// graphify's viewer (graph.html, vis-network), drawn as a still SVG: every node a
// dot coloured by its community from graphify's palette, sized by its links
// (10 + 30 × degree / most), the busiest labelled, on graphify's dark ground.
// Once the lesson colours nodes, they are recoloured as on the site
// (withOverlay): the rest grey, the starting points blue, the fix yellow.
const GRAPHIFY_PALETTE = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"];
// ponytail: the busiest nodes only; an SVG element takes 131072 characters at most.
const SVG_MAX_NODES = 500;
const SVG_MAX_EDGES = 1400;
const NODE_W = 480;
const NODE_H = 450; // plus 30 for the legend
const LABEL_SCREEN_PX = 13; // graphify viewer labels, on screen at any zoom (withOverlay)
const LABEL_FIT_COUNT = 25; // viewer labels on a fitted graph; zooming in shows more
const LABEL_PX = 15; // in the map's own units: readable once a narrow pane scales it down
const SVG_MAX_CHARS = 125_000; // the Svg element's limit is 131072
const SVG_ANIMATED_NODES = 300;
const SVG_ANIMATED_EDGES = 800;

/** Fruchterman–Reingold for the nodes, started with each community around its own
 *  point on a ring, so communities settle into clusters as graphify's do. Pure. */
function nodeLayout(nodes, edges) {
  const n = nodes.length;
  const comms = [...new Set(nodes.map((x) => x.community ?? -1))];
  const ring = new Map(comms.map((c, i) => [c, { x: 0.5 + 0.3 * Math.cos((2 * Math.PI * i) / comms.length), y: 0.5 + 0.3 * Math.sin((2 * Math.PI * i) / comms.length) }]));
  const pos = nodes.map((x, i) => {
    const c = ring.get(x.community ?? -1);
    return { x: c.x + 0.06 * Math.cos(i * 2.39996) * Math.sqrt((i % 17) / 17), y: c.y + 0.06 * Math.sin(i * 2.39996) * Math.sqrt((i % 17) / 17) };
  });
  if (n < 2) return pos.map(() => ({ x: 0.5, y: 0.5, sx: 0.5, sy: 0.5 }));
  const seed = pos.map((p) => ({ ...p }));
  const k = 0.9 * Math.sqrt(1 / n);
  for (let step = 0, t = 0.06; step < 160; step++, t *= 0.975) {
    const d = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, dist = Math.max(1e-4, Math.hypot(dx, dy)), f = (k * k) / dist;
      d[i].x += (dx / dist) * f; d[i].y += (dy / dist) * f; d[j].x -= (dx / dist) * f; d[j].y -= (dy / dist) * f;
    }
    for (const [a, b] of edges) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, dist = Math.max(1e-4, Math.hypot(dx, dy)), f = (dist * dist) / k;
      d[a].x -= (dx / dist) * f; d[a].y -= (dy / dist) * f; d[b].x += (dx / dist) * f; d[b].y += (dy / dist) * f;
    }
    pos.forEach((p, i) => {
      const len = Math.max(1e-9, Math.hypot(d[i].x, d[i].y));
      p.x += (d[i].x / len) * Math.min(len, t); p.y += (d[i].y / len) * Math.min(len, t);
      p.x += (0.5 - p.x) * 0.02; p.y += (0.5 - p.y) * 0.02;
    });
  }
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fx = (x) => 0.04 + 0.92 * ((x - x0) / Math.max(1e-9, x1 - x0)), fy = (y) => 0.05 + 0.9 * ((y - y0) / Math.max(1e-9, y1 - y0));
  // sx, sy: where the node started, on the same canvas (the SVG animates it settling, as vis-network's physics does).
  return pos.map((p, i) => ({ x: fx(p.x), y: fy(p.y), sx: fx(seed[i].x), sy: fy(seed[i].y) }));
}

/** The SVG of graphify's map, recoloured by `levels` when it has any. Pure. */
export function nodeSvg(graph, levels, animate = true, maxNodes = SVG_MAX_NODES, maxEdges = SVG_MAX_EDGES) {
  const degree = new Map();
  for (const l of graph.links ?? []) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const deg = (x) => degree.get(x.id) ?? 0;
  // The busiest nodes, and every node the lesson colours.
  const kept = [...graph.nodes].sort((a, b) => Number(levels.has(b.id)) - Number(levels.has(a.id)) || deg(b) - deg(a)).slice(0, Math.max(maxNodes, levels.size));
  const index = new Map(kept.map((x, i) => [x.id, i]));
  const edges = (graph.links ?? []).map((l) => [index.get(l.source), index.get(l.target)]).filter(([a, b]) => a !== undefined && b !== undefined && a !== b).slice(0, maxEdges);
  const pos = nodeLayout(kept, edges);
  const most = Math.max(1, ...kept.map(deg));
  // Nearly square: a narrow side panel scales it by its width, so a wide canvas would shrink its text the most.
  const W = NODE_W, H = NODE_H;
  const at = (i) => `${Math.round(pos[i].x * W)},${Math.round(pos[i].y * H)}`;
  const coloured = levels.size > 0;
  const fill = (x) => (coloured ? MAP_COLORS[levels.get(x.id) ?? "unseen"] : GRAPHIFY_PALETTE[Math.abs(x.community ?? 0) % GRAPHIFY_PALETTE.length]);
  // vis-network's dot `size` is its radius in its own units; scaled to this canvas.
  const radius = (x) => (10 + (30 * deg(x)) / most) * 0.22;
  // Drawn last so the lesson's nodes sit on top.
  const order = kept.map((_, i) => i).sort((a, b) => Number(levels.has(kept[a].id)) - Number(levels.has(kept[b].id)));
  // Labels as graphify shows them (its busiest nodes), the lesson's first, at most
  // 24 and none over another (boxes estimated at 5 px a character).
  const labelled = new Set();
  const boxes = [];
  const byWeight = kept.map((_, i) => i).filter((i) => levels.has(kept[i].id) || deg(kept[i]) / most >= 0.15)
    .sort((a, b) => Number(levels.has(kept[b].id)) - Number(levels.has(kept[a].id)) || deg(kept[b]) - deg(kept[a]));
  for (const i of byWeight) {
    if (labelled.size >= 24) break;
    const text = String(kept[i].label).slice(0, 24), w = text.length * LABEL_PX * 0.56, x = pos[i].x * W, y = pos[i].y * H - radius(kept[i]) - 2;
    const box = { x0: x - w / 2, x1: x + w / 2, y0: y - LABEL_PX, y1: y + 2 };
    if (boxes.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) continue;
    boxes.push(box);
    labelled.add(i);
  }
  const legend = coloured
    ? Object.entries(MAP_LABELS).map(([level, text], i) => `<circle cx="${[12, 138, 316][i]}" cy="${H + 15}" r="6" fill="${MAP_COLORS[level]}"/><text x="${[22, 148, 326][i]}" y="${H + 20}" font-size="14" fill="#e0e0e0">${xml(text)}</text>`)
    : [`<text x="12" y="${H + 20}" font-size="14" fill="#e0e0e0">Colours: graphify's communities. Bigger dots have more links.</text>`];
  // Motion as the web demo's map has it, with no script (a pane draws SVG as an image or a
  // script-less frame): the dots settle from their communities into place, then the links
  // and names fade in, and the lesson's nodes pulse a few times. Each animation's static
  // attributes are the finished picture, so a surface that doesn't animate draws that.
  const SETTLE = "1.6s";
  const fadeIn = animate ? `<animate attributeName="opacity" values="0;0;1" keyTimes="0;0.7;1" dur="2.2s" fill="freeze"/>` : "";
  const settle = (i) => {
    if (!animate) return "";
    const dx = Math.round((pos[i].sx - pos[i].x) * W), dy = Math.round((pos[i].sy - pos[i].y) * H);
    return dx || dy ? `<animateTransform attributeName="transform" type="translate" from="${dx} ${dy}" to="0 0" dur="${SETTLE}" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.2 1"/>` : "";
  };
  const pulse = (i) => {
    if (!animate || !levels.has(kept[i].id)) return "";
    const r = radius(kept[i]);
    return `<circle cx="${Math.round(pos[i].x * W)}" cy="${Math.round(pos[i].y * H)}" r="${r.toFixed(1)}" fill="none" stroke="${fill(kept[i])}" stroke-width="1.5" stroke-opacity="0"><animate attributeName="r" values="${r.toFixed(1)};${(r + 9).toFixed(1)}" dur="1.4s" begin="${SETTLE}" repeatCount="3"/><animate attributeName="stroke-opacity" values="0.9;0" dur="1.4s" begin="${SETTLE}" repeatCount="3"/></circle>`;
  };
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 30}" width="${W}" height="${H + 30}" font-family="sans-serif">`,
    // Where the surface lets the pointer reach the map (the desktop app), a dot lights up under it and names itself.
    "<style>circle:hover{stroke:#ffffff;stroke-width:2.5}</style>",
    `<rect width="${W}" height="${H + 30}" fill="#0f0f1a"/>`,
    `<g stroke="#848484" stroke-opacity="0.45" stroke-width="0.7">${fadeIn}`,
    ...edges.map(([a, b]) => `<path d="M${at(a)}L${at(b)}"/>`),
    "</g>",
    ...order.map((i) => `<circle cx="${Math.round(pos[i].x * W)}" cy="${Math.round(pos[i].y * H)}" r="${radius(kept[i]).toFixed(1)}" fill="${fill(kept[i])}"${levels.has(kept[i].id) ? ' stroke="#ffffff" stroke-width="1.2"' : ""}><title>${xml(kept[i].label)}</title>${settle(i)}</circle>`),
    ...order.map(pulse),
    `<g>${fadeIn}`,
    ...[...labelled].map((i) => `<text x="${Math.round(pos[i].x * W)}" y="${Math.round(pos[i].y * H - radius(kept[i]) - 2)}" font-size="${LABEL_PX}" text-anchor="middle" fill="#ffffff" stroke="#0f0f1a" stroke-width="3" paint-order="stroke">${xml(String(kept[i].label).slice(0, 24))}</text>`),
    "</g>",
    ...legend,
    "</svg>",
  ].join("");
  // The motion costs characters: a map too big for the pane's limit with it moves with its
  // busiest 300 nodes instead, and one too big even then is drawn still with all 500.
  if (svg.length <= SVG_MAX_CHARS || !animate) return svg;
  if (maxNodes > SVG_ANIMATED_NODES) return nodeSvg(graph, levels, true, SVG_ANIMATED_NODES, SVG_ANIMATED_EDGES);
  return nodeSvg(graph, levels, false);
}
