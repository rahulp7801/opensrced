// The parts of the extension that don't need VS Code: token checks, the MCP
// server's launch settings and the map page. extension.js wires them to VS Code;
// test/core.test.js tests them with plain Node.

"use strict";

/** A harness token as the site issues it (lib/harness-token.ts TOKEN_HEADER). */
const TOKEN = /^osh_[A-Za-z0-9_-]{32}$/;

class TokenFormatError extends Error {}

/** The pasted token, trimmed, or TokenFormatError saying what's wrong. */
function cleanToken(raw) {
  const text = String(raw ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!text) throw new TokenFormatError("Paste the token from your opensrcer Account page.");
  if (!text.startsWith("osh_")) throw new TokenFormatError("That isn't an opensrcer token: they start with osh_.");
  if (!TOKEN.test(text)) throw new TokenFormatError("That token looks cut off: copy the whole thing (osh_ and 32 more characters).");
  return text;
}

/** The site's base URL from the setting: https only (http for localhost, when testing a local site). */
function siteUrl(raw) {
  const text = String(raw || "https://opensrced.vercel.app").trim().replace(/\/+$/, "");
  let url;
  try { url = new URL(text); } catch (error) {
    if (error instanceof TypeError) throw new TokenFormatError(`opensrcer.url isn't a URL: ${text}`);
    throw error;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new TokenFormatError(`opensrcer.url must start with https:// (got ${text}).`);
  return text;
}

/**
 * How VS Code starts the MCP server: VS Code's own runtime in Node mode
 * (ELECTRON_RUN_AS_NODE), so nobody has to install Node. In a remote window
 * (WSL, SSH) the extension host is plain Node and the variable is ignored.
 */
function serverLaunch({ execPath, serverPath, token, url, mapDir, graphPython }) {
  const env = {
    ELECTRON_RUN_AS_NODE: "1",
    OPENSRCER_CLIENT: "vscode-extension",
    OPENSRCER_URL: url,
    OPENSRCER_MAP_DIR: mapDir,
    // null removes a value inherited from the environment: no token means "sign in first".
    OPENSRCER_TOKEN: token || null,
  };
  if (graphPython) env.OPENSRCER_GRAPH_PYTHON = graphPython;
  return { command: execPath, args: [serverPath], env };
}

/** What GET /api/harness/me said about a token, as one sentence for the user. */
function describeMe(status, body) {
  if (status === 200) return { ok: true, text: `Signed in to opensrcer as @${body?.login ?? "you"}.` };
  if (status === 401) return { ok: false, rejected: true, text: "opensrcer doesn't know that token. Create a new one on your Account page and paste it." };
  if (status === 403) return { ok: false, text: String(body?.error ?? "This account doesn't have access yet: open your class link, or join the waitlist on the site.") };
  return { ok: false, text: `opensrcer answered ${status}. Try again in a minute.` };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STAGES = {
  kickoff: "Understanding the project and the issue",
  locate: "Finding where to look",
  predict: "Predicting the change",
  ide: "Writing the fix",
  reveal: "Ready to reveal the fix",
  explain: "Explaining the fix",
  next: "Next steps",
  done: "Done",
};

/**
 * The map tab's page. No scripts: the webview runs with scripts off and a CSP
 * that allows only inline styles and the inline SVG (built by harness/graph.mjs,
 * which escapes every label). Every other value is escaped here.
 */
function mapHtml(map, cspSource) {
  const csp = `default-src 'none'; style-src 'unsafe-inline' ${cspSource}; img-src data: ${cspSource};`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>opensrcer map</title><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:12px 16px;margin:0}
h1{font-size:1.1em;margin:0 0 2px} .stage{color:var(--vscode-descriptionForeground);margin:0 0 10px}
svg{width:100%;height:auto;max-height:75vh} ul{margin:4px 0 10px;padding-left:18px} code{font-family:var(--vscode-editor-font-family)}
.legend{color:var(--vscode-descriptionForeground);font-size:.9em} .empty{color:var(--vscode-descriptionForeground)}
</style></head><body>`;
  if (!map || typeof map.svg !== "string") {
    return `${head}<h1>opensrcer code map</h1><p class="empty">No lesson yet. Ask Copilot to teach you an issue (opensrcer: Learn an issue), and the project's map appears here.</p></body></html>`;
  }
  const svg = map.svg.trimStart().startsWith("<svg") ? map.svg : "";
  const list = (label, files) => (Array.isArray(files) && files.length
    ? `<p><strong>${label}</strong></p><ul>${files.slice(0, 20).map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul>` : "");
  return `${head}<h1>${escapeHtml(map.title ?? "Code map")}</h1>
<p class="stage">${escapeHtml(STAGES[map.stage] ?? "Lesson in progress")}</p>
${svg}
<p class="legend">Clusters of related code from graphify, sized by how much code each holds. Blue: your starting points. Yellow: changed by the fix. Grey: not looked at yet.</p>
${list("Your starting points", map.explored)}${list("Changed by the fix", map.changed)}</body></html>`;
}

/** The map file the server wrote, or null when there's none or it's unreadable mid-write. */
function parseMap(text) {
  try {
    const map = JSON.parse(text);
    return map && typeof map === "object" && typeof map.lesson === "string" ? map : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** "https://github.com/o/n/issues/12", "o/n#12" or "o/n 12" → { repo, number }, else null. */
function parseIssue(text) {
  const t = String(text ?? "").trim();
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}(?:[/#\s]|$))[A-Za-z0-9_.-]{1,100}?)(?:\/(?:issues|pull)\/|#|\s+)(\d{1,7})\/?(?:[?#].*)?$/.exec(t);
  return m && Number(m[2]) > 0 ? { repo: m[1], number: Number(m[2]) } : null;
}

module.exports = { TOKEN, TokenFormatError, cleanToken, siteUrl, serverLaunch, describeMe, mapHtml, parseMap, parseIssue, STAGES };
