// POST /api/class/join {code} — join a class through its invite link
// (lib/classes.ts). Public in the preview gate (middleware.ts), since the
// caller isn't admitted yet; it needs a GitHub session of its own.
import { auth0 } from "@/lib/auth0";
import { ClassClosedError, ClassNotFoundError, joinClass } from "@/lib/classes";
import { getDb } from "@/lib/db/client";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  const session = await auth0.getSession().catch(() => null);
  const sub = session?.user?.sub;
  // The GitHub login, as lib/require-session.ts sessionAccount reads it.
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const login = text(session?.user?.nickname) ?? text(session?.user?.name) ?? sub ?? "";
  if (!sub || !/^github\|\d+$/.test(sub)) return Response.json({ error: "Sign in with GitHub first." }, { status: 401, headers: NO_STORE });
  const body = await readJsonBody<{ code?: unknown }>(req, 1_000);
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  try {
    const invite = await joinClass(await getDb(), code, sub, login);
    return Response.json({ name: invite.name }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ClassNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: NO_STORE });
    if (error instanceof ClassClosedError) return Response.json({ error: error.message }, { status: 409, headers: NO_STORE });
    throw error;
  }
}
