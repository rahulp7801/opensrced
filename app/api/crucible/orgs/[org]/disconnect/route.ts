// Disconnect only this user; other members and the installation remain connected.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { mappingForOrg, deleteMappingsForUser } from "@/lib/crucible/orgs";
import { clearInstallationToken } from "@/lib/crucible/github-app";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ org: string }> },
) {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { org } = await params;
  const mapping = await mappingForOrg(sub, org);
  if (!mapping) {
    return NextResponse.json({ error: "org not connected" }, { status: 404 });
  }

  await deleteMappingsForUser(sub, mapping.installation_id);
  clearInstallationToken(mapping.installation_id);

  return NextResponse.json({
    ok: true,
    disconnected: org,
    message: `Disconnected from ${org}. The GitHub App is still installed on the org — an org admin can uninstall it from GitHub settings if needed.`,
  });
}
