// POST /api/admin/classes/maps {repo} — prepare a public repository's code map
// before class (lib/harness-graph.ts), so every student's first lesson on it
// starts at once instead of waiting minutes for a build. Admins only.
import { splitRepo } from "@/lib/ai-policy";
import { buildSharedGraph, SharedGraphError, storedSharedGraph } from "@/lib/harness-graph";
import { NO_STORE, requireAdmin } from "@/lib/require-admin";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const body = await readJsonBody<{ repo?: unknown }>(req, 1_000);
  let repo: string;
  try { repo = splitRepo(String(body?.repo ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "")).join("/"); } catch {
    return Response.json({ error: "Give the repository as owner/name, like pallets/itsdangerous." }, { status: 400, headers: NO_STORE });
  }
  try {
    const stored = await storedSharedGraph(repo);
    const graph = stored ?? await buildSharedGraph(repo, admin.sub, req.signal);
    return Response.json({ repo, nodes: graph.graph.nodes.length, revision: graph.revision.slice(0, 7), already: Boolean(stored) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SharedGraphError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    throw error;
  }
}
