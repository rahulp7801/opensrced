// POST /api/lessons/<id>/steps/<step> { answer } — submit a step and grade it
// (deterministic where it can, else one fast-model call).

import { NextRequest } from "next/server";
import { submitStep } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; step: string }> }) {
  const { id, step } = await ctx.params;
  return submitStep(req, id, step, defaultLessonDeps());
}
