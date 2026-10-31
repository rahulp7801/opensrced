// What the lesson routes send the browser (lib/lesson/api.ts), as types only.

import type { publicLesson } from "@/lib/lesson/api";
import type { LessonMessage } from "@/lib/lesson/store";

export type PublicLesson = ReturnType<typeof publicLesson> & { ide_diff?: string };

/** GET /api/lessons/<id>. */
export type LessonResponse = {
  lesson: PublicLesson; teacher_available: boolean; messages: LessonMessage[];
  /** From s10 on: the docs-first suggestion (lib/lesson/steps/s10.ts docsIssueDraft). */
  docs_issue?: { title: string; body: string };
};

/** Load the caller's lesson. Throws with the server's message. */
export async function fetchLesson(id: string, signal?: AbortSignal): Promise<LessonResponse> {
  const res = await fetch(`/api/lessons/${id}`, { signal });
  const body = (await res.json().catch(() => ({}))) as Partial<LessonResponse> & { error?: string };
  if (!res.ok || !body.lesson) throw new Error(body.error ?? `Could not load the lesson (${res.status}).`);
  return body as LessonResponse;
}
