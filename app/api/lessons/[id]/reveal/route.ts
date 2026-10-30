// POST /api/lessons/<id>/reveal { give_up? } — after s8, or on an explicit
// give-up: sets the hidden run's reveal marker, which unlocks its log and
// preview on the dispatch routes.

import { NextRequest } from "next/server";
import { revealLesson } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return revealLesson(req, (await ctx.params).id, defaultLessonDeps());
}
