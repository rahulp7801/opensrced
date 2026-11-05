// /api/me/tokens: the signed-in account's harness tokens (lib/harness.ts).
//   GET   live tokens (names and dates, never the token)
//   POST  {"name": "laptop"} → the new token, shown this once

import { getDb } from "@/lib/db/client";
import { createToken, HarnessInputError, listTokens, TokenLimitError } from "@/lib/harness";
import { readJsonBody } from "@/lib/request-body";
import { sessionAccount } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const account = await sessionAccount();
  if (!account) return Response.json({ error: "Not authenticated" }, { status: 401 });
  return Response.json({ tokens: await listTokens(await getDb(), account.id) });
}

export async function POST(req: Request) {
  const account = await sessionAccount();
  if (!account) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = await readJsonBody<{ name?: unknown }>(req);
  if (!body) return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  try {
    const name = body.name;
    const created = await createToken(await getDb(), account.id, account.login, typeof name === "string" ? name : "");
    return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HarnessInputError || error instanceof TokenLimitError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
