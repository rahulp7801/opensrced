// GET /api/prs/diff?repo=owner/name&pr=123
// Fetches the PR diff via gh CLI. Loaded lazily by the review page.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";
import { ghEnv } from "@/lib/child-env";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const rawRepo = req.nextUrl.searchParams.get("repo");
  const rawPr = req.nextUrl.searchParams.get("pr");
  if (!rawRepo || !rawPr) {
    return Response.json({ error: "Missing repo or pr" }, { status: 400 });
  }
  const repo = sanitizeRepoId(rawRepo);
  const pr = String(sanitizePrNumber(parseInt(rawPr)));
  if (!repo || !pr) {
    return Response.json({ error: "Invalid repo or pr" }, { status: 400 });
  }

  const token = await resolveGitHubToken();
  // gh acts as the requesting user or as nobody — never as whatever
  // credential the host happens to have on disk. See lib/child-env.ts.
  const env = ghEnv(token);

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "diff", pr, "--repo", repo],
      { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 15000 },
    );
    return Response.json({ diff: stdout });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
