// POST /api/dispatches/<id>/sign-in  { code }
//
// Hosted subscription runs: relay the one-time code Anthropic's sign-in page
// showed the user into their run's VM (lib/hosted-sign-in.ts). The code is
// single-use and only ever in flight: it is not logged, stored, or echoed.

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";
import { relaySignInCode } from "@/lib/cloud-runs";
import { hostedSubscriptionEnabled } from "@/lib/run-payment";
import { validSignInCode } from "@/lib/hosted-sign-in";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const viewerId = await sessionUserId();
  if (!viewerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hostedSubscriptionEnabled()) return NextResponse.json({ error: "Hosted sign-in is not enabled on this deployment." }, { status: 404 });

  const body = await readJsonBody<{ code?: unknown }>(req);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!validSignInCode(code)) return NextResponse.json({ error: "Paste the code exactly as Claude showed it." }, { status: 400 });

  const { id } = await ctx.params;
  try {
    const ok = await relaySignInCode(viewerId, id, code);
    return ok
      ? NextResponse.json({ ok: true }, { status: 202 })
      : NextResponse.json({ error: "This run is not waiting for a sign-in." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not reach the run's worker. Try again." }, { status: 503 });
  }
}
