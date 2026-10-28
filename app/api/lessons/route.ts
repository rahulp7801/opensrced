// POST /api/lessons { repo_url, issue_number?, mode?, path? } — create a
// lesson and start its hidden fix (PLAN §7.2). Behind OPENSRCER_LESSONS=1;
// handlers in lib/lesson/api.ts.

import { NextRequest } from "next/server";
import { createLesson } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

// Starting the hidden run goes through startCloudRun (see /api/run/agentic).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return createLesson(req, defaultLessonDeps());
}
