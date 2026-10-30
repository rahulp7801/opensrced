// POST /api/lessons/:id/checkpoint {diff} — the IDE saves the contributor's
// diff here every 30 s, so a lesson can resume on another device (PLAN §8.0).
// Stub: an in-memory map per server instance until the lesson store
// (lesson_steps) lands.
// ponytail: in-memory, lost on restart and not shared across instances; the
// DB stream replaces the Map with a lesson_steps row.

import { NextRequest } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { readJsonBody } from "@/lib/request-body";
import { MAX_DIFF_BYTES, validLessonId } from "@/lib/ide/lesson-api";

export const dynamic = "force-dynamic";

const checkpoints = new Map<string, { diff: string; savedAt: string }>();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  if (!validLessonId(id)) return Response.json({ error: "Invalid lesson" }, { status: 400 });
  const body = await readJsonBody<{ diff?: unknown }>(req, MAX_DIFF_BYTES + 1_000);
  if (!body || typeof body.diff !== "string") return Response.json({ error: "Expected { diff: string } under 1 MB" }, { status: 400 });
  const savedAt = new Date().toISOString();
  if (checkpoints.size > 1000) checkpoints.clear();
  checkpoints.set(`${userId}:${id}`, { diff: body.diff, savedAt });
  return Response.json({ ok: true, savedAt, bytes: body.diff.length });
}
