// GET /api/fixes/[id] — retrieve a shared fix by ID

import { NextRequest } from "next/server";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { del } from "@vercel/blob";

import { readJson } from "@/lib/blob-store";
import { cloudExecution } from "@/lib/cloud-run-state";
import { sharedFixExpired, validSharedFix } from "@/lib/shared-fix";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");
const PRIVATE_RESPONSE = { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, ...PRIVATE_RESPONSE });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return json({ error: "Fix not found" }, 404);
  if (cloudExecution()) {
    try {
      const fix = await readJson<unknown>(`shares/${id}.json`);
      if (!fix || !validSharedFix(fix.value, id)) return json({ error: "Fix not found" }, 404);
      if (sharedFixExpired(fix.value)) {
        try { await del(`shares/${id}.json`, { ifMatch: fix.etag, abortSignal: AbortSignal.timeout(15_000) }); } catch { /* best effort */ }
        return json({ error: "Fix not found" }, 404);
      }
      return json(fix.value);
    } catch { return json({ error: "This fix is temporarily unavailable. Please retry." }, 503); }
  }
  const safeId = id;
  const filePath = join(FIXES_DIR, `${safeId}.json`);

  if (!existsSync(filePath)) {
    return json({ error: "Fix not found" }, 404);
  }

  try {
    const data: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!validSharedFix(data, id)) return json({ error: "Fix not found" }, 404);
    if (sharedFixExpired(data)) {
      try { rmSync(filePath, { force: true }); } catch { /* best effort */ }
      return json({ error: "Fix not found" }, 404);
    }
    return json(data);
  } catch {
    return json({ error: "This fix is temporarily unavailable. Please retry." }, 503);
  }
}
