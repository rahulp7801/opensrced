// /learn/:lessonId/reveal — the contributor's plan (or code) next to the
// AI's fix, then explain-it and publishing (PLAN §7.6). The server decides
// whether the fix may be shown (POST /api/lessons/<id>/reveal, and the
// dispatch preview route stays 403 until it has).

import { notFound } from "next/navigation";
import { RevealView } from "@/components/lesson/reveal-view";
import { flagEnabled } from "@/lib/flags";
import { LESSON_ID_RE } from "@/lib/lesson/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "The reveal" };

export default async function RevealPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  if (!flagEnabled("lessons") || !LESSON_ID_RE.test(lessonId)) notFound();
  return <RevealView lessonId={lessonId} forkCi={flagEnabled("forkCi")} />;
}
