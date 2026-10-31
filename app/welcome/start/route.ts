// GET /welcome/start?returnTo=…: every sign-in lands here (lib/auth0.ts
// onCallback). It records the account in the users table, sends a first-time
// account to /welcome once, and everyone else straight on to `returnTo`.
// Nothing here may block sign-in: without a database (or if it fails) the
// user just continues. A page path rather than /api/, so middleware answers
// an account without a preview invite with the invite notice, not JSON.
// The database is touched here, not in the page: awaiting PGlite inside a
// server component breaks React's dev-mode render stream.

import { NextResponse, type NextRequest } from "next/server";
import { sessionAccount } from "@/lib/require-session";
import { safeReturnTo } from "@/lib/safe-return-to";
import { ensureUser, optionalDb } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo") ?? undefined);
  let next = returnTo;
  const account = await sessionAccount();
  if (!account) return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, req.url));
  try {
    const db = await optionalDb();
    const row = db ? await ensureUser(db, account.id, account.login) : null;
    if (row && !row.onboardedAt) next = `/welcome?returnTo=${encodeURIComponent(returnTo)}`;
  } catch (error) {
    console.error("[welcome] database unavailable, skipping onboarding:", error instanceof Error ? error.message : error);
  }
  return NextResponse.redirect(new URL(next, req.url));
}
