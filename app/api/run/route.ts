import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const upstream = await proxy<unknown>("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (upstream) return NextResponse.json(upstream, { status: 202 });
  return NextResponse.json(
    {
      status: "accepted",
      message: "Pipeline run queued. Observatory will reflect progress in /api/runs.",
      queued_at: new Date().toISOString(),
      mode: body?.dry_run ? "dry-run" : "live",
    },
    { status: 202 },
  );
}
