// DELETE /api/me/tokens/<id>: revoke one of the signed-in account's harness tokens.

import { getDb } from "@/lib/db/client";
import { revokeToken, TokenNotFoundError } from "@/lib/harness";
import { sessionAccount } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await sessionAccount();
  if (!account) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "No such token." }, { status: 404 });
  try {
    await revokeToken(await getDb(), account.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof TokenNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
