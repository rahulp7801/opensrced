// GET /api/graph/[owner]/[repo]/viz
// Serves the graphify-generated graph.html for iframe embedding.

import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { graphHtmlPath, graphJsonPath } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
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
  const { owner, repo } = await params;

  if (existsSync(graphHtmlPath(owner, repo)) || existsSync(graphJsonPath(owner, repo))) {
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 404 });
}
