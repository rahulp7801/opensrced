// POST /api/lessons/:id/run {diff, cmd} — runs a command against the
// contributor's diff and streams the output as SSE `data: {type, data}` lines
// (lib/ide/lesson-api.ts RunEvent). Stub: says plainly that running isn't
// connected yet. The exec-VM stream replaces the body: boot or reuse the
// lesson's VM, git apply the diff on a clean checkout, stream exec-server /run.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { readJsonBody } from "@/lib/request-body";
import { MAX_DIFF_BYTES, RUN_NOT_CONNECTED, runEventStream, validLessonId } from "@/lib/ide/lesson-api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  if (!validLessonId(id)) return Response.json({ error: "Invalid lesson" }, { status: 400 });
  const body = await readJsonBody<{ diff?: unknown; cmd?: unknown }>(req, MAX_DIFF_BYTES + 10_000);
  if (!body || typeof body.diff !== "string" || typeof body.cmd !== "string" || !body.cmd.trim() || body.cmd.length > 2_000) {
    return Response.json({ error: "Expected { diff: string, cmd: string }" }, { status: 400 });
  }
  return new Response(runEventStream(RUN_NOT_CONNECTED), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
