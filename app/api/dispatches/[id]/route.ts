// GET /api/dispatches/<id>[?since=<bytes>]
//
// Without `since`, returns the dispatch plus the log tail (legacy shape).
// With `since`, returns only the bytes written after that offset — the
// client appends and passes back `log_size` on the next poll. A running
// dispatch is polled every 1.5s; shipping the whole log each time was up
// to 200KB per poll of content the client already had.
//
// `log_reset: true` means "replace, don't append" — the log was truncated,
// or the client fell so far behind that it's getting a tail instead.

import { NextRequest, NextResponse } from "next/server";
import { getDispatch, readLogSince } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const viewerId = await sessionUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // getDispatch returns undefined for "no such id" and "not yours" alike,
  // so the 404 below doesn't confirm that someone else's dispatch exists.
  const d = getDispatch(id, viewerId);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = Number(sinceRaw);
  const { chunk, size, reset } = readLogSince(
    id,
    Number.isFinite(since) && since > 0 ? since : 0,
  );

  return NextResponse.json({
    ...d,
    log: chunk,
    log_size: size,
    log_reset: reset,
  });
}
