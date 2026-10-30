// POST /api/lessons/<id>/hint { step } — the next rung of the hint ladder (§7.5).

import { NextRequest } from "next/server";
import { nextHint } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return nextHint(req, (await ctx.params).id, defaultLessonDeps());
}
