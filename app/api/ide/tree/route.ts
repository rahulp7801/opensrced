// GET /api/ide/tree?repo=owner/name&sha=<40-hex> — the file list the in-browser
// IDE shows (components/ide/fs.ts). Uses the caller's GitHub token when there is
// one (higher rate limit, private repos they can read), else asks anonymously.
// File contents never pass through here: the browser fetches them from
// raw.githubusercontent.com when a file is opened.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { errorStatus, githubApi } from "@/lib/github-api";
import { parseRunTarget } from "@/lib/run-target";
import { treeFiles, validSha, type RepoTree } from "@/lib/ide/repo-tree";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const sha = req.nextUrl.searchParams.get("sha");
  let repo: string;
  try { repo = parseRunTarget(req.nextUrl.searchParams.get("repo")).repo; }
  catch { return Response.json({ error: "Invalid repository" }, { status: 400 }); }
  if (!validSha(sha)) return Response.json({ error: "A full 40-character commit SHA is required" }, { status: 400 });
  try {
    const token = await resolveGitHubToken();
    const { files, truncated } = treeFiles(await githubApi(`/repos/${repo}/git/trees/${sha}?recursive=1`, token, undefined, req.signal));
    const tree: RepoTree = { repo, sha: sha.toLowerCase(), truncated, files };
    // A tree at a commit never changes; the browser may keep it for the session.
    return Response.json(tree, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    const status = errorStatus(error);
    return Response.json({ error: status === 500 ? "Could not load the repository tree." : (error as Error).message }, { status });
  }
}
