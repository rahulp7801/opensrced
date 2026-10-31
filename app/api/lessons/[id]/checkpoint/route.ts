// POST /api/lessons/:id/checkpoint {diff} — the IDE saves the contributor's
// diff here every 30 s, so a lesson can resume on another device (PLAN §8.0).
// Kept on the lesson row (lib/lesson/api.ts saveIdeDiff).

import { NextRequest } from "next/server";
import { saveIdeDiff } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return saveIdeDiff(req, (await params).id, defaultLessonDeps(), false);
}
