// The signed-in user's project map (PLAN §9.4), behind OPENSRCER_RECORD=1.
// Private: only ever the caller's own map.
//
//   GET  /api/record/map                       per repository: marked nodes and area coverage (for /account)
//   GET  /api/record/map?repo=o/n&issue=123    "you've been here before" for a lesson on that issue, or { note: null }
//   POST /api/record/map { repo, file }        a file opened in the code viewer or IDE: its nodes become explored

import { NextRequest } from "next/server";
import { fetchIssue } from "@/lib/agentic-dispatcher";
import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { resolveGitHubToken } from "@/lib/github-token";
import { getStoredGraph } from "@/lib/graph-store";
import { findRepoId, lessonNote, mapLevels, markNodes, nodesForFiles, repoMaps } from "@/lib/record/map";
import { issueInsights } from "@/lib/recs/rank";
import { graphContext, scopeNodesFor } from "@/lib/recs/ingest";
import { readJsonBody } from "@/lib/request-body";
import { sessionAccount } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";
import { ensureUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function graphOf(userId: string, repo: string) {
  return (await getStoredGraph(userId, repo))?.graph ?? null;
}

export async function GET(req: NextRequest) {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const account = await sessionAccount();
  if (!account) return json({ error: "Not authenticated" }, 401);
  const db = await getDb();
  const sp = req.nextUrl.searchParams;
  if (!sp.has("repo")) return json({ maps: await repoMaps(db, account.id, (repo) => graphOf(account.id, repo)) });

  let repo: string;
  try { repo = parseRunTarget(sp.get("repo")).repo; }
  catch { return json({ error: "Invalid repository" }, 400); }
  const issue = Number(sp.get("issue"));
  if (!Number.isSafeInteger(issue) || issue < 1) return json({ error: "issue must be a positive whole number" }, 400);
  const [owner, name] = repo.split("/");
  const repoId = await findRepoId(db, repo);
  const known = repoId === null ? new Map() : await mapLevels(db, account.id, repoId);
  if (!known.size) return json({ note: null });
  const graph = await graphOf(account.id, repo);
  if (!graph) return json({ note: null });
  // The issue's nodes: from the catalog index when it has them, else mapped
  // from the issue's own text the way ingest maps it.
  let scope = (await issueInsights(db, owner, name, [issue])).get(issue)?.scopeNodes;
  if (!scope) {
    const fetched = await fetchIssue(repo, issue, (await resolveGitHubToken()) ?? undefined, true);
    scope = scopeNodesFor(fetched.title, fetched.body, [], graphContext(graph)).scopeNodes;
  }
  return json({ note: lessonNote(graph, known, scope) });
}

export async function POST(req: Request) {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const account = await sessionAccount();
  if (!account) return json({ error: "Not authenticated" }, 401);
  const body = await readJsonBody<Record<string, unknown>>(req);
  let repo: string;
  try { repo = parseRunTarget(body?.repo).repo; }
  catch { return json({ error: "Invalid repository" }, 400); }
  const file = body?.file;
  if (typeof file !== "string" || !file.trim() || file.length > 1_000) return json({ error: "Expected { repo, file }" }, 400);
  const graph = await graphOf(account.id, repo);
  if (!graph) return json({ marked: 0 });
  const db = await getDb();
  await ensureUser(db, account.id, account.login);
  return json({ marked: await markNodes(db, account.id, repo, { level: "explored", nodes: nodesForFiles(graph, [file]) }) });
}
