// POST /api/lessons/:id/submit {diff} — the IDE's "I'm done, check my work":
// stores the contributor's diff for the reveal to compare with the AI's, and
// moves a path-B lesson from the IDE stage to the reveal. The checks of
// PLAN §8.4 (their tests in the exec VM) arrive with the exec VM wiring.

import { NextRequest } from "next/server";
import { saveIdeDiff } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return saveIdeDiff(req, (await params).id, defaultLessonDeps(), true);
}
