// The home project on /issues and /discover (lib/record/continuity.ts): read
// on the server, shown first with a short label. Nothing without
// OPENSRCER_RECORD, a session, a database, or a home project.

import Link from "next/link";
import { connection } from "next/server";
import { flagEnabled } from "@/lib/flags";
import { homeProject } from "@/lib/record/continuity";
import { UnknownUserError } from "@/lib/record/standing";
import { sessionUserId } from "@/lib/require-session";
import { optionalDb } from "@/lib/users";

/** The signed-in user's home project (owner/name), or null. */
export async function currentHomeProject(): Promise<string | null> {
  if (!flagEnabled("record")) return null;
  // Per request: sessionUserId swallows the build's "no request" error, so
  // without this the page would be prerendered once with no home project.
  await connection();
  const [userId, db] = await Promise.all([sessionUserId(), optionalDb()]);
  if (!userId || !db) return null;
  try {
    return await homeProject(db, userId);
  } catch (error) {
    // No users row yet: nobody has a home project before their first sign-in completes.
    if (error instanceof UnknownUserError) return null;
    throw error;
  }
}

export function HomeProjectBanner({ home }: { home: string | null }) {
  if (!home) return null;
  return (
    <p className="card mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[15px]">
      <span className="tag" data-tone="ok">your home project</span>
      <span className="font-semibold text-paper">{home}</span>
      <Link href={`/issues?repo=${encodeURIComponent(home)}`} className="row-cta ml-auto">Its open issues <span aria-hidden>→</span></Link>
      <Link href="/account#record-heading" className="text-link text-[13px]">Change</Link>
    </p>
  );
}
