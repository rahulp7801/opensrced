// GET /api/crucible/repos/[owner]/[name]/advisories
// Returns the unified advisory+dependabot list for a private repo, provided
// the caller has verified ownership of :owner.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { listAdvisories, listDependabotAlerts } from "@/lib/crucible/advisories";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { owner, name } = await params;
  const mapping = mappingForOrg(sub, owner);
  if (!mapping) {
    return NextResponse.json({ error: "org not connected" }, { status: 404 });
  }

  try {
    const [advisories, dependabot] = await Promise.all([
      listAdvisories(mapping.installation_id, owner, name),
      listDependabotAlerts(mapping.installation_id, owner, name),
    ]);
    // Sort by severity desc, then updatedAt desc.
    const order: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      unknown: 0,
    };
    const findings = [...advisories, ...dependabot].sort((a, b) => {
      const sv = (order[b.severity] ?? 0) - (order[a.severity] ?? 0);
      if (sv !== 0) return sv;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return NextResponse.json({ repo: `${owner}/${name}`, findings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
