import { NextResponse } from "next/server";
import { cancelDispatch } from "@/lib/dispatcher";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const result = cancelDispatch(id);
  return NextResponse.json(result, { status: result.ok ? 202 : 404 });
}
