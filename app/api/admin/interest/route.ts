// /api/admin/interest — manage early-access requests (app/admin/access). Admins only
// (OPENSRCER_ADMIN_GITHUB_IDS, lib/access.ts). GET lists them (?format=csv to download),
// PATCH sets one's status (approving admits that GitHub account), DELETE removes one.
import { auth0 } from "@/lib/auth0";
import { isAdmin } from "@/lib/access-server";
import { authDisabled } from "@/lib/require-session";
import {
  INTEREST_STATUSES, InterestNotFoundError, listRequests, lookupGithubId, removeRequest, requestsCsv, setRequestStatus, updateRequests,
  type InterestRequest, type InterestStatus,
} from "@/lib/interest";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Null when the caller is an admin; otherwise the response to return. */
async function requireAdmin(): Promise<Response | null> {
  if (authDisabled()) return null;
  try {
    const session = await auth0.getSession();
    if (!session?.user) return Response.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
    return isAdmin(session.user.sub) ? null : Response.json({ error: "Admins only." }, { status: 403, headers: NO_STORE });
  } catch {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let list: InterestRequest[];
  try {
    list = (await listRequests()).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    console.error("[interest] could not read requests", error);
    return Response.json({ error: "Couldn't read the requests from storage. Try again in a moment." }, { status: 503, headers: NO_STORE });
  }
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response(requestsCsv(list), { headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="opensrcer-access-requests.csv"' } });
  }
  return Response.json({ requests: list }, { headers: NO_STORE });
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readBody(req);
  const id = typeof body?.id === "string" ? body.id : "";
  const status = body?.status as InterestStatus;
  if (!id || !INTEREST_STATUSES.includes(status)) return Response.json({ error: "Send an id and a status (new, approved or declined)." }, { status: 400, headers: NO_STORE });

  // Approving needs the account's numeric id; look it up now if sign-up couldn't.
  let githubId: number | undefined;
  if (status === "approved") {
    const all = await listRequests().catch(() => null);
    if (!all) return Response.json({ error: "Couldn't read the requests from storage. Try again in a moment." }, { status: 503, headers: NO_STORE });
    const request = all.find((r: InterestRequest) => r.id === id);
    if (!request) return Response.json({ error: "That request no longer exists." }, { status: 404, headers: NO_STORE });
    if (request.githubId === null) {
      try {
        githubId = (await lookupGithubId(request.github)) ?? undefined;
      } catch {
        return Response.json({ error: `GitHub has no account @${request.github}, so it can't be approved.` }, { status: 422, headers: NO_STORE });
      }
      if (githubId === undefined) return Response.json({ error: `Couldn't reach GitHub to look up @${request.github}. Try again in a minute.` }, { status: 502, headers: NO_STORE });
    }
  }
  try {
    await updateRequests((list) => setRequestStatus(list, id, status, new Date().toISOString(), githubId));
  } catch (error) {
    if (error instanceof InterestNotFoundError) return Response.json({ error: "That request no longer exists." }, { status: 404, headers: NO_STORE });
    console.error("[interest] could not update requests", error);
    return Response.json({ error: "Couldn't save that change to storage. Try again in a moment." }, { status: 503, headers: NO_STORE });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await readBody(req);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return Response.json({ error: "Send the id to remove." }, { status: 400, headers: NO_STORE });
  try {
    await updateRequests((list) => removeRequest(list, id));
  } catch (error) {
    if (error instanceof InterestNotFoundError) return Response.json({ error: "That request no longer exists." }, { status: 404, headers: NO_STORE });
    console.error("[interest] could not update requests", error);
    return Response.json({ error: "Couldn't save that change to storage. Try again in a moment." }, { status: 503, headers: NO_STORE });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}
