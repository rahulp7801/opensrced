/** Graph labels originate in repository content; isolate HTML even when opened directly. */
export function graphHtmlResponse(html: string): Response {
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  } });
}

/** Project-map overlay colours (PLAN §9.4): grey unseen, blue explored, green explained, gold changed. */
export const MAP_COLORS = { unseen: "#4b4b4b", explored: "#4E79A7", explained: "#59A14F", changed: "#EDC948" } as const;

/** The graphify viz recoloured by what the user has explored, explained and
 *  changed, with a small legend. HTML without graphify's node DataSet (the
 *  "too large" pages) comes back unchanged. Node ids come from repository
 *  content, so the JSON is escaped against closing the script tag. */
export function withMapOverlay(html: string, levels: Map<string, keyof typeof MAP_COLORS>): string {
  const end = html.lastIndexOf("</body>");
  if (end < 0 || !html.includes("nodesDS")) return html;
  const data = JSON.stringify({ colors: MAP_COLORS, levels: Object.fromEntries(levels) }).replace(/</g, "\\u003c");
  const script = `<script>
(() => {
  // The page's own script failed (e.g. vis-network did not load): nothing to recolour.
  if (typeof nodesDS === "undefined") return;
  const { colors, levels } = ${data};
  const paint = (c) => ({ background: c, border: c, highlight: { background: "#ffffff", border: c } });
  nodesDS.update(nodesDS.getIds().map((id) => ({ id, color: paint(colors[levels[id]] ?? colors.unseen) })));
  const legend = document.createElement("div");
  legend.style.cssText = "position:fixed;left:12px;bottom:12px;padding:8px 10px;background:rgba(13,13,13,.85);color:#ddd;font:12px sans-serif;border-radius:6px;z-index:10";
  legend.textContent = "Your map: ";
  for (const [name, c] of Object.entries(colors)) {
    const item = document.createElement("span");
    item.style.cssText = "margin-left:10px;white-space:nowrap";
    item.innerHTML = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:' + c + '"></span>';
    item.append(name);
    legend.append(item);
  }
  document.body.append(legend);
})();
</script>
`;
  return html.slice(0, end) + script + html.slice(end);
}
