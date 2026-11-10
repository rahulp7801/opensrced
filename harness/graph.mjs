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
export function overlayLevels(graph, picks, keyDiff) {
  const levels = new Map();
  for (const pick of picks.map(norm).filter(Boolean)) {
    const isFile = pick.includes("/") || /\.[a-z0-9]{1,6}$/i.test(pick);
    for (const n of graph.nodes) {
      const file = norm(n.source_file || "");
      if (isFile ? file && (file === pick || file.endsWith(`/${pick}`)) : norm(n.label) === pick) levels.set(n.id, "explored");
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
