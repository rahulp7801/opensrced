// POST /api/understand — "Explain it in your own words" and "Practice
// review": one plain model call per step on the user's key (no tools).
// Steps, validation, prompts and the strict-JSON checks live in lib/understanding.ts.

import { NextRequest } from "next/server";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/require-session";
import { anthropicStream } from "@/lib/anthropic-stream";
import { handleUnderstand } from "@/lib/understanding";

export const maxDuration = 200;
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleUnderstand(req, { requireSession, resolveKey: resolveAnthropicKey, stream: anthropicStream });
}
