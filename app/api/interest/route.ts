// POST /api/interest — the public early-access form (app/join). Public on purpose:
// it's for people without an invite. Stores name, email and GitHub username privately
// (lib/interest.ts); nothing is granted until an admin approves at /admin/access.
import { InterestFullError, InterestInputError, lookupGithubId, normalizeInterest, updateRequests, upsertRequest } from "@/lib/interest";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "That request is too large." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new SyntaxError("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Please send the form's fields." }, { status: 400 });
  }
  // A field people never see; bots fill it in. Answer as if it worked, store nothing.
  if (typeof body.website === "string" && body.website.trim()) return Response.json({ ok: true });

  try {
    const fields = normalizeInterest(body);
    const githubId = await lookupGithubId(fields.github);
    await updateRequests((list) => upsertRequest(list, { ...fields, githubId }, new Date().toISOString(), crypto.randomUUID()));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InterestInputError) return Response.json({ error: error.message, field: error.field }, { status: 400 });
    if (error instanceof InterestFullError) return Response.json({ error: error.message }, { status: 503 });
    console.error("[interest] could not save a request", error);
    return Response.json({ error: "We couldn't save your request. Please try again." }, { status: 500 });
  }
}
