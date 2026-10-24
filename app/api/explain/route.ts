// POST /api/explain — "Ask about this change": one plain model call on the
// user's Anthropic key, answered from the context the page sends (no tools).
// Validation, caps and the prompt live in lib/explain.ts.

import { NextRequest } from "next/server";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/require-session";
import { anthropicStream } from "@/lib/anthropic-stream";
import { handleExplain } from "@/lib/explain";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleExplain(req, { requireSession, resolveKey: resolveAnthropicKey, stream: anthropicStream });
}
