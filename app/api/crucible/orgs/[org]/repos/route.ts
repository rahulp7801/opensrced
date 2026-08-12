// GET /api/crucible/orgs/[org]/repos
// Session-gated (middleware handles the Auth0 check). Returns the list of
// private repos the installation can see, filtered by whether the caller's
// auth0_user_id actually verified this org.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { listInstallationRepos } from "@/lib/crucible/advisories";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ org: string }> },
) {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { org } = await params;
  const mapping = mappingForOrg(sub, org);
  if (!mapping) {
    return NextResponse.json({ error: "org not connected" }, { status: 404 });
  }

  try {
    const repos = await listInstallationRepos(mapping.installation_id);
    return NextResponse.json({ org, repos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
