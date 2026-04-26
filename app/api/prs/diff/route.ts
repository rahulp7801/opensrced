// GET /api/prs/diff?repo=owner/name&pr=123
// Fetches the PR diff via gh CLI. Loaded lazily by the review page.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (token) env.GH_TOKEN = token;

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
