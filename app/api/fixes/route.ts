// POST /api/fixes — save a fix and return a shareable ID
// GET /api/fixes — list recent shared fixes

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");

// Hard ceiling on stored fixes. Without it an authenticated client can grow
// .fixes/ without bound — one small JSON per call, no natural expiry.
// ponytail: oldest-first eviction by filename sort; swap for mtime if IDs
// ever stop being creation-ordered.
const MAX_FIXES = 1000;

function ensureDir() {
  if (!existsSync(FIXES_DIR)) mkdirSync(FIXES_DIR, { recursive: true });
}

function evictOldest() {
  try {
    const files = readdirSync(FIXES_DIR).filter((f) => f.endsWith(".json")).sort();
    for (const f of files.slice(0, files.length - MAX_FIXES)) {
      rmSync(join(FIXES_DIR, f), { force: true });
    }
  } catch {
    /* best effort — never block a write on cleanup */
  }
}

export async function POST(req: NextRequest) {
  // Writes are authenticated; reads stay public so shared /fix/<id> links
  // work for anyone the user sends them to.
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
  const id = randomUUID().slice(0, 8);
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

export async function GET() {
  ensureDir();
  try {
    const files = readdirSync(FIXES_DIR).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 20);
    const fixes = files.map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(FIXES_DIR, f), "utf8"));
        return { id: data.id, repo: data.repo, pr_number: data.pr_number, created_at: data.created_at };
      } catch { return null; }
    }).filter(Boolean);
    return Response.json({ fixes });
  } catch {
    return Response.json({ fixes: [] });
  }
}
