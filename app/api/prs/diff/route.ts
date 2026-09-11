// GET /api/prs/diff?repo=owner/name&pr=123
// Fetches the PR diff via the GitHub API. Loaded lazily by the review page.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";


import { githubResponse } from "@/lib/github-api";

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
  const pr = sanitizePrNumber(rawPr);
  if (!repo || !pr) {
    return Response.json({ error: "Invalid repo or pr" }, { status: 400 });
  }

  const token = await resolveGitHubToken();
  try {
    const response = await githubResponse(`/repos/${repo}/pulls/${pr}`, token, undefined, "application/vnd.github.diff");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("GitHub returned an empty diff response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4_000_000) throw new Error("This diff is too large to display here. Open it on GitHub.");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    return Response.json({ diff: Buffer.concat(chunks).toString("utf8") });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
