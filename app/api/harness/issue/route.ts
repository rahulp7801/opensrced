// GET /api/harness/issue?repo=owner/name&issue=N — an issue and its newest
// comments (lib/harness-issue.ts) for the plugin's read_issue tool.
// GET /api/harness/issue?repo=owner/name — its newest open issues and who has
// taken each, for find_issues.
import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { HarnessAuthError, harnessUser } from "@/lib/harness";
import { IssueThreadError, listOpenIssues, readIssueThread } from "@/lib/harness-issue";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const db = await getDb();
  try {
    await harnessUser(db, req.headers.get("authorization"), canUse);
  } catch (error) {
    if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const params = new URL(req.url).searchParams;
  try {
    const repo = params.get("repo") ?? "";
    return Response.json(params.has("issue") ? await readIssueThread(repo, params.get("issue")) : await listOpenIssues(repo), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof IssueThreadError) return Response.json({ error: error.message }, { status: error.status });
    console.error("[harness/issue]", error);
    return Response.json({ error: "GitHub didn't answer in time. Try again in a minute." }, { status: 503 });
  }
}
