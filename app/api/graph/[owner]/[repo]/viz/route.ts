// GET /api/graph/[owner]/[repo]/viz
// Serves the graphify-generated graph.html for iframe embedding.

import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { graphHtmlPath, graphJsonPath } from "@/lib/graph";
import { hasCrg } from "@/lib/graph-build";
import { requireSession } from "@/lib/require-session";
import { sanitizeGitHubName } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Validate both segments before either reaches a path join. `owner` and
 *  `repo` are interpolated into a cache directory and then read off disk;
 *  unvalidated, a `..` segment turns this into an arbitrary file read that
 *  the route serves back as HTML. */
function safeParams(owner: string, repo: string): { owner: string; repo: string } | null {
  const o = sanitizeGitHubName(owner);
  const r = sanitizeGitHubName(repo);
  return o && r ? { owner: o, repo: r } : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const raw = await params;
  const safe = safeParams(raw.owner, raw.repo);
  if (!safe) return new Response("Invalid repo", { status: 400 });
  const { owner, repo } = safe;
  const htmlPath = graphHtmlPath(owner, repo);

  if (existsSync(htmlPath)) {
    const html = await readFile(htmlPath, "utf8");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // graph.json exists but graph.html doesn't — repo too large for vis.js
  if (existsSync(graphJsonPath(owner, repo))) {
    const fallbackHtml = `<!DOCTYPE html>
<html><head><style>
  body { background: #0d0d0d; color: #a0a0a0; font-family: monospace;
    display: flex; align-items: center; justify-content: center;
    height: 100vh; margin: 0; text-align: center; }
  .msg { max-width: 400px; }
  h2 { color: #e0e0e0; font-size: 16px; }
  p { font-size: 12px; line-height: 1.6; }
  .highlight { color: #f0a050; }
</style></head><body><div class="msg">
  <h2>Graph too large for visualization</h2>
  <p>This repo produced a graph too large for the interactive HTML viewer.
  The <span class="highlight">query engine still works</span> — use the
  chat panel to run trace, impact, explain, and other commands.
  All graph data is available.</p>
</div></body></html>`;
    return new Response(fallbackHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // CRG-only repo — no graphify output at all, but graph.db exists
  if (hasCrg(owner, repo)) {
    const crgHtml = `<!DOCTYPE html>
<html><head><style>
  body { background: #0d0d0d; color: #a0a0a0; font-family: monospace;
    display: flex; align-items: center; justify-content: center;
    height: 100vh; margin: 0; text-align: center; }
  .msg { max-width: 420px; }
  h2 { color: #e0e0e0; font-size: 16px; margin-bottom: 12px; }
  p { font-size: 12px; line-height: 1.7; }
  .highlight { color: #f0a050; }
  .dim { color: #666; font-size: 11px; margin-top: 16px; }
</style></head><body><div class="msg">
  <h2>Large repository</h2>
  <p>This repo has too many files for an interactive graph visualization.
  It was analyzed with <span class="highlight">code-review-graph</span>
  instead, which uses a SQLite-backed engine optimized for large codebases.</p>
  <p>Use the <span class="highlight">chat panel</span> to ask questions
  about the codebase — all queries are powered by AI with the full
  graph data as context.</p>
  <p class="dim">Visualization is available for repos under 800 files.</p>
</div></body></html>`;
    return new Response(crgHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(
    "Graph not built yet. Build the graph first via the UI.",
    { status: 404 },
  );
}

// HEAD — check if graph data exists (json OR html)
export async function HEAD(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const unauth = await requireSession();
  if (unauth) return new Response(null, { status: 401 });

  const raw = await params;
  const safe = safeParams(raw.owner, raw.repo);
  if (!safe) return new Response(null, { status: 400 });
  const { owner, repo } = safe;

  const hasGraphify = existsSync(graphHtmlPath(owner, repo)) || existsSync(graphJsonPath(owner, repo));
  const hasCrgData = hasCrg(owner, repo);

  if (hasGraphify || hasCrgData) {
    const engine = hasGraphify ? "graphify" : "crg";
    return new Response(null, {
      status: 200,
      headers: { "X-Graph-Engine": engine },
    });
  }

  return new Response(null, { status: 404 });
}
