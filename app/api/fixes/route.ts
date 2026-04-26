// POST /api/fixes — save a fix and return a shareable ID
// GET /api/fixes — list recent shared fixes

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const FIXES_DIR = join(process.cwd(), ".fixes");

function ensureDir() {
  if (!existsSync(FIXES_DIR)) mkdirSync(FIXES_DIR, { recursive: true });
}

export async function POST(req: NextRequest) {
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
