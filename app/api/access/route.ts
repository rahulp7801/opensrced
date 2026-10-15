// GET /api/access — whether the caller may use the app during the private
// preview. Public on purpose (signed-out and not-invited callers ask too);
// it reveals nothing beyond the caller's own status. See lib/access.ts.
import { auth0 } from "@/lib/auth0";
import { hasAccess, inviteOnly } from "@/lib/access";
import { authDisabled } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  let signedIn = authDisabled();
  let invited = authDisabled() || !inviteOnly();
  if (!authDisabled()) {
    try {
      const session = await auth0.getSession();
      signedIn = Boolean(session?.user);
      invited = signedIn && hasAccess(session?.user?.sub);
    } catch {
      // No usable session: report signed out.
    }
  }
  return Response.json({ inviteOnly: inviteOnly(), signedIn, invited }, { headers: { "Cache-Control": "no-store" } });
}
