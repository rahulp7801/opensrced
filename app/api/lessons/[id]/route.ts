// GET /api/lessons/<id> — the caller's lesson: stage, steps, grades, hints.
// Never the hidden fix (lib/lesson/api.ts publicLesson).

import { getLesson } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return getLesson((await ctx.params).id, defaultLessonDeps());
}
