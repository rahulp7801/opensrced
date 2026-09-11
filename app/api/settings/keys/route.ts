// GET /api/settings/keys — check which keys are configured (never returns values)
// POST /api/settings/keys — save API keys to encrypted cookie
// DELETE /api/settings/keys — clear all stored keys

import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getStoredKeys, setStoredKeys, clearStoredKeys } from "@/lib/api-keys";
import { validStoredKeys } from "@/lib/key-cookie";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const keys = await getStoredKeys();
  return NextResponse.json({
    anthropic: Boolean(keys.anthropic),
    gemini: Boolean(keys.gemini),
    maxSpendUsd: keys.maxSpendUsd ?? 2,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    anthropic?: string;
    gemini?: string;
    maxSpendUsd?: number;
  };
  if (!validStoredKeys(body)) {
    return NextResponse.json({ error: "Keys must be at most 512 printable characters; the task budget must be between $0.10 and $10." }, { status: 400 });
  }

  const existing = await getStoredKeys();
  const updated = { ...existing };

  // Only update keys that are explicitly provided. Empty string = clear that key.
  if (body.anthropic !== undefined) {
    updated.anthropic = body.anthropic || undefined;
  }
  if (body.gemini !== undefined) {
    updated.gemini = body.gemini || undefined;
  }
  if (typeof body.maxSpendUsd === "number" && body.maxSpendUsd > 0) {
    updated.maxSpendUsd = body.maxSpendUsd;
  }

  await setStoredKeys(updated);
  return NextResponse.json({
    ok: true,
    anthropic: Boolean(updated.anthropic),
    gemini: Boolean(updated.gemini),
    maxSpendUsd: updated.maxSpendUsd ?? 2,
  });
}

export async function DELETE() {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  await clearStoredKeys();
  return NextResponse.json({ ok: true });
}
