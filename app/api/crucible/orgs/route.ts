// GET /api/crucible/orgs — list verified orgs for the current Auth0 user.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { canUse } from "@/lib/access-server";
import { listOrgsFor } from "@/lib/crucible/orgs";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth0.getSession();
  // Invite rule enforced here too, not only in middleware.
  const sub = await canUse(session?.user?.sub) ? session?.user?.sub : undefined;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ orgs: await listOrgsFor(sub) });
}
