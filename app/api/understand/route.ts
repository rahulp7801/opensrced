// POST /api/understand — "Explain it in your own words" and "Practice
// review": one plain model call per step on the user's key (no tools).
// Steps, validation, prompts and the strict-JSON checks live in lib/understanding.ts.
// With `runId` / `lessonId` the server loads the run's own change and records
// the outcome, which the publish gate then requires (lib/publish.ts).

import { NextRequest } from "next/server";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { requireSession, sessionUserId } from "@/lib/require-session";
import { anthropicStream } from "@/lib/anthropic-stream";
import { handleUnderstand } from "@/lib/understanding";
import { loadRunChange } from "@/lib/run-change";
import { recordUnderstanding } from "@/lib/understanding-record";

export const maxDuration = 200;
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleUnderstand(req, {
    requireSession, resolveKey: resolveAnthropicKey, stream: anthropicStream,
    loadChange: async (ref) => loadRunChange(await sessionUserId(), ref),
    record: async (runId, event) => {
      // loadChange already checked this owner owns runId.
      const owner = await sessionUserId();
      if (!owner) throw new Error("Not authenticated");
      await recordUnderstanding(owner, runId, event);
    },
  });
}
