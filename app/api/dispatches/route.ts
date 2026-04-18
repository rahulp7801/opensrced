import { NextResponse } from "next/server";
import { listDispatches } from "@/lib/dispatcher";

export async function GET() {
  return NextResponse.json({ dispatches: listDispatches() });
}
