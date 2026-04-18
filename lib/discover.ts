// Discover — deterministic, no-LLM repo + issue discovery.
//
// Flow:
//   1. `gh search repos` filtered by stars/language. Pull the top N repos
//      ordered by stars (or recent activity).
//   2. For each of those repos, fan out to `gh issue list` and pipe through
//      the existing text-only scorer (category/severity/complexity/scope).
//   3. Merge all issues, carry the repo's `stars` and `fullName` alongside,
//      return them sorted newest-first.
//
// Client does the final filtering (by age, complexity, scope bucket) so the
// user can tweak without re-hitting GitHub.
//
// Rate limits: `gh search repos` costs 1 code-search request (authed quota
// is 30/min). `gh issue list` uses the REST API, limit 5000/hr. Reasonable
// caps: 12 repos × 20 issues = 240 issues, at most ~13 gh calls per scan.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { classifyScope, type ScopeInfo } from "./scope";

const execFileAsync = promisify(execFile);

function ghBin(): string {
  if (process.env.GH_CLI && existsSync(process.env.GH_CLI)) return process.env.GH_CLI;
  return "gh";
}

export type DiscoverRepo = {
  fullName: string;  // "owner/name"
  owner: string;
  name: string;
  description: string;
  stars: number;
  language: string | null;
  updatedAt: string;
  url: string;
  openIssuesCount: number;
};

export type DiscoverIssue = {
  repo: DiscoverRepo;
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
  author: string;
  created_at: string;
  updated_at: string;
  comments: number;
  // Derived (same shape as issue-scanner's scorer):
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  complexity: number;
  est_minutes: number;
  solvable: boolean;
  reason: string;
  scope: ScopeInfo;
};

export type DiscoverFilters = {
  minStars: number;           // required; must be >= 10 to keep searches focused
  maxStars?: number;          // optional ceiling — useful for finding smaller repos
                              //   where an individual contribution is more visible
  language?: string;          // optional language filter (e.g. "python")
  repoLimit?: number;         // repos to sample (default 12, cap 20)
  issuesPerRepo?: number;     // issues per repo to pull (default 20, cap 50)
  maxRepoAgeDays?: number;    // ignore repos not updated within N days (optional)
};

// Import the scorer directly from lib/issues.ts. Avoids duplicating the
// category/severity/complexity heuristics. listIssues already runs scope
// classification per issue, so we get it for free.
import { listIssues } from "./issues";

type GhRepo = {
  fullName: string;
  owner: { login: string };
  name: string;
  description: string | null;
  stargazersCount: number;
  language: string | null;
  updatedAt: string;
  url: string;
  openIssuesCount: number;
};

async function searchRepos(filters: DiscoverFilters): Promise<DiscoverRepo[]> {
  const limit = Math.min(Math.max(filters.repoLimit ?? 12, 1), 20);
  // `gh search repos` accepts inline qualifiers in the positional query.
  // We assemble the search string here; using the typed flags directly
  // (--stars, --language) is slightly cleaner but less flexible.
  // GitHub's code-search accepts a range qualifier `stars:A..B`. Using the
  // range form (when both bounds are set) produces a cleaner query than two
  // separate `>=A` and `<=B` qualifiers.
  const starQualifier =
    filters.maxStars && filters.maxStars > filters.minStars
      ? `stars:${filters.minStars}..${filters.maxStars}`
      : `stars:>=${filters.minStars}`;
  const args = [
    "search", "repos",
    starQualifier,
    "--limit", String(limit),
    "--sort", "stars",
    "--order", "desc",
    "--json",
    "fullName,owner,name,description,stargazersCount,language,updatedAt,url,openIssuesCount",
  ];
  if (filters.language) args.push("--language", filters.language);
  if (filters.maxRepoAgeDays && filters.maxRepoAgeDays > 0) {
    const cutoff = new Date(Date.now() - filters.maxRepoAgeDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    args.push(`pushed:>=${cutoff}`);
  }

  const { stdout } = await execFileAsync(ghBin(), args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  const raw: GhRepo[] = JSON.parse(stdout);
  return raw
    .filter((r) => r.openIssuesCount > 0) // silent repos aren't useful
    .map((r) => ({
      fullName: r.fullName,
      owner: r.owner.login,
      name: r.name,
      description: r.description ?? "",
      stars: r.stargazersCount,
      language: r.language,
      updatedAt: r.updatedAt,
      url: r.url,
      openIssuesCount: r.openIssuesCount,
    }));
}

export async function discover(filters: DiscoverFilters): Promise<{
  repos: DiscoverRepo[];
  issues: DiscoverIssue[];
}> {
  const issuesPerRepo = Math.min(Math.max(filters.issuesPerRepo ?? 20, 1), 50);

  const repos = await searchRepos(filters);
  if (repos.length === 0) return { repos: [], issues: [] };

  // Fan out to listIssues(). Capped concurrency: the REST issue-list API is
  // more forgiving than code-search, but 12 parallel calls is still polite.
  // 4 at a time trades wall-clock for rate-limit headroom.
  const MAX_PARALLEL = 4;
  const queue = [...repos];
  const issues: DiscoverIssue[] = [];

  async function worker() {
    while (queue.length > 0) {
      const repo = queue.shift();
      if (!repo) break;
      try {
        const scored = await listIssues(repo.owner, repo.name, issuesPerRepo);
        for (const i of scored) {
          issues.push({
            repo,
            number: i.number,
            title: i.title,
            body: i.body,
            labels: i.labels,
            url: i.url,
            author: i.author,
            created_at: i.created_at,
            updated_at: i.updated_at,
            comments: i.comments,
            category: i.category,
            severity: i.severity,
            complexity: i.complexity,
            est_minutes: i.est_minutes,
            solvable: i.solvable,
            reason: i.reason,
            scope: i.scope,
          });
        }
      } catch {
        // A single repo failing (e.g. transient rate limit) shouldn't kill
        // the whole scan. Skip and move on.
      }
    }
  }

  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));

  // Sort newest-first; client-side filters refine further.
  issues.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return { repos, issues };
}

// Re-export for route handler convenience.
export { classifyScope };
