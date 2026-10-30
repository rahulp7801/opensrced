// POST /api/lessons/:id/suggest {file, line} — Ctrl+I "Suggest" in the IDE:
// one request to the contributor's agent session, passed through the leak
// filter (PLAN §8.3, lib/lesson/leak.ts). Stub: a fixed message until the
// agent session and the leak filter land.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { readJsonBody } from "@/lib/request-body";
import { SUGGEST_NOT_CONNECTED, validLessonId } from "@/lib/ide/lesson-api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  if (!validLessonId(id)) return Response.json({ error: "Invalid lesson" }, { status: 400 });
  const body = await readJsonBody<{ file?: unknown; line?: unknown }>(req, 10_000);
  if (!body || typeof body.file !== "string" || body.file.length > 1_000 || !Number.isSafeInteger(body.line) || (body.line as number) < 1) {
    return Response.json({ error: "Expected { file: string, line: number }" }, { status: 400 });
  }
  return Response.json({ suggestion: SUGGEST_NOT_CONNECTED });
}
