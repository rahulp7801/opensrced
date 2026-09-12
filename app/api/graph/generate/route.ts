import { readJsonBody } from "@/lib/request-body";
import { NextRequest } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";
import { cloudExecution } from "@/lib/cloud-run-state";
import { buildCloudGraph } from "@/lib/cloud-graph";
import { buildGraphWorker } from "@/lib/graph-worker";
import { getStoredGraph, saveStoredGraph } from "@/lib/graph-store";
import { reserveCloudSlot } from "@/lib/cloud-capacity";
import { reserveSlot, CapacityError } from "@/lib/concurrency";
import { resolveRepositoryToken } from "@/lib/crucible/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  if (!body || typeof body.repo_url !== "string" || (body.force !== undefined && typeof body.force !== "boolean")) {
    return Response.json({ error: "Invalid graph request" }, { status: 400 });
  }
  if (cloudExecution() && (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.OPENSRCER_WORKER_SNAPSHOT_ID)) {
    return Response.json({ error: "Graph runtime is not configured." }, { status: 503 });
  }
  let repo: string;
  try { repo = parseRunTarget(body.repo_url).repo; }
  catch { return Response.json({ error: "Invalid repository URL" }, { status: 400 }); }
  let token: string | null;
  try {
    token = (await resolveRepositoryToken(userId, repo)).token ?? null;
  }
  catch { return Response.json({ error: "Repository not accessible" }, { status: 403 }); }
  const [owner, name] = repo.split("/");
  const encoder = new TextEncoder();
  let cached = false;
  try { cached = !body.force && Boolean(await getStoredGraph(userId, repo)); }
  catch { return Response.json({ error: "Graph storage is unavailable." }, { status: 503 }); }
  if (cached) {
    return new Response(`data: ${JSON.stringify({ status: "done", message: "Using cached graph.", owner, repo: name, engine: "graphify" })}\n\n`, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
  }
  let release: () => void | Promise<void>;
  try { release = cloudExecution() ? await reserveCloudSlot("graph", 2, 5 * 60_000) : reserveSlot("graph", 2); }
  catch (error) { return Response.json({ error: error instanceof CapacityError ? error.message : "Graph storage is unavailable." }, { status: error instanceof CapacityError ? 429 : 503 }); }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([req.signal, cancellation.signal, AbortSignal.timeout(270_000)]);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => { if (!cancelled && !req.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
      try {
        const progress = (message: string) => send({ status: "progress", message });
        const graph = cloudExecution() ? await buildCloudGraph(repo, token, signal, progress, release) : await buildGraphWorker(repo, token, signal, progress);
        progress("Saving graph...");
        await saveStoredGraph(userId, repo, graph);
        send({ status: "done", message: `Built ${graph.graph.nodes.length} nodes and ${graph.graph.links.length} edges.`, owner, repo: name, engine: "graphify" });
      } catch {
        send({ error: signal.aborted ? "Graph build timed out. Try a smaller repository." : "Graph build failed or exceeded its limits. Check the graph runtime and try a smaller repository." });
      } finally {
        if (!cloudExecution()) await Promise.resolve(release()).catch(() => {});
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; cancellation.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
