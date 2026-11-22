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

// Data files: a JSON/TOML/YAML file's keys aren't code (the file map's DATA_FILE says the same).
const DATA_EXT = /\.(?:json|jsonc|toml|ya?ml|lock|cfg|ini|txt|csv)$/i;

export function overlayLevels(graph, picks, keyDiff) {
  const levels = new Map();
  for (const pick of picks.map(norm).filter(Boolean)) {
    // As lib/lesson/steps/s7.ts pickNodes: a path or a real file extension is a file;
    // "Serializer.loads" is a method, matched by graphify's qualified id (…_serializer_loads).
    const isFile = pick.includes("/") || CODE_EXT.test(pick);
    // Serializer.loads or (Rust, C++…) Error::fix_position, as lib/lesson/steps/s7.ts pickNodes reads them.
    const parts = /\.|::/.test(pick) && !isFile ? pick.replace(/\(\)$/, "").split(/\.|::/).filter(Boolean) : null;
    const suffix = parts ? `_${parts.join("_")}` : null;
    const clean = (s) => s.replace(/[^a-z0-9_]/g, "");
    // A Rust impl's generics sit between type and method (…_unitvariantaccess_a_r_tuple_variant).
    const generic = parts ? new RegExp(`_${parts.slice(0, -1).map(clean).join("_")}(?:_[a-z0-9]+){1,3}_${clean(parts.at(-1))}$`) : null;
    const exact = suffix ? graph.nodes.some((n) => n.id.toLowerCase().endsWith(suffix)) : false;
    const sameFile = (file) => file === pick || file.endsWith(`/${pick}`);
    // A folder names its files when it's specific (≤ 25 files, as s7 FOLDER_PICK_MAX_FILES):
    // date-fns keeps each function in a folder of its own.
    const folder = pick.replace(/\/+$/, "");
    const inFolder = (file) => file.startsWith(`${folder}/`) || file.includes(`/${folder}/`);
    const fileHit = isFile && !graph.nodes.some((n) => sameFile(norm(n.source_file || "")))
      ? (() => { const fs = new Set(graph.nodes.map((n) => norm(n.source_file || "")).filter((f) => f && inFolder(f))); return fs.size <= 25 ? fs : new Set(); })()
      : null;
    for (const n of graph.nodes) {
      const file = norm(n.source_file || "");
      const label = norm(n.label).replace(/^\./, "");
      const id = n.id.toLowerCase();
      // A name matches code, not a data file's keys (package.json's "./formatDistance" export).
      const hit = isFile ? file && (fileHit ? fileHit.has(file) : sameFile(file)) : suffix ? (exact ? id.endsWith(suffix) : generic.test(id)) : label === pick && !DATA_EXT.test(file);
      if (hit) levels.set(n.id, "explored");
    }
  }
  if (keyDiff) {
    const files = [...keyDiff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((m) => norm(m[1]));
    const symbols = new Set([...keyDiff.matchAll(/^[+-]\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/gm)].map((m) => m[1].toLowerCase()));
    for (const n of graph.nodes) {
      const file = norm(n.source_file || "");
      // A node with a file is changed when its file is; a name the diff defines marks only nodes
      // without one (a new test's local `def cli()` isn't every `cli()` in the project).
      if (file ? files.some((f) => file.includes(f) || f.includes(file)) : symbols.has(norm(n.label).replace(/^\./, "").replace(/\(\)$/, ""))) levels.set(n.id, "changed");
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
  if (!html.includes("nodesDS")) return html.slice(0, end) + access + html.slice(end);
  const lit = JSON.stringify(Object.fromEntries(levels)).replace(/</g, "\\u003c");
  // graphify's look, decluttered: no docstring nodes; the lesson's code bright in its community
  // colours and the rest faded hard (after the reveal the fix brightest, the starting points dimmer);
  // labels LABEL_SCREEN_PX on screen, placed only where they don't overlap, the lesson's first.
  const script = `${access}<script>
(() => {
  if (typeof nodesDS === "undefined" || typeof network === "undefined") return; // vis-network didn't load
  const levels = ${lit};
  const lit = Object.keys(levels).length > 0;
  const revealed = Object.values(levels).includes("changed");
  nodesDS.remove(nodesDS.get().filter((n) => n.file_type === "rationale").map((n) => n.id));
  // How bright each node is: 1 as graphify draws it, less for what the lesson leaves aside.
  const alpha = (id) => !lit ? 1 : levels[id] === "changed" ? 1 : levels[id] === "explored" ? (revealed ? ${FADE_EXPLORED} : 1) : ${FADE_UNSEEN};
  const rgba = (c, a) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(c ?? ""));
    const n = m ? parseInt(m[1], 16) : 0x78788c;
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  };
  if (lit) {
    nodesDS.update(nodesDS.get().map((n) => {
      const own = (n.color && n.color.background) || n.color;
      const c = rgba(own, alpha(n.id));
      return { id: n.id, color: { background: c, border: c, highlight: { background: own, border: "#ffffff" }, hover: { background: own, border: own } } };
    }));
    edgesDS.update(edgesDS.get().map((e) => ({ id: e.id, color: { ...(typeof e.color === "object" ? e.color : {}), opacity: Math.min(alpha(e.from), alpha(e.to)) * 0.7 } })));
  }
  // Labels: code names only, the lesson's first, then the busiest; each placed only where it
  // doesn't overlap one already placed. Recomputed whenever the view moves.
  const cut = (t) => (t.length > 26 ? t.slice(0, 25) + "\\u2026" : t);
  const rank = (n) => alpha(n.id) * 1e6 + (levels[n.id] === "changed" ? 5e5 : 0) + (n.degree ?? 0) * 100 + (n.size ?? 0);
  const nodes = nodesDS.get().filter((n) => n.label && !/\\s/.test(String(n.label).trim()) && (!lit || alpha(n.id) >= ${FADE_EXPLORED}))
    .sort((a, b) => rank(b) - rank(a)).map((n) => ({ id: n.id, text: cut(String(n.label)), size: n.size ?? 10 }));
  const others = nodesDS.get().filter((n) => !nodes.some((x) => x.id === n.id)).map((n) => n.id);
  const container = document.getElementById("graph") ?? document.body;
  let queued = false;
  const place = () => {
    queued = false;
    const s = Math.max(network.getScale(), 0.01);
    const W = container.clientWidth, H = container.clientHeight;
    const pos = network.getPositions(nodes.map((n) => n.id));
    const boxes = [];
    const shown = new Set();
    for (const n of nodes) {
      if (!pos[n.id]) continue;
      const d = network.canvasToDOM(pos[n.id]);
      const w = n.text.length * 7.4 + 8, h = 18;
      const b = { x: d.x - w / 2, y: d.y + n.size * s + 1, w, h }; // vis-network draws the label under the dot
      if (b.x + w < 0 || b.y < 0 || b.x > W || b.y > H) continue;
      if (boxes.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h)) continue;
      boxes.push(b); shown.add(n.id);
    }
    const font = { size: ${LABEL_SCREEN_PX} / s, color: "#ffffff", strokeWidth: 3 / s, strokeColor: "#0f0f1a" };
    nodesDS.update([...nodes.map((n) => ({ id: n.id, label: n.text, font: shown.has(n.id) ? font : { size: 0 } })), ...others.map((id) => ({ id, font: { size: 0 } }))]);
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
  for (const event of ["stabilizationIterationsDone", "zoom", "dragEnd", "animationFinished", "resize"]) network.on(event, later);
  place();
  if (!lit) return;
  const legend = document.createElement("div");
  legend.setAttribute("role", "note");
  legend.style.cssText = "position:fixed;left:12px;bottom:12px;padding:8px 10px;background:rgba(13,13,13,.85);color:#ddd;font:12px sans-serif;border-radius:6px;z-index:10";
  const items = revealed
    ? [[1, "changed by the fix"], [${FADE_EXPLORED}, "your starting points"], [${FADE_UNSEEN}, "not looked at"]]
    : [[1, "your starting points"], [${FADE_UNSEEN}, "not looked at"]];
  for (const [a, text] of items) {
    const item = document.createElement("span");
    item.style.cssText = "margin-right:12px;white-space:nowrap";
    const dot = document.createElement("span");
    dot.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:" + rgba("#76B7B2", a);
    item.append(dot, text);
    legend.append(item);
  }
  document.body.append(legend);
})();
</script>
`;
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
const FADE_UNSEEN = 0.12; // viewer: what the lesson hasn't touched
const FADE_EXPLORED = 0.45; // viewer, after the reveal: starting points the fix doesn't change
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

// ── The file map: the lesson's code as tidy file cards (the VS Code map tab) ──────────

const FILE_MAP_ROWS = 10; // symbols shown per card before "more"; the lesson's are always shown
// A big project (django: 2,000 files) can't be a card and a bubble per file: the page keeps the
// lesson's files and then the most connected ones, up to these.
const FILE_MAP_CARDS = 80;
const FILE_MAP_BUBBLES = 36;

/** The old line numbers a diff changes, by file: a removed line where it was, an added one at the
 *  line it follows (a fix that only adds a guard still changes the function it's in). The functions
 *  around them are what the fix changes (as lib/graph-impact.ts changedOldLines reads a diff). */
function changedLines(diff) {
  const out = new Map();
  let file = null, old = 0;
  // Added lines wait for the end of their run: a run of only additions that defines a function
  // or type is a new one (a test appended after the last), not a change to the one above it.
  let run = [], pure = true, defines = false;
  // A change followed only by closing brackets and decorators, then a definition, is in that
  // definition's decorator (new @pytest.mark.parametrize cases), not the function above it.
  let group = -1; // where the latest change starts in out's list for `file`, while it may be one
  const flush = () => {
    if (file && run.length && !(pure && defines)) out.set(file, [...(out.get(file) ?? []), ...run]);
    run = []; pure = true; defines = false;
  };
  const open = () => { if (group < 0) group = out.get(file)?.length ?? 0; };
  const lines = String(diff ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    // A file's header is "--- a/…" right before "+++ b/…"; an added line can start "+++" too.
    if (text.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) { flush(); group = -1; file = /^\+\+\+ (?:b\/)?(\S+)/.exec(lines[++i])?.[1] ?? null; continue; }
    const h = /^@@ -(\d+)/.exec(text);
    if (h) { flush(); group = -1; old = Number(h[1]); continue; }
    if (!file || text.startsWith("diff --git")) { flush(); group = -1; continue; }
    if (text.startsWith("-")) { open(); out.set(file, [...(out.get(file) ?? []), old]); old++; pure = false; }
    else if (text.startsWith("+")) { open(); run.push(Math.max(old - 1, 1)); defines ||= DEFINES.test(text.slice(1)); }
    else {
      flush();
      if (group >= 0 && DEFINES.test(text.slice(1))) { const list = out.get(file) ?? []; for (let k = group; k < list.length; k++) list[k] = old; }
      if (group >= 0 && !CLOSES_OR_DECORATES.test(text.slice(1))) group = -1;
      old++;
    }
  }
  flush();
  return out;
}

/** A line that only closes brackets, or a decorator / attribute line (as lib/graph-impact.ts). */
const CLOSES_OR_DECORATES = /^\s*(?:[)\]}]+[,;]?\s*$|@|#\[)/;

/** A line that starts a function or type (as lib/graph-impact.ts DEFINES). */
const DEFINES = /^\s*(?:(?:pub(?:\([^)]*\))?|async|export|default|static|unsafe|const|extern(?:\s+"[^"]*")?|public|private|protected)\s+)*(?:def|fn|function|func|class|struct|enum|trait|impl|interface)\b/;

// The file map's moving part: a bubble per file, settling under a small force layout (no
// library), lines between files that use each other, the lesson's flowing. Hover lights a
// file's neighbours, a click glides to its card, bubbles can be dragged. Runs in the page.
const FILE_MAP_SCRIPT = String.raw`
(() => {
  const D = JSON.parse(document.getElementById("osr-data").textContent);
  const svg = document.getElementById("osr-graph");
  const NS = "http://www.w3.org/2000/svg";
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const W = () => svg.clientWidth || 480, H = () => svg.clientHeight || 320;
  const byId = new Map(D.nodes.map((n, i) => {
    const a = (i / D.nodes.length) * Math.PI * 2;
    return [n.id, Object.assign(n, { x: W() / 2 + Math.cos(a) * 12, y: H() / 2 + Math.sin(a) * 12, vx: 0, vy: 0 })];
  }));
  const links = D.links.filter((l) => byId.has(l.s) && byId.has(l.t)).map((l) => ({ ...l, a: byId.get(l.s), b: byId.get(l.t) }));
  const gLinks = el("g", {}, svg), gNodes = el("g", {}, svg);
  for (const l of links) {
    const hot = l.a.level !== "unseen" && l.b.level !== "unseen" && l.a.level !== "none";
    const kind = l.a.level === "changed" || l.b.level === "changed" ? "fix" : "start";
    l.path = el("path", { class: "link" + (hot ? " flow " + kind : ""), "stroke-width": Math.min(4, 1 + Math.log2(l.w)) }, gLinks);
  }
  for (const n of D.nodes) {
    n.g = el("g", { class: "node " + n.level, tabindex: "0", role: "button", "aria-label": n.label }, gNodes);
    n.g.style.setProperty("--c", n.color);
    if (n.level === "changed" || n.level === "explored") el("circle", { class: "pulse", r: n.r }, n.g);
    el("circle", { class: "dot", r: n.r }, n.g);
    n.t = el("text", { class: "name", y: n.r + 14 }, n.g);
    n.t.textContent = n.label;
    n.lw = n.t.getComputedTextLength() || n.label.length * 7;
  }
  const near = new Map(D.nodes.map((n) => [n.id, new Set([n.id])]));
  for (const l of links) { near.get(l.s).add(l.t); near.get(l.t).add(l.s); }
  let alpha = 1, dragging = null;
  const tick = () => {
    const w = W(), h = H(), ns = D.nodes;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      // Each file is a box (its bubble and the name under it): boxes that overlap step apart
      // along the shorter way out, so names don't print over each other.
      const ox = Math.max(a.r, a.lw / 2) + Math.max(b.r, b.lw / 2) + 8 - Math.abs(dx);
      const oy = a.r + b.r + 22 - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        const k = 0.25 * (alpha + 0.05);
        if (ox < oy) { const s = (Math.sign(dx) || 1) * ox * k; a.vx -= s; b.vx += s; }
        else { const s = (Math.sign(dy) || 1) * oy * k; a.vy -= s; b.vy += s; }
      }
      const room = a.r + b.r + 46;
      const f = (1800 / (d * d) + (d < room ? (room - d) * 0.25 : 0)) * alpha;
      dx /= d; dy /= d; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 120) * 0.012 * alpha;
      l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f; l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f;
    }
    for (const n of ns) {
      const pull = n.level === "changed" ? 0.03 : n.level === "explored" ? 0.02 : 0.008;
      n.vx += (w / 2 - n.x) * pull * alpha; n.vy += (h / 2 - n.y) * pull * alpha;
      if (n === dragging) { n.vx = n.vy = 0; continue; }
      n.x += n.vx *= 0.6; n.y += n.vy *= 0.6;
      const hw = Math.max(n.r, n.lw / 2) + 4; n.x = Math.max(hw, Math.min(w - hw, n.x)); n.y = Math.max(n.r + 4, Math.min(h - n.r - 20, n.y));
    }
  };
  const draw = () => {
    for (const l of links) {
      const mx = (l.a.x + l.b.x) / 2 + (l.b.y - l.a.y) * 0.12, my = (l.a.y + l.b.y) / 2 - (l.b.x - l.a.x) * 0.12;
      l.path.setAttribute("d", "M" + l.a.x + "," + l.a.y + "Q" + mx + "," + my + " " + l.b.x + "," + l.b.y);
    }
    for (const n of D.nodes) n.g.setAttribute("transform", "translate(" + n.x + "," + n.y + ")");
  };
  // Once still, a name that would still touch one placed before it (the lesson's files first,
  // then the biggest) is hidden; hovering its file or a neighbour shows it.
  const declutter = () => {
    const placed = [];
    const rank = (n) => (n.level === "changed" ? 0 : n.level === "explored" ? 1 : 2);
    const over = (r, p, pad) => r.left < p.right + pad && r.right > p.left - pad && r.top < p.bottom && r.bottom > p.top;
    // Another file's bubble covers a name as surely as another name does.
    const dots = D.nodes.map((m) => [m, m.g.querySelector(".dot").getBoundingClientRect()]);
    for (const n of [...D.nodes].sort((a, b) => rank(a) - rank(b) || b.r - a.r)) {
      const r = n.t.getBoundingClientRect();
      // The lesson's files keep their names whatever they touch; the rest give way.
      const hit = rank(n) < 2 ? false : placed.some((p) => over(r, p, 4)) || dots.some(([m, d]) => m !== n && over(r, d, 0));
      n.g.classList.toggle("quiet", hit);
      if (!hit) placed.push(r);
    }
  };
  let frames = 0;
  const frame = () => { tick(); draw(); alpha *= 0.975; if (++frames % 20 === 0) declutter(); if (alpha > 0.02 || dragging) requestAnimationFrame(frame); else { running = false; declutter(); } };
  let running = false;
  const wake = (a) => { alpha = Math.max(alpha, a); if (!running) { running = true; requestAnimationFrame(frame); } };
  if (still) { for (let i = 0; i < 300; i++) { tick(); alpha *= 0.975; } draw(); declutter(); } else wake(1);
  // Hover: the file and its neighbours stay lit, the rest steps back.
  const focus = (n) => {
    svg.classList.toggle("focus", Boolean(n));
    for (const m of D.nodes) m.g.classList.toggle("on", Boolean(n) && near.get(n.id).has(m.id));
    for (const l of links) l.path.classList.toggle("on", Boolean(n) && (l.a === n || l.b === n));
  };
  for (const n of D.nodes) {
    n.g.addEventListener("pointerenter", () => focus(n));
    n.g.addEventListener("pointerleave", () => focus(null));
    n.g.addEventListener("focus", () => focus(n));
    n.g.addEventListener("blur", () => focus(null));
    const go = () => {
      const card = document.getElementById(n.id);
      if (!card) return;
      card.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    };
    let moved = false;
    n.g.addEventListener("pointerdown", (e) => { dragging = n; moved = false; n.g.setPointerCapture(e.pointerId); wake(0.3); });
    n.g.addEventListener("pointermove", (e) => {
      if (dragging !== n) return;
      const r = svg.getBoundingClientRect();
      n.x = e.clientX - r.left; n.y = e.clientY - r.top; moved = true; wake(0.3);
    });
    n.g.addEventListener("pointerup", () => { dragging = null; if (!moved) go(); });
    n.g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  addEventListener("resize", () => wake(0.4));
})();
`;

/**
 * The code map as a page of file cards: each code file a card listing its classes and
 * functions in source order (methods under their class), the files it uses and is used by
 * as links to their cards, the lesson's files first and highlighted (blue: the user's
 * starting points; yellow: what the fix changes, the changed functions starred).
 * No scripts and no network; colours from VS Code's theme where it gives them. Pure.
 */
export function fileMapHtml(graph, levels, diff, title) {
  const changed = changedLines(diff);
  const nodes = graph.nodes.filter((n) => n.file_type === "code" && n.source_file);
  const path = (n) => n.source_file.replace(/\\/g, "/");
  const byFile = new Map();
  for (const n of nodes) byFile.set(path(n), [...(byFile.get(path(n)) ?? []), n]);
  const fileOf = new Map(nodes.map((n) => [n.id, path(n)]));
  // File to file: how many calls, imports and uses cross between them.
  const uses = new Map();
  for (const l of graph.links ?? []) {
    const a = fileOf.get(l.source), b = fileOf.get(l.target);
    if (!a || !b || a === b) continue;
    const m = uses.get(a) ?? new Map();
    m.set(b, (m.get(b) ?? 0) + 1);
    uses.set(a, m);
  }
  const usedBy = new Map();
  for (const [a, m] of uses) for (const b of m.keys()) usedBy.set(b, [...(usedBy.get(b) ?? []), a]);
  const line = (n) => Number(/\d+/.exec(n.source_location ?? "")?.[0] ?? 1e9);
  const level = (f) => {
    const ls = byFile.get(f).map((n) => levels.get(n.id));
    return ls.includes("changed") ? "changed" : ls.includes("explored") ? "explored" : "unseen";
  };
  const rank = { changed: 0, explored: 1, unseen: 2 };
  // tests/, testing/ (pluggy), spec/, __tests__/, test_x.py, x.test.ts: after the code they test.
  const isTest = (f) => Number(/(^|\/)(tests?|testing|spec|__tests__)\/|(^|\/)test_[^/]+$|[._-](test|spec)\.\w+$/i.test(f));
  const DATA_FILE = /\.(?:json|jsonc|toml|ya?ml|lock|cfg|ini|txt|csv)$/i;
  const files = [...byFile.keys()]
    // The file's own node (label "serializer.py") is the card itself.
    .map((f) => ({ f, symbols: byFile.get(f).filter((n) => !/\.\w+$/.test(n.label)).sort((a, b) => line(a) - line(b)) }))
    // A data file (package.json's keys, pyproject.toml's tables) isn't code to read; a file the
    // lesson touches always gets its card, even with nothing mapped in it (a test of describe blocks).
    .filter((x) => (x.symbols.length && !DATA_FILE.test(x.f)) || level(x.f) !== "unseen")
    .sort((a, b) => rank[level(a.f)] - rank[level(b.f)] || isTest(a.f) - isTest(b.f) || b.symbols.length - a.symbols.length);
  // How connected each file is: the calls, imports and uses crossing to or from it.
  const weight = new Map();
  for (const [a, m] of uses) for (const [b, w] of m) { weight.set(a, (weight.get(a) ?? 0) + w); weight.set(b, (weight.get(b) ?? 0) + w); }
  /** The lesson's files, then the most connected, up to `max`; in `list`'s own order. */
  const keep = (list, max) => {
    const pick = new Set([...list].sort((a, b) => rank[level(a.f)] - rank[level(b.f)] || (weight.get(b.f) ?? 0) - (weight.get(a.f) ?? 0)).slice(0, max).map((x) => x.f));
    return list.filter((x) => pick.has(x.f) || level(x.f) !== "unseen");
  };
  const cards = keep(files, FILE_MAP_CARDS);
  const carded = new Set(cards.map((x) => x.f));
  const lit = levels.size > 0;
  const anchor = (f) => "f-" + f.replace(/[^\w]/g, "-");
  const base = (f) => f.split("/").pop();
  // A file's short name: as many trailing folders as it takes to tell namesakes apart
  // (addDays/index.ts beside format/index.ts; src/lexical/math.rs beside tests/lexical/math.rs).
  const namesakes = new Map();
  for (const f of byFile.keys()) namesakes.set(base(f), [...(namesakes.get(base(f)) ?? []), f]);
  const shortName = (f) => {
    const same = namesakes.get(base(f)) ?? [f];
    if (same.length < 2) return base(f);
    const tail = (g, k) => g.split("/").slice(-k).join("/");
    for (let k = 2; k < f.split("/").length; k++) if (same.filter((g) => tail(g, k) === tail(f, k)).length === 1) return tail(f, k);
    return f;
  };
  const link = (g) => (carded.has(g) ? `<a href="#${anchor(g)}" title="${xml(g)}">${xml(shortName(g))}</a>` : `<span title="${xml(g)}">${xml(shortName(g))}</span>`);
  const accentOf = (symbols) => {
    const counts = new Map();
    for (const n of symbols) counts.set(n.community, (counts.get(n.community) ?? 0) + 1);
    return GRAPHIFY_PALETTE[([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0) % GRAPHIFY_PALETTE.length];
  };
  // A long path breaks at its slashes, not inside a name ("dependencies.t s").
  const heading = (f, tag) => {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
    return `<h2><span class="dir">${xml(dir).replaceAll("/", "/<wbr>")}</span>${xml(base(f))}${tag}</h2>`;
  };
  const card = ({ f, symbols }, i) => {
    const lv = level(f);
    // A file the user named as a whole marks all its nodes; a named function marks just that row.
    const whole = symbols.every((n) => levels.get(n.id) === "explored");
    const classes = symbols.filter((n) => !n.label.startsWith(".") && !n.label.endsWith(")")).map((n) => n.id);
    // The function each removed line sits in (the last one starting at or before it).
    const fns = symbols.filter((n) => n.label.endsWith(")"));
    const fixed = new Set((changed.get(f) ?? []).map((at) => fns.filter((n) => line(n) <= at).at(-1)?.id).filter(Boolean));
    const rows = symbols.map((n) => {
      const method = n.label.startsWith(".") && classes.some((c) => n.id.startsWith(c + "_"));
      const name = n.label.replace(/^\./, "");
      const fix = fixed.has(n.id);
      const start = !whole && levels.get(n.id) === "explored";
      const kind = n.label.endsWith(")") ? "fn" : "cls";
      const cls = [kind, method && "in", fix && "fix", start && "start"].filter(Boolean).join(" ");
      return { html: `<li class="${cls}" title="${xml(name)}">${fix ? '<span class="star" title="the fix changes this">★</span>' : ""}${xml(name)}</li>`, keep: fix || start };
    });
    const shown = rows.filter((r, i) => i < FILE_MAP_ROWS || r.keep);
    const rest = rows.filter((r, i) => !(i < FILE_MAP_ROWS || r.keep));
    const out = [...(uses.get(f) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => link(g));
    const inn = (usedBy.get(f) ?? []).slice(0, 4).map(link);
    const tag = lv === "changed" ? '<span class="tag fixtag">fix</span>' : lv === "explored" ? '<span class="tag starttag">start</span>' : "";
    return `<section id="${anchor(f)}" class="card${lit ? " " + lv : ""}" style="--accent:${accentOf(symbols)};--i:${i}">
${heading(f, tag)}
${rows.length ? `<ul>${shown.map((r) => r.html).join("")}</ul>` : '<p class="rel">No functions or classes mapped in this file.</p>'}${rest.length ? `<details><summary>${rest.length} more</summary><ul>${rest.map((r) => r.html).join("")}</ul></details>` : ""}
${out.length || inn.length ? `<p class="rel">${out.length ? `uses ${out.join(" ")}` : ""}${out.length && inn.length ? "<br>" : ""}${inn.length ? `used by ${inn.join(" ")}` : ""}</p>` : ""}
</section>`;
  };
  // A file the fix adds (often its test) isn't in a map drawn before it: a card of its own, after the fix's.
  const added = [...new Set([...String(diff ?? "").matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((m) => m[1]))].filter((f) => !byFile.has(f) && f !== "/dev/null");
  const addedCard = (f, i) => `<section id="${anchor(f)}" class="card changed" style="--accent:var(--fix);--i:${i}">
${heading(f, '<span class="tag fixtag">fix</span>')}
<p class="rel">A new file the fix adds: the map was drawn before it existed.</p>
</section>`;
  const html = cards.map(card);
  html.splice(cards.filter((x) => level(x.f) === "changed").length, 0, ...added.map((f, i) => addedCard(f, cards.length + i)));
  const legend = lit
    ? `<p class="legend"><span class="key starttag">start</span> your starting points <span class="key fixtag">fix</span> what the fix changes <span class="star">★</span> a changed function</p>`
    : `<p class="legend">Each bubble is a file, linked to the files it uses; each card lists a file's classes and functions. Your starting points and the fix light up as the lesson goes on. Drag a bubble, or click it to jump to its card.</p>`;
  // The bubbles' data: a file each (sized by how much is in it), and the files it uses.
  // A file linked to nothing (a config, a lone script) only floats about: it keeps its card, not a bubble.
  const linked = new Set([...uses].flatMap(([a, m]) => [a, ...m.keys()]));
  const bubbles = keep(cards.filter(({ f }) => linked.has(f) || (lit && level(f) !== "unseen")), FILE_MAP_BUBBLES);
  const shown = new Set(bubbles.map((x) => x.f));
  // Two bubbles named termui.py (src/click/, examples/termui/) say which folder each is in.
  const data = {
    nodes: bubbles.map(({ f, symbols }) => ({ id: anchor(f), label: shortName(f), r: Math.min(22, Math.round(7 + 2.4 * Math.sqrt(symbols.length))), color: accentOf(symbols), level: lit ? level(f) : "none" })),
    links: [...uses].flatMap(([a, m]) => [...m].filter(([b]) => shown.has(a) && shown.has(b)).map(([b, w]) => ({ s: anchor(a), t: anchor(b), w }))),
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${xml(title)}</title>
<style>
:root { --bg: var(--vscode-editor-background, #1e1e1e); --fg: var(--vscode-foreground, #cccccc); --muted: var(--vscode-descriptionForeground, #9d9d9d); --card: var(--vscode-sideBar-background, #252526); --line: var(--vscode-panel-border, #3c3c3c); --start: #4E79A7; --fix: #EDC948; }
body { margin: 0; padding: 14px 16px 24px; background: var(--bg); color: var(--fg); font: 13px var(--vscode-font-family, system-ui, sans-serif); }
h1 { font-size: 15px; margin: 0 0 4px; }
.legend { margin: 0 0 14px; color: var(--muted); } .legend.more { margin: 14px 0 0; }
.key, .tag { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; margin: 0 2px 0 8px; color: #111; }
.starttag { background: var(--start); color: #fff; } .fixtag { background: var(--fix); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; align-items: start; }
.card { background: var(--card); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 8px; padding: 10px 12px; min-width: 0; }
.card.unseen { opacity: .5; } .card.unseen:hover, .card:target { opacity: 1; }
.card.explored { border-color: var(--start); border-top-color: var(--start); }
.card.changed { border-color: var(--fix); border-top-color: var(--fix); box-shadow: 0 0 0 1px var(--fix); }
.card:target { outline: 2px solid var(--fg); }
h2 { font-size: 13px; margin: 0 0 6px; font-weight: 600; overflow-wrap: break-word; }
.dir { color: var(--muted); font-weight: 400; }
ul { list-style: none; margin: 0; padding: 0; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 12px; line-height: 1.6; }
li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
li.cls { font-weight: 600; } li.cls::before { content: "\\25C6  "; color: var(--accent); }
li.fn::before { content: "\\0192  "; color: var(--muted); } li.in { padding-left: 14px; }
li.start { color: #fff; background: var(--start); border-radius: 3px; } li.start::before { color: #fff; }
li.fix { color: #111; background: var(--fix); border-radius: 3px; } li.fix::before { color: #111; }
.star { margin-right: 4px; color: var(--fix); } li.fix .star { color: #111; }
details summary { cursor: pointer; color: var(--muted); font-size: 12px; margin-top: 2px; }
.rel { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.rel a { color: var(--vscode-textLink-foreground, #3794ff); margin-right: 6px; text-decoration: none; }
#osr-graph { display: block; width: 100%; height: 340px; margin: 0 0 16px; border: 1px solid var(--line); border-radius: 10px; touch-action: none;
  background: radial-gradient(ellipse at 50% 45%, color-mix(in srgb, var(--fg) 7%, transparent), transparent 70%), var(--card); }
.link { fill: none; stroke: var(--muted); stroke-opacity: .28; transition: stroke-opacity .2s; }
.link.flow { stroke-opacity: .9; stroke-dasharray: 5 7; animation: flow 1.1s linear infinite; }
.link.flow.start { stroke: var(--start); } .link.flow.fix { stroke: var(--fix); }
@keyframes flow { to { stroke-dashoffset: -24; } }
.node { cursor: pointer; transition: opacity .25s; outline: none; }
.node .dot { fill: var(--c); stroke: color-mix(in srgb, var(--c) 55%, #fff); stroke-width: 1.5; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c) 70%, transparent)); transition: transform .2s; transform-box: fill-box; transform-origin: center; }
.node:hover .dot, .node:focus .dot { transform: scale(1.18); }
.node.unseen { opacity: .38; }
.node.explored .dot { stroke: var(--start); stroke-width: 3; } .node.changed .dot { stroke: var(--fix); stroke-width: 3; }
.pulse { fill: none; stroke-width: 2; transform-box: fill-box; transform-origin: center; animation: pulse 2s ease-out infinite; }
.explored .pulse { stroke: var(--start); } .changed .pulse { stroke: var(--fix); }
@keyframes pulse { from { transform: scale(1); opacity: .8; } to { transform: scale(2.1); opacity: 0; } }
.name { fill: var(--fg); font-size: 11.5px; text-anchor: middle; paint-order: stroke; stroke: var(--card); stroke-width: 3px; pointer-events: none; }
.changed .name, .explored .name { font-weight: 600; }
.name { transition: opacity .2s; } .node.quiet .name { opacity: 0; } #osr-graph.focus .node.on .name, .node.quiet:hover .name { opacity: 1; }
#osr-graph.focus .node:not(.on) { opacity: .12; } #osr-graph.focus .link:not(.on) { stroke-opacity: .05; } #osr-graph.focus .link.on { stroke-opacity: 1; }
.card { animation: rise .45s cubic-bezier(.2,.7,.3,1) both; animation-delay: calc(var(--i) * 45ms); transition: transform .2s, box-shadow .2s; }
.card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.25); }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
.card.flash { animation: flash 1.2s ease-out; }
@keyframes flash { 0% { box-shadow: 0 0 0 0 var(--accent); } 30% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 45%, transparent); } 100% { box-shadow: 0 0 0 0 transparent; } }
li.fix { background: linear-gradient(100deg, var(--fix) 40%, #fff6c4 50%, var(--fix) 60%); background-size: 250% 100%; animation: shimmer 2.8s linear infinite; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; } }
</style></head><body>
<h1>${xml(title)}</h1>
${legend}
<svg id="osr-graph" style="height:${Math.min(560, Math.max(300, 120 + bubbles.length * 11))}px" role="img" aria-label="The files of ${xml(title)} and how they use each other"></svg>
<script type="application/json" id="osr-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<main class="grid">${html.join("\n")}</main>
${files.length > cards.length ? `<p class="legend more">${files.length - cards.length} more files aren't shown: the map keeps the lesson's files and the most connected others. Ask about any of them in chat.</p>` : ""}
<script>${FILE_MAP_SCRIPT}</script>
</body></html>`;
}
