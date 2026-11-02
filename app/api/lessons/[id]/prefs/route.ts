// GET /api/lessons/<id>/prefs — how the lesson repo's maintainers like PRs
// (lib/maintainer-prefs.ts), for the kickoff and publish cards.

import { lessonPrefs } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return lessonPrefs((await ctx.params).id, defaultLessonDeps());
}
