// GET /api/access — whether the caller may use the app during the private
// preview. Public on purpose (signed-out and not-invited callers ask too);
// it reveals nothing beyond the caller's own status. See lib/access.ts.
import { auth0 } from "@/lib/auth0";
import { inviteOnly } from "@/lib/access";
import { canUse } from "@/lib/access-server";
import { authDisabled } from "@/lib/require-session";
import { isClassMember } from "@/lib/classes";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  let signedIn = authDisabled();
  let invited = authDisabled() || !inviteOnly();
  // In a class (lib/classes.ts): the site hides its hosted-run setup prompts from students.
  let student = false;
  if (!authDisabled()) {
    try {
      const session = await auth0.getSession();
      signedIn = Boolean(session?.user);
      invited = signedIn && await canUse(session?.user?.sub);
      const sub = session?.user?.sub;
      if (sub) student = await isClassMember(await getDb(), sub).catch(() => false);
    } catch {
      // No usable session: report signed out.
    }
  }
  return Response.json({ inviteOnly: inviteOnly(), signedIn, invited, student }, { headers: { "Cache-Control": "no-store" } });
}
