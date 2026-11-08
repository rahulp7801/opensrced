// Lessons from the harness (lib/harness-lessons.ts), behind a harness token:
//
//   POST  /api/harness/lessons                  create (issue, README and graph from the checkout)
//   GET   /api/harness/lessons/<id>             the lesson; after the reveal, the key too
//   PATCH /api/harness/lessons/<id>             change path or mode
//   POST  /api/harness/lessons/<id>/answer      {step, answer, grader_reply?}
//   POST  /api/harness/lessons/<id>/hint        {step}
//   POST  /api/harness/lessons/<id>/key         {diff, diagnosis, title, verified}
//   POST  /api/harness/lessons/<id>/reveal      {give_up?}
//   POST  /api/harness/lessons/<id>/diff        {diff} (?submit=1: "I'm done"): path B, their own change

import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { HarnessAuthError, harnessUser } from "@/lib/harness";
import {
  answerHarnessStep, createHarnessLesson, getHarnessLesson, harnessHint, harnessOwnDiff, harnessReveal, harnessUpdate, setHarnessKey,
} from "@/lib/harness-lessons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ path?: string[] }> };
const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const authError = (error: unknown) => {
  if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
};

export async function GET(req: Request, { params }: Params) {
  const db = await getDb();
  let userId: string;
  try { userId = await harnessUser(db, req.headers.get("authorization"), canUse); } catch (error) { return authError(error); }
  const path = (await params).path ?? [];
  return path.length === 1 ? getHarnessLesson(path[0], db, userId) : notFound();
}

export async function PATCH(req: Request, { params }: Params) {
  const db = await getDb();
  let userId: string;
  try { userId = await harnessUser(db, req.headers.get("authorization"), canUse); } catch (error) { return authError(error); }
  const path = (await params).path ?? [];
  return path.length === 1 ? harnessUpdate(req, path[0], db, userId) : notFound();
}

export async function POST(req: Request, { params }: Params) {
  const db = await getDb();
  let userId: string;
  try { userId = await harnessUser(db, req.headers.get("authorization"), canUse); } catch (error) { return authError(error); }
  const [id, action, ...rest] = (await params).path ?? [];
  if (rest.length) return notFound();
  if (!id) return createHarnessLesson(req, db, userId);
  switch (action) {
    case "answer": return answerHarnessStep(req, id, db, userId);
    case "hint": return harnessHint(req, id, db, userId);
    case "key": return setHarnessKey(req, id, db, userId);
    case "reveal": return harnessReveal(req, id, db, userId);
    case "diff": {
      // {diff, submit?}: the body is read once, by saveIdeDiff; submit rides in the query.
      return harnessOwnDiff(req, id, db, userId, new URL(req.url).searchParams.get("submit") === "1");
    }
    default: return notFound();
  }
}
