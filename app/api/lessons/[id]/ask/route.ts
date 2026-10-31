// POST /api/lessons/:id/ask {selection, file, question?} — "Ask about
// selection" from the IDE's teacher panel: one teacher turn, leak-checked
// and saved with the lesson chat (lib/lesson/api.ts askAboutSelection).

import { NextRequest } from "next/server";
import { askAboutSelection } from "@/lib/lesson/api";
import { defaultLessonDeps } from "@/lib/lesson/deps";

export const maxDuration = 200;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return askAboutSelection(req, (await params).id, defaultLessonDeps());
}
