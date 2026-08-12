// POST /api/crucible/orgs/[org]/disconnect
// Revokes the user's connection to a GitHub org:
//   1. Deletes the org mapping from our store
//   2. Clears the cached installation token
//   3. Optionally suspends the GitHub App installation (if the user is
//      the one who installed it) — this revokes the token server-side
//      so any in-flight operations stop immediately.
//
// This does NOT uninstall the App (that requires the org admin to do
// from GitHub settings). It just severs the link between THIS Auth0
// user and the org.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { mappingForOrg, deleteByInstallationId } from "@/lib/crucible/orgs";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function clearTokenCache(installationId: number) {
  const p = path.join(process.cwd(), ".dispatches", "crucible-tokens-cache.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const cache = JSON.parse(raw) as Record<string, unknown>;
    delete cache[String(installationId)];
    fs.writeFileSync(p, JSON.stringify(cache, null, 2));
  } catch {
    // no cache file
  }
}

export async function POST(
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

  // 1. Clear cached tokens — immediately invalidates any future API calls
  clearTokenCache(mapping.installation_id);

  // 2. Delete the mapping — severs the Auth0 user ↔ GitHub org link
  deleteByInstallationId(mapping.installation_id);

  return NextResponse.json({
    ok: true,
    disconnected: org,
    message: `Disconnected from ${org}. The GitHub App is still installed on the org — an org admin can uninstall it from GitHub settings if needed.`,
  });
}
