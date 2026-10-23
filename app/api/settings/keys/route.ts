import { readJsonBody } from "@/lib/request-body";
// GET /api/settings/keys — which keys are configured (never returns values),
//   how runs are paid for, and which subscriptions this machine can use
//   (?recheck=1 re-runs the CLI status checks)
// POST /api/settings/keys — save API keys and payment preferences to the encrypted cookie
// DELETE /api/settings/keys — clear all stored keys

import { NextRequest, NextResponse } from "next/server";
import { getStoredKeys, setStoredKeys, clearStoredKeys, type StoredKeys } from "@/lib/api-keys";
import { validStoredKeys } from "@/lib/key-cookie";
import { requireSession } from "@/lib/require-session";
import {
  choosePayment, currentAvailability, hostLoginsAllowed, hostedSubscriptionEnabled,
  normalizeOrder, NoRunCredentialError, offeredProviders,
} from "@/lib/run-payment";

export const dynamic = "force-dynamic";

async function status(keys: StoredKeys, recheck = false) {
  const order = normalizeOrder(keys.providerOrder);
  const keyFallback = keys.keyFallback === true;
  const offered = offeredProviders();
  const availability = await currentAvailability(recheck);
  let ready = true;
  let problem: string | undefined;
  try { choosePayment({ order, keyFallback }, offered, availability, keys.anthropic || null); }
  catch (error) {
    if (!(error instanceof NoRunCredentialError)) throw error;
    ready = false;
    problem = error.message;
  }
  return {
    anthropic: Boolean(keys.anthropic),
    gemini: Boolean(keys.gemini),
    maxSpendUsd: keys.maxSpendUsd ?? 2,
    providerOrder: order,
    keyFallback,
    // Can the next run start, and if not, why.
    ready,
    problem,
    offered,
    availability,
    local: hostLoginsAllowed(),
    hostedSubscription: hostedSubscriptionEnabled(),
  };
}

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  return NextResponse.json(await status(await getStoredKeys(), req.nextUrl.searchParams.get("recheck") === "1"));
}

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const body = await readJsonBody<{
    anthropic?: string;
    gemini?: string;
    maxSpendUsd?: number;
    providerOrder?: string[];
    keyFallback?: boolean;
  }>(req);
  if (!validStoredKeys(body)) {
    return NextResponse.json({ error: "Keys must be at most 512 printable characters; the task budget must be between $0.10 and $10; the payment order must list known methods once each." }, { status: 400 });
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
  if (body.providerOrder !== undefined) updated.providerOrder = normalizeOrder(body.providerOrder);
  if (body.keyFallback !== undefined) updated.keyFallback = body.keyFallback;

  await setStoredKeys(updated);
  return NextResponse.json({ ok: true, ...(await status(updated)) });
}

export async function DELETE() {
  const unauth = await requireSession();
  if (unauth) return unauth;

  await clearStoredKeys();
  return NextResponse.json({ ok: true });
}
