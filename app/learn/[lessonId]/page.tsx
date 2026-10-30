// /learn/:lessonId — the lesson (PLAN §7.8). Behind OPENSRCER_LESSONS=1;
// everything else (ownership, stage, the hidden fix) is the API's to enforce.

import { notFound } from "next/navigation";
import { LessonView } from "@/components/lesson/lesson-view";
import { flagEnabled } from "@/lib/flags";
import { LESSON_ID_RE } from "@/lib/lesson/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lesson" };

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  if (!flagEnabled("lessons") || !LESSON_ID_RE.test(lessonId)) notFound();
  return <LessonView lessonId={lessonId} />;
}
