// GET /api/ide/graph?repo=owner/name&symbol=name — definitions and references
// of one symbol from the caller's stored code graph (lib/graph-store.ts), for
// the IDE's graph navigation (components/ide/languages.ts). No graph is a
// normal answer ({ available: false }), not an error: the IDE then keeps only
// the language servers' own navigation.

import { NextRequest } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";
import { getStoredGraph } from "@/lib/graph-store";
import { graphNav } from "@/lib/ide/graph-nav";

export const dynamic = "force-dynamic";

const NONE = { available: false, definitions: [], references: [] };

export async function GET(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
  let repo: string;
  try { repo = parseRunTarget(req.nextUrl.searchParams.get("repo")).repo; }
  catch { return Response.json({ error: "Invalid repository" }, { status: 400 }); }
  if (!/^[\p{L}\p{N}_$]{1,200}$/u.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });
  let stored;
  try { stored = await getStoredGraph(userId, repo); }
  catch (error) {
    // Degrade, but say why in the server log: an unreadable graph is not "no graph".
    console.error("ide graph: stored graph unreadable", (error as Error).message);
    return Response.json(NONE);
  }
  if (!stored) return Response.json(NONE);
  return Response.json({ available: true, ...graphNav(stored.graph, symbol) });
}
