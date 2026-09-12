import { readJsonBody } from "@/lib/request-body";
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
import { existsSync, mkdirSync, writeFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sessionUserId } from "@/lib/require-session";

import { del, list, put } from "@vercel/blob";
import { privateJsonOptions } from "@/lib/blob-store";
import { cloudExecution } from "@/lib/cloud-run-state";
import { parseRunTarget } from "@/lib/run-target";
import { newSharedFixId, sharedFixOwnerPrefix, sharedFixPath, SHARED_FIX_RETENTION_MS, staleSharedFixPaths } from "@/lib/shared-fix";
import { sensitiveTextKind } from "@/lib/sensitive-text";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");

// Hard ceiling on local stored fixes. Eviction is oldest-first by mtime so
// legacy UUIDs and current scoped IDs share one predictable rule.
const MAX_FIXES = 1000;
const CLEANUP_BATCH_SIZE = 100;

function ensureDir() {
  if (!existsSync(FIXES_DIR)) mkdirSync(FIXES_DIR, { recursive: true });
}

function evictOldest() {
  try {
    const files = readdirSync(FIXES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, mtime: statSync(join(FIXES_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    const expiredBefore = Date.now() - SHARED_FIX_RETENTION_MS;
    const doomed = files.filter(({ mtime }) => mtime <= expiredBefore);
    const remaining = files.filter(({ mtime }) => mtime > expiredBefore);
    doomed.push(...remaining.slice(0, remaining.length - MAX_FIXES));
    for (const { f } of doomed) {
      rmSync(join(FIXES_DIR, f), { force: true });
    }
  } catch {
    /* best effort — never block a write on cleanup */
  }
}

async function cleanupCloudShares(owner: string) {
  try {
    const { blobs } = await list({ prefix: sharedFixOwnerPrefix(owner), limit: 1000, abortSignal: AbortSignal.timeout(15_000) });
    const stale = staleSharedFixPaths(owner, blobs.map(({ pathname }) => pathname), Date.now(), 900, CLEANUP_BATCH_SIZE);
    if (stale.length) await del(stale, { abortSignal: AbortSignal.timeout(15_000) });
  } catch {
    /* best effort — never block a write on cleanup */
  }
}

export async function POST(req: NextRequest) {
  // Writes are authenticated; reads of a specific id stay public so shared
  // /fix/<id> links work for anyone the user sends them to.
  const owner = await sessionUserId();
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = ((await readJsonBody(req)) ?? {}) as {
    repo?: string;
    pr_number?: number;
    comment_body?: string;
    fix_response?: string;
    diff?: string;
    explainer?: string;
  };

  if (!body || typeof body.fix_response !== "string" || !body.fix_response || typeof body.repo !== "string" || !body.repo || body.repo.length > 200 || [body.comment_body, body.diff, body.explainer].some(v => v !== undefined && typeof v !== "string") || (body.pr_number !== undefined && (!Number.isSafeInteger(body.pr_number) || body.pr_number < 1))) {
    return Response.json({ error: "Missing fix_response or repo" }, { status: 400 });
  }
  let repo: string;
  try { repo = parseRunTarget(body.repo).repo; }
  catch { return Response.json({ error: "Invalid GitHub repository" }, { status: 400 }); }

  if (!cloudExecution()) ensureDir();
  // The random suffix is the link's access control. The timestamp and hashed
  // owner allow per-account cloud retention without exposing the Auth0 subject
  // or adding an enumerable public index.
  const createdAt = new Date();
  const id = newSharedFixId(owner, createdAt.getTime());
  const fix = {
    id,
    repo,
    pr_number: body.pr_number ?? null,
    comment_body: body.comment_body?.slice(0, 500) ?? null,
    fix_response: body.fix_response.slice(0, 10_000),
    diff: body.diff?.slice(0, 10_000) ?? null,
    explainer: body.explainer?.slice(0, 2_000) ?? null,
    created_at: createdAt.toISOString(),
  };
  const sensitive = sensitiveTextKind([fix.comment_body, fix.fix_response, fix.diff, fix.explainer]);
  if (sensitive) {
    return Response.json({ error: `Public share blocked: the content appears to contain a ${sensitive}. Remove it and try again.` }, { status: 400 });
  }

  try {
    if (cloudExecution()) {
      await put(sharedFixPath(id)!, JSON.stringify(fix), { ...privateJsonOptions, abortSignal: AbortSignal.timeout(15_000) });
      await cleanupCloudShares(owner);
    } else {
      const target = join(FIXES_DIR, `${id}.json`);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(fix, null, 2), { flag: "wx", mode: 0o600 });
        renameSync(temporary, target);
      } finally {
        try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
      }
      evictOldest();
    }
  } catch {
    return Response.json({ error: "Could not save the share. Please retry." }, { status: 503 });
  }

  return Response.json({ id, url: `/fix/${id}` });
}
