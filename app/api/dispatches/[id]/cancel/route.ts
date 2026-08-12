import { NextResponse } from "next/server";
import { cancelDispatch } from "@/lib/dispatcher";
import { requireSession } from "@/lib/require-session";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const { id } = await ctx.params;
  const result = cancelDispatch(id);
  return NextResponse.json(result, { status: result.ok ? 202 : 404 });
}
