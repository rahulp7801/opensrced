// Derive PRs from dispatch logs. Used by both the /api/prs route and
// server components that call loadAllPRs(). No upstream backend needed.

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PullRequest } from "./types";

const DISPATCH_DIR = join(process.cwd(), ".dispatches");
const PR_URL_RE = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const STARTED_RE = /^\[(?:agentic-)?dispatcher\]\s+(\d{4}-\d{2}-\d{2}T[^\s]+)/m;
const TITLE_RE = /^##\s+PR title\s*\n+(.+)/m;

export async function loadPRsFromLogs(): Promise<PullRequest[]> {
  if (!existsSync(DISPATCH_DIR)) return [];

  const files = readdirSync(DISPATCH_DIR).filter((f) => f.endsWith(".log"));
  const prs: PullRequest[] = [];

  for (const f of files) {
    try {
      const text = await readFile(join(DISPATCH_DIR, f), "utf8");
      const prM = PR_URL_RE.exec(text);
      if (!prM) continue;

      const repoFull = prM[1];
      const prNumber = prM[2];
      const startM = STARTED_RE.exec(text);
      const titleM = TITLE_RE.exec(text);
      const title = titleM?.[1]?.replace(/^[`#*\s]+|[`\s]+$/g, "") ?? `PR #${prNumber}`;

      prs.push({
        id: `pr_${prNumber}`,
        repo: repoFull,
        pr_number: prNumber,
        title,
        status: "draft",
        contribution_type: "code_quality",
        created_at: startM?.[1] ?? new Date().toISOString(),
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
