// GET /api/graph/[owner]/[repo]/viz
// Serves the graphify-generated graph.html for iframe embedding.

import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { graphHtmlPath } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const htmlPath = graphHtmlPath(owner, repo);

  if (!existsSync(htmlPath)) {
    return new Response(
      "Graph not built yet. Build the graph first via the UI.",
      { status: 404 },
    );
  }

  const html = await readFile(htmlPath, "utf8");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

// HEAD for checking if graph exists without downloading the full HTML
export async function HEAD(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const htmlPath = graphHtmlPath(owner, repo);

  if (!existsSync(htmlPath)) {
    return new Response(null, { status: 404 });
  }

  return new Response(null, { status: 200 });
}
