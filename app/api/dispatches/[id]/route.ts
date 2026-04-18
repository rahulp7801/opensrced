import { NextRequest, NextResponse } from "next/server";
import { getDispatch, readLog } from "@/lib/dispatcher";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const d = getDispatch(id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  const log = readLog(id);
  return NextResponse.json({ ...d, log });
}
