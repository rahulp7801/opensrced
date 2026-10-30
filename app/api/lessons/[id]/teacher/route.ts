// POST /api/lessons/<id>/teacher { message, step? } — one teacher reply as
// SSE, leak-checked on the server before it is sent (lib/lesson/teacher.ts).

import { NextRequest } from "next/server";
import { teacherTurn } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const maxDuration = 200;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return teacherTurn(req, (await ctx.params).id, defaultLessonDeps());
}
