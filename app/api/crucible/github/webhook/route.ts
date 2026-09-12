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
import { readTextBody } from "@/lib/request-body";

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

export async function POST(req: NextRequest) {
  const body = await readTextBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid webhook body" }, { status: 400 });
  }
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event !== "installation") {
    // We don't subscribe to anything else; be permissive.
    return NextResponse.json({ ok: true, ignored: event });
  }

  let payload: {
    action: string;
    installation?: {
      id: number;
      account: { login: string; type: string };
    };
    sender?: { login: string };
  };
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { action?: unknown }).action !== "string") {
      throw new Error("invalid payload");
    }
    payload = parsed as typeof payload;
  } catch {
    return NextResponse.json({ error: "invalid webhook JSON" }, { status: 400 });
  }

  const installationId = payload.installation?.id;
  if (typeof installationId !== "number" || !Number.isSafeInteger(installationId) || installationId < 1) return NextResponse.json({ ok: true });

  if (payload.action === "deleted") {
    await deleteByInstallationId(installationId);
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
