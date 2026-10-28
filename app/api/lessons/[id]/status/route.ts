// GET /api/lessons/<id>/status — the hidden fix's progress only: setting up,
// solving, proving, ready (lib/hidden-runs.ts runPhase). No file names,
// titles or diff.

import { lessonStatus } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return lessonStatus((await ctx.params).id, defaultLessonDeps());
}
