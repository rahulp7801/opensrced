// /learn/:lessonId/code — path B, write it yourself (PLAN §8): the lesson's
// repo at its pinned commit in the in-browser IDE. The repo and commit come
// from the caller's own lesson row; the commit is pinned when the lesson
// page first loads (lib/lesson/api.ts getLesson).

import { notFound, redirect } from "next/navigation";
import { Ide } from "@/components/ide/ide";
import { flagEnabled } from "@/lib/flags";
import { lessonStore } from "@/lib/lesson/db-store";
import { LESSON_ID_RE } from "@/lib/lesson/store";
import { sessionUserId } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";

export const dynamic = "force-dynamic";
export const metadata = { title: "Write the fix" };

export default async function LessonCodePage({ params, searchParams }: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ cmd?: string }>;
}) {
  const { lessonId } = await params;
  if (!flagEnabled("lessons") || !LESSON_ID_RE.test(lessonId)) notFound();
  const owner = await sessionUserId();
  const lesson = owner ? await lessonStore().get(lessonId) : null;
  // Someone else's lesson reads as missing, like the API.
  if (!lesson || lesson.owner !== owner) notFound();
  // Not pinned yet: the lesson page pins it on load.
  if (!lesson.base_sha) redirect(`/learn/${lessonId}`);
  const { cmd } = await searchParams;
  return <Ide lessonId={lessonId} repo={parseRunTarget(lesson.repo_url).repo} sha={lesson.base_sha} runCommand={cmd?.slice(0, 500) || "npm test"} />;
}
