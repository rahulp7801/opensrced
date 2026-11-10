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
export const GRAPHIFY_INSTALL = "pip install graphifyy==0.9.73";
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

/** graphify's graph of `top` at its HEAD commit: {graph, html, sha, cached}.
 *  Cached under `cacheRoot/<sha>`. Throws GraphifyError with what to do. */
export async function graphify(top, cacheRoot, python = process.env.OPENSRCER_GRAPH_PYTHON || "python") {
  const sha = (await run("git", ["-C", top, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
  const cache = join(cacheRoot, sha);
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
  if (!html.includes("nodesDS") || levels.size === 0) return html.slice(0, end) + access + html.slice(end);
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
const MAP_W = 640;
const MAP_H = 400;

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
  // Labels: touched clusters first, then the biggest; each file named once,
  // and none drawn over another (boxes estimated at 6 px a character).
  const shown = new Set();
  const placed = [];
  const named = new Set();
  const order = communities.map((c, i) => i).sort((a, b) => Number(communities[b].level !== "unseen") - Number(communities[a].level !== "unseen") || communities[b].count - communities[a].count);
  for (const i of order) {
    const c = communities[i];
    if (named.has(c.label) || (c.level === "unseen" && shown.size >= 14)) continue;
    const w = Math.min(28, c.label.length) * 6, box = { x0: c.x * MAP_W - w / 2, x1: c.x * MAP_W + w / 2, y0: c.y * MAP_H - c.r - 14, y1: c.y * MAP_H - c.r - 1 };
    if (placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) continue;
    placed.push(box);
    named.add(c.label);
    shown.add(i);
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H + 30}" width="${MAP_W}" height="${MAP_H + 30}" font-family="sans-serif">`,
    ...edges.map(([a, b, w]) => `<line x1="${(communities[a].x * MAP_W).toFixed(1)}" y1="${(communities[a].y * MAP_H).toFixed(1)}" x2="${(communities[b].x * MAP_W).toFixed(1)}" y2="${(communities[b].y * MAP_H).toFixed(1)}" stroke="#8a8a8a" stroke-opacity="0.45" stroke-width="${(0.5 + Math.min(2.5, Math.log1p(w) / 2)).toFixed(2)}"/>`),
    ...communities.map((c) => `<circle cx="${(c.x * MAP_W).toFixed(1)}" cy="${(c.y * MAP_H).toFixed(1)}" r="${c.r.toFixed(1)}" fill="${MAP_COLORS[c.level]}" stroke="${c.level === "unseen" ? "#777" : "#fff"}" stroke-width="${c.level === "unseen" ? 0.5 : 1.5}"><title>${xml(c.label)}: ${c.count} nodes</title></circle>`),
    ...communities.flatMap((c, i) => (shown.has(i) ? [`<text x="${(c.x * MAP_W).toFixed(1)}" y="${(c.y * MAP_H - c.r - 3).toFixed(1)}" font-size="11" text-anchor="middle" fill="#9a9a9a">${xml(c.label.slice(0, 28))}</text>`] : [])),
    ...Object.entries(MAP_LABELS).map(([level, label], i) => `<circle cx="${14 + i * 170}" cy="${MAP_H + 15}" r="5" fill="${MAP_COLORS[level]}"/><text x="${24 + i * 170}" y="${MAP_H + 19}" font-size="11" fill="#9a9a9a">${xml(label)}</text>`),
    "</svg>",
  ].join("");
  return { title, communities, edges, explored: [...files.explored].slice(0, 12), changed: [...files.changed].slice(0, 12), svg };
}
