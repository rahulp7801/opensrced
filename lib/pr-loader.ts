// Derive PRs from dispatch logs. Used by both the /api/prs route and
// server components that call loadAllPRs(). No upstream backend needed.

import { listAll } from "./dispatch-store";
import { cloudExecution } from "./cloud-run-state";
import { listCloudRuns } from "./cloud-runs";
import { readLog } from "./dispatcher";
import type { PullRequest } from "./types";

const PR_URL_RE = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const STARTED_RE = /^\[(?:agentic-)?dispatcher\]\s+(\d{4}-\d{2}-\d{2}T[^\s]+)/m;
const TITLE_RE = /^##\s+PR title\s*\n+(.+)/m;

export async function loadPRsFromLogs(owner: string): Promise<PullRequest[]> {
  if (!owner) throw new Error("PR owner is required");
  const records = (cloudExecution() ? await listCloudRuns(owner) : listAll().filter(run => run.auth0_user_id === owner))
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))
    .slice(0, 100);
  const prs: PullRequest[] = [];
  for (const record of records) {
    if (!record.pr_url) continue;
    try {
      const text = "log" in record && typeof record.log === "string" ? record.log : readLog(record.id);
      const prM = PR_URL_RE.exec(record.pr_url);
      if (!prM) continue;

      const repoFull = prM[1];
      const prNumber = prM[2];
      const startM = STARTED_RE.exec(text);
      const titleM = TITLE_RE.exec(text);
      const title = titleM?.[1]?.replace(/^[`#*\s]+|[`\s]+$/g, "") ?? `PR #${prNumber}`;

      prs.push({
        id: `pr_${repoFull.replace("/", "_")}_${prNumber}`,
        repo: repoFull,
        pr_number: prNumber,
        title,
        status: "draft",
        contribution_type: "code_quality",
        created_at: record.started_at ?? startM?.[1] ?? new Date().toISOString(),
        language: "",
        stars: 0,
        url: `https://github.com/${repoFull}/pull/${prNumber}`,
        quality_score: 0,
        risk: "low",
        lines_changed: 0,
        files_changed: 0,
      });
    } catch {
      // skip unreadable
    }
  }

  prs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return prs;
}
