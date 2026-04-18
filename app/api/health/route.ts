import { NextResponse } from "next/server";
import { proxy } from "@/lib/api";
import { getHealth } from "@/lib/seed";

export async function GET() {
  const upstream = await proxy<unknown>("/api/health");
  if (upstream) return NextResponse.json(upstream);
  return NextResponse.json(getHealth());
}
