// POST /api/graph/query
// Queries the cached graph.json using pure JS graph traversal.
// Zero LLM cost — every query is free.

import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { loadGraph, routeQuery, graphJsonPath } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    query?: string;
  };

  if (!body.owner || !body.repo || !body.query) {
    return Response.json(
      { error: "Missing owner, repo, or query" },
      { status: 400 },
    );
  }

  const jsonPath = graphJsonPath(body.owner, body.repo);
  if (!existsSync(jsonPath)) {
    return Response.json(
      { error: "Graph not built yet. Click 'Build Graph' first." },
      { status: 404 },
    );
  }

  try {
    const graph = await loadGraph(body.owner, body.repo);
    const result = routeQuery(graph, body.query);
    return Response.json({ result, cost: 0 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
