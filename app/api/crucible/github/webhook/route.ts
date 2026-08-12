// GitHub App webhook receiver. We only care about:
//   - installation.created     → upgrade the mapping with installer login
//                                 (install-callback already wrote the row,
//                                  but didn't know sender.login then)
//   - installation.deleted     → drop the mapping + cached tokens
//
// Signature verification is required — treat any failure as 401.

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { deleteByInstallationId } from "@/lib/crucible/orgs";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex");
  // timingSafeEqual requires equal lengths; guard first.
  if (digest.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function clearTokenCache(installationId: number) {
  const p = path.join(process.cwd(), ".dispatches", "crucible-tokens-cache.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const cache = JSON.parse(raw) as Record<string, unknown>;
    delete cache[String(installationId)];
    fs.writeFileSync(p, JSON.stringify(cache, null, 2));
  } catch {
    // no cache file yet, nothing to clear
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event !== "installation") {
    // We don't subscribe to anything else; be permissive.
    return NextResponse.json({ ok: true, ignored: event });
  }

  const payload = JSON.parse(body) as {
    action: string;
    installation?: {
      id: number;
      account: { login: string; type: string };
    };
    sender?: { login: string };
  };

  const installationId = payload.installation?.id;
  if (!installationId) return NextResponse.json({ ok: true });

  if (payload.action === "deleted") {
    deleteByInstallationId(installationId);
    clearTokenCache(installationId);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  if (payload.action === "created") {
    // Nothing to do. install-callback records the mapping only after it has
    // verified, against the org's own membership API, that the caller is an
    // active admin — and it stores that verified login as `installer`.
    // Overwriting it here with the webhook's `sender.login` would replace a
    // checked value with an unchecked one.
    return NextResponse.json({ ok: true, action: "created" });
  }

  return NextResponse.json({ ok: true, action: payload.action });
}
