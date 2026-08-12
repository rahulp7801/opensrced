// GET /api/crucible/repos/[owner]/[name]/issues
// Installation-tokened issue list (excludes PRs).

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { listInstallationIssues } from "@/lib/crucible/advisories";
import { sanitizeGitHubName } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = await params;
  // Interpolated into a GitHub API URL — validate the shape first.
  const owner = sanitizeGitHubName(raw.owner);
  const name = sanitizeGitHubName(raw.name);
  if (!owner || !name) {
    return NextResponse.json({ error: "invalid repo" }, { status: 400 });
  }

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
