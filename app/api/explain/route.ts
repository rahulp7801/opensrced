// POST /api/explain — "Ask about this change": one plain model call on the
// user's Anthropic key (no tools), answered from the context the page sends,
// or with `runId` / `lessonId` from the caller's own stored run.
// Validation, caps and the prompt live in lib/explain.ts.

import { NextRequest } from "next/server";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { requireSession, sessionUserId } from "@/lib/require-session";
import { anthropicStream } from "@/lib/anthropic-stream";
import { handleExplain } from "@/lib/explain";
import { loadRunChange } from "@/lib/run-change";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleExplain(req, { requireSession, resolveKey: resolveAnthropicKey, stream: anthropicStream,
    loadChange: async (ref) => loadRunChange(await sessionUserId(), ref) });
}
