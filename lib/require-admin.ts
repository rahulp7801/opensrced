// The admin check for /api/admin/* routes: OPENSRCER_ADMIN_GITHUB_IDS (lib/access-server.ts isAdmin).
import { auth0 } from "./auth0";
import { isAdmin } from "./access-server";
import { authDisabled } from "./require-session";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** The admin's subject, or the response to return instead. */
export async function requireAdmin(): Promise<{ sub: string } | Response> {
  if (authDisabled()) return { sub: "local-dev" };
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  return isAdmin(session.user.sub) ? { sub: session.user.sub } : Response.json({ error: "Admins only." }, { status: 403, headers: NO_STORE });
}
