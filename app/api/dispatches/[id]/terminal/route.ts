// GET  /api/dispatches/<id>/terminal   the sign-in terminal's output (a byte stream)
// POST /api/dispatches/<id>/terminal   bytes the user typed or pasted
//
// Hosted Claude-plan runs: the run page's web terminal, attached to
// `claude auth login` in the run's own VM (lib/hosted-sign-in.ts). This route
// only checks who is asking and forwards the bytes; it never reads, parses,
// logs or stores them (lib/cloud-runs.ts proxySignInTerminal).

import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { proxySignInTerminal } from "@/lib/cloud-runs";
import { hostedSubscriptionEnabled } from "@/lib/run-payment";
import { MAX_TTY_INPUT_BYTES } from "@/lib/hosted-sign-in";

// The output stream stays open while the user signs in; the page reconnects
// when it ends.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function forward(req: Request, ctx: Ctx, method: "GET" | "POST") {
  const viewerId = await sessionUserId();
  if (!viewerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hostedSubscriptionEnabled()) return NextResponse.json({ error: "Hosted sign-in is not enabled on this deployment." }, { status: 404 });
  if (method === "POST" && !(Number(req.headers.get("content-length")) <= MAX_TTY_INPUT_BYTES)) {
    return NextResponse.json({ error: "Too much input at once." }, { status: 413 });
  }
  const { id } = await ctx.params;
  try {
    const response = await proxySignInTerminal(viewerId, id, { method, body: method === "POST" ? req.body : null, signal: req.signal });
    return response ?? NextResponse.json({ error: "This run is not waiting for a sign-in." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not reach the run's worker. Try again." }, { status: 503 });
  }
}

export function GET(req: Request, ctx: Ctx) { return forward(req, ctx, "GET"); }
export function POST(req: Request, ctx: Ctx) { return forward(req, ctx, "POST"); }
