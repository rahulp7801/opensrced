// /api/me: the signed-in account's own row (lib/users.ts).
//   GET     the account and its onboarding answers
//   PATCH   save onboarding answers and mark onboarding done; {} skips it
//   DELETE  "Delete my data" (body: {"confirm": "<GitHub login>"}): stop
//           active work and disconnect (lib/revoke-access.ts), erase the
//           account's database rows and stored records (lib/account-data.ts),
//           then the client follows `redirect` to sign out.

import { join } from "node:path";
import { del, list } from "@vercel/blob";
import { deleteLocalUserData, deleteUserBlobs, deleteUserRows } from "@/lib/account-data";
import { cloudExecution } from "@/lib/cloud-run-state";
import { readJsonBody } from "@/lib/request-body";
import { authDisabled, sessionAccount } from "@/lib/require-session";
import { logoutUrl, revokeAccess } from "@/lib/revoke-access";
import { OnboardingInputError, parseOnboarding } from "@/lib/onboarding";
import { completeOnboarding, ensureUser, optionalDb } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthenticated = () => Response.json({ error: "Not authenticated" }, { status: 401 });

/** The database, or null when there is none or it failed to open (logged). */
async function dbOrNull() {
  try {
    return await optionalDb();
  } catch (error) {
    console.error("[me] database unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function GET() {
  const account = await sessionAccount();
  if (!account) return unauthenticated();
  const db = await dbOrNull();
  const row = db ? await ensureUser(db, account.id, account.login) : null;
  return Response.json({
    id: account.id,
    login: account.login,
    database: Boolean(row),
    createdAt: row?.createdAt ?? null,
    onboardedAt: row?.onboardedAt ?? null,
    settings: row?.settings ?? {},
  });
}

export async function PATCH(req: Request) {
  const account = await sessionAccount();
  if (!account) return unauthenticated();
  let answers;
  try {
    answers = parseOnboarding(await readJsonBody(req, 10_000));
  } catch (error) {
    if (error instanceof OnboardingInputError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const db = await dbOrNull();
  if (!db) return Response.json({ error: "Preferences can't be saved on this deployment yet." }, { status: 503 });
  const row = await completeOnboarding(db, account.id, account.login, answers);
  return Response.json({ ok: true, onboardedAt: row.onboardedAt, settings: row.settings });
}

export async function DELETE(req: Request) {
  // Re-check the session here: the confirmation in the page is for the
  // person, this is the authorization.
  const account = await sessionAccount();
  if (!account) return unauthenticated();
  const body = await readJsonBody<{ confirm?: unknown }>(req, 1_000);
  if (typeof body?.confirm !== "string" || body.confirm.trim().toLowerCase() !== account.login.toLowerCase()) {
    return Response.json({ error: `Type your GitHub login (${account.login}) to confirm.` }, { status: 400 });
  }

  try {
    // Stop runs first so no worker writes a record after the erase.
    await revokeAccess(account.id);
    const db = await optionalDb();
    const rows = db ? await deleteUserRows(db, account.id) : 0;
    const records = cloudExecution()
      ? await deleteUserBlobs({ list, del: (paths) => del(paths) }, account.id)
      : deleteLocalUserData(join(process.cwd(), ".dispatches"), account.id);
    return Response.json({ ok: true, rows, records, redirect: authDisabled() ? "/" : logoutUrl() });
  } catch (error) {
    console.error("[me] delete failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Your data could not be fully deleted. Please try again; repeating the delete is safe." }, { status: 503 });
  }
}
