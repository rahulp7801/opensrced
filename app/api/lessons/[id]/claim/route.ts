// POST /api/lessons/<id>/claim — a comment claiming the issue, drafted from
// the contributor's own answers, for them to post themselves. Never posted here.

import { NextRequest } from "next/server";
import { draftClaim } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return draftClaim(req, (await ctx.params).id, defaultLessonDeps());
}
