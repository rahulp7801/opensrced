// /api/admin/classes — class invite links (lib/classes.ts) for the admins in
// OPENSRCER_ADMIN_GITHUB_IDS. GET lists them, POST {name, maxUses, days}
// creates one, DELETE ?code= turns one off (its members lose access).
import { auth0 } from "@/lib/auth0";
import { isAdmin } from "@/lib/access-server";
import { authDisabled } from "@/lib/require-session";
import { ClassInputError, ClassNotFoundError, createClassInvite, listClassInvites, revokeClassInvite } from "@/lib/classes";
import { getDb } from "@/lib/db/client";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** The admin's subject, or the response to return. */
async function requireAdmin(): Promise<{ sub: string } | Response> {
  if (authDisabled()) return { sub: "local-dev" };
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  return isAdmin(session.user.sub) ? { sub: session.user.sub } : Response.json({ error: "Admins only." }, { status: 403, headers: NO_STORE });
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  return Response.json({ invites: await listClassInvites(await getDb()) }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const body = await readJsonBody<Record<string, unknown>>(req, 2_000);
  if (!body) return Response.json({ error: "Send {name, maxUses, days}." }, { status: 400, headers: NO_STORE });
  try {
    const invite = await createClassInvite(await getDb(), { name: body.name, maxUses: body.maxUses, days: body.days }, admin.sub);
    return Response.json({ invite }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ClassInputError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE });
    throw error;
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const code = new URL(req.url).searchParams.get("code") ?? "";
  try {
    await revokeClassInvite(await getDb(), code);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ClassNotFoundError) return Response.json({ error: "No class link with that code." }, { status: 404, headers: NO_STORE });
    throw error;
  }
}
