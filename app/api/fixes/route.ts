// POST /api/fixes — save a fix and return a shareable ID
//
// There is deliberately no GET here. This route used to expose a listing of
// the 20 most recent shares — id, repo, PR number — to anyone at all, since
// /api/fixes is public so that shared /fix/<id> links resolve without a
// login. That turned "share this link with whoever you choose" into "anyone
// can enumerate what everybody shared", and GET /api/fixes/<id> hands back
// the full comment body and diff. Nothing in the UI consumed the listing.

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");

// Hard ceiling on stored fixes. Without it an authenticated client can grow
// .fixes/ without bound — one small JSON per call, no natural expiry.
// Eviction is oldest-first by mtime: ids are random UUIDs now, so a filename
// sort would evict an arbitrary fix rather than the stalest one.
const MAX_FIXES = 1000;

function ensureDir() {
  if (!existsSync(FIXES_DIR)) mkdirSync(FIXES_DIR, { recursive: true });
}

function evictOldest() {
  try {
    const files = readdirSync(FIXES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, mtime: statSync(join(FIXES_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    for (const { f } of files.slice(0, files.length - MAX_FIXES)) {
      rmSync(join(FIXES_DIR, f), { force: true });
    }
  } catch {
    /* best effort — never block a write on cleanup */
  }
}

export async function POST(req: NextRequest) {
  // Writes are authenticated; reads of a specific id stay public so shared
  // /fix/<id> links work for anyone the user sends them to.
  const unauth = await requireSession();
  if (unauth) return unauth;

  const body = (await req.json().catch(() => ({}))) as {
    repo?: string;
    pr_number?: number;
    comment_body?: string;
    fix_response?: string;
    diff?: string;
    explainer?: string;
  };

  if (!body.fix_response || !body.repo) {
    return Response.json({ error: "Missing fix_response or repo" }, { status: 400 });
  }

  ensureDir();
  // Full UUID, not an 8-char slice. The id IS the access control for a
  // public share link: 8 hex chars is 32 bits, brute-forceable in minutes
  // against an endpoint that answers 404 vs 200. Eviction still sorts
  // oldest-first by name, which no longer tracks creation order, so sort by
  // mtime there instead — see evictOldest's ponytail note.
  const id = randomUUID();
  const fix = {
    id,
    repo: body.repo,
    pr_number: body.pr_number ?? null,
    comment_body: body.comment_body?.slice(0, 500) ?? null,
    fix_response: body.fix_response.slice(0, 10_000),
    diff: body.diff?.slice(0, 10_000) ?? null,
    explainer: body.explainer?.slice(0, 2_000) ?? null,
    created_at: new Date().toISOString(),
  };

  writeFileSync(join(FIXES_DIR, `${id}.json`), JSON.stringify(fix, null, 2));
  evictOldest();

  return Response.json({ id, url: `/fix/${id}` });
}
