// /learn/:lessonId/code — path B, write it yourself (PLAN §8): the lesson's
// repo at its pinned commit in the in-browser IDE.
// ponytail: the repo and commit come from the query string until the lesson
// store lands; then they come from the lesson row and the query is ignored.

import { notFound } from "next/navigation";
import { Ide } from "@/components/ide/ide";
import { parseRunTarget } from "@/lib/run-target";
import { validSha } from "@/lib/ide/repo-tree";
import { validLessonId } from "@/lib/ide/lesson-api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Write the fix" };

export default async function LessonCodePage({ params, searchParams }: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ repo?: string; sha?: string; cmd?: string }>;
}) {
  const { lessonId } = await params;
  const query = await searchParams;
  if (!validLessonId(lessonId)) notFound();
  let repo: string;
  try { repo = parseRunTarget(query.repo).repo; } catch { notFound(); }
  if (!validSha(query.sha)) notFound();
  return <Ide lessonId={lessonId} repo={repo} sha={query.sha} runCommand={query.cmd?.slice(0, 500) || "npm test"} />;
}
