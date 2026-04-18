import { NextResponse } from "next/server";
import { proxy } from "@/lib/api";
import { getSessions } from "@/lib/seed";

export async function GET() {
  const upstream = await proxy<unknown>("/api/sessions");
  if (upstream) return NextResponse.json(upstream);
  return NextResponse.json({ sessions: getSessions() });
}
