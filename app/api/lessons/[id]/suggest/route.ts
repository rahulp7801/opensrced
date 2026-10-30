// POST /api/lessons/:id/suggest {file, line} — Ctrl+I "Suggest" in the IDE:
// a hint from the teacher for that spot, through the same leak check as
// every reply (PLAN §8.3; lib/lesson/api.ts suggestAtCursor).

import { NextRequest } from "next/server";
import { suggestAtCursor } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const maxDuration = 200;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return suggestAtCursor(req, (await params).id, defaultLessonDeps());
}
