// POST /api/lessons/:id/ask {selection, file, question?} — "Ask about
// selection" from the IDE's teacher panel. Stub until the teacher
// (lib/lesson/teacher.ts) lands; it says what it received so the wiring can be
// checked end to end.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { readJsonBody } from "@/lib/request-body";
import { MAX_SELECTION_CHARS, validLessonId } from "@/lib/ide/lesson-api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  if (!validLessonId(id)) return Response.json({ error: "Invalid lesson" }, { status: 400 });
  const body = await readJsonBody<{ selection?: unknown; file?: unknown; question?: unknown }>(req, 100_000);
  if (!body || typeof body.selection !== "string" || typeof body.file !== "string" || body.selection.length > MAX_SELECTION_CHARS || body.file.length > 1_000
    || (body.question !== undefined && (typeof body.question !== "string" || body.question.length > 2_000))) {
    return Response.json({ error: "Expected { selection: string, file: string, question?: string }" }, { status: 400 });
  }
  const lines = body.selection ? body.selection.split("\n").length : 0;
  return Response.json({ reply: `The teacher isn't connected yet. It received ${lines} selected line${lines === 1 ? "" : "s"} from ${body.file || "no file"}.` });
}
