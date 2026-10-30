// GET /api/lessons/<id> — the caller's lesson: stage, steps, grades, hints
// and the chat history. Never the hidden fix (lib/lesson/api.ts publicLesson).
// PATCH /api/lessons/<id> { path?, mode? } — change the path until s8, or
// the mode during kickoff.

import { getLesson, updateLesson } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return getLesson((await ctx.params).id, defaultLessonDeps());
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return updateLesson(req, (await ctx.params).id, defaultLessonDeps());
}
