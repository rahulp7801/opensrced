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

import { githubApi } from "./github-api";
import { classifyScope, type ScopeInfo } from "./scope";


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
  full_name: string;
  owner: { login: string };
  name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  html_url: string;
  open_issues_count: number;
};

async function searchRepos(filters: DiscoverFilters, token?: string | null): Promise<DiscoverRepo[]> {
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
  const query = [starQualifier, "archived:false"];
  if (filters.language) query.push(`language:${JSON.stringify(filters.language)}`);
  if (filters.maxRepoAgeDays && filters.maxRepoAgeDays > 0) {
    const cutoff = new Date(Date.now() - filters.maxRepoAgeDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    query.push(`pushed:>=${cutoff}`);
  }

  const params = new URLSearchParams({ q: query.join(" "), per_page: String(limit), sort: "stars", order: "desc" });
  const raw = await githubApi<{ items: GhRepo[] }>(`/search/repositories?${params}`, token);
  return raw.items
    .filter((r) => r.open_issues_count > 0)
    .map((r) => ({
      fullName: r.full_name,
      owner: r.owner.login,
      name: r.name,
      description: r.description ?? "",
      stars: r.stargazers_count,
      language: r.language,
      updatedAt: r.updated_at,
      url: r.html_url,
      openIssuesCount: r.open_issues_count,
    }));
}

export async function discover(filters: DiscoverFilters, token?: string | null): Promise<{
  repos: DiscoverRepo[];
  issues: DiscoverIssue[];
  warnings: string[];
}> {
  const issuesPerRepo = Math.min(Math.max(filters.issuesPerRepo ?? 20, 1), 50);

  const repos = await searchRepos(filters, token);
  if (repos.length === 0) return { repos: [], issues: [], warnings: [] };

  // Fan out to listIssues(). Capped concurrency: the REST issue-list API is
  // more forgiving than code-search, but 12 parallel calls is still polite.
  // 4 at a time trades wall-clock for rate-limit headroom.
  const MAX_PARALLEL = 4;
  const queue = [...repos];
  const issues: DiscoverIssue[] = [];
  const warnings: string[] = [];

  async function worker() {
    while (queue.length > 0) {
      const repo = queue.shift();
      if (!repo) break;
      try {
        const scored = await listIssues(repo.owner, repo.name, issuesPerRepo, [], token);
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
        warnings.push(`Could not scan ${repo.fullName}.`);
        // A single repo failing (e.g. transient rate limit) shouldn't kill
        // the whole scan. Skip and move on.
      }
    }
  }

  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));

  // Sort newest-first; client-side filters refine further.
  issues.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  if (warnings.length === repos.length) throw new Error("GitHub issue scans failed. Check access and rate limits, then try again.");
  return { repos, issues, warnings };
}

// Re-export for route handler convenience.
export { classifyScope };
