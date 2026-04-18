// GET /api/crucible/repos/[owner]/[name]/issues
// Installation-tokened issue list (excludes PRs).

import { NextResponse } from "next/server";
import { getSession } from "@auth0/nextjs-auth0";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { listInstallationIssues } from "@/lib/crucible/advisories";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const session = await getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { owner, name } = await params;
  const mapping = mappingForOrg(sub, owner);
  if (!mapping) {
    return NextResponse.json({ error: "org not connected" }, { status: 404 });
  }

  try {
    const issues = await listInstallationIssues(mapping.installation_id, owner, name);
    return NextResponse.json({ repo: `${owner}/${name}`, issues });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
