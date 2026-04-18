// GET /api/crucible/orgs — list verified orgs for the current Auth0 user.

import { NextResponse } from "next/server";
import { getSession } from "@auth0/nextjs-auth0";
import { listOrgsFor } from "@/lib/crucible/orgs";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ orgs: listOrgsFor(sub) });
}
