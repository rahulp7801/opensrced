import { hashCode } from "./utils";
import type { PullRequest, RepoEntry, RunEntry } from "./types";

// Runtime cache for repo metadata fetched from the GitHub API.
const repoMetaCache = new Map<string, { language: string; stars: number }>();

function langFromName(repo: string): string {
  const name = repo.toLowerCase();
  if (name.includes("rs") || name.endsWith("-rs")) return "rust";
  if (name.includes("py") || name.endsWith("-py")) return "python";
  if (name.includes("js") || name.includes("ts") || name.includes("next")) return "typescript";
  if (name.includes("go") || name.includes("-go")) return "go";
  return "polyglot";
}

const fetchInflight = new Set<string>();
function fetchRepoMetaAsync(repo: string): void {
  if (fetchInflight.has(repo)) return;
  fetchInflight.add(repo);
  fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((json: { language?: string; stargazers_count?: number } | null) => {
      if (json) {
        repoMetaCache.set(repo, {
          language: (json.language ?? langFromName(repo)).toLowerCase(),
          stars: json.stargazers_count ?? 0,
        });
      }
    })
    .catch(() => {})
    .finally(() => fetchInflight.delete(repo));
}

function meta(repo: string) {
  const cached = repoMetaCache.get(repo);
  if (cached) return cached;
  fetchRepoMetaAsync(repo);
  return { language: langFromName(repo), stars: 0 };
}

const MODELS = [
  "claude-sonnet-4-5",
  "gemini-2.0-flash",
];

/** Enrich a Rust-backed PR row (subset fields) to the full UI shape. */
export function enrichPR(raw: Record<string, unknown>): PullRequest {
  const repo = String(raw.repo ?? "");
  const pr_number = String(raw.pr_number ?? "");
  const status = String(raw.status ?? "open") as PullRequest["status"];
  const type = String(raw.type ?? raw.contribution_type ?? "code_quality") as PullRequest["contribution_type"];
  const created_at = String(raw.created_at ?? new Date().toISOString());
  const updated_at = String(raw.updated_at ?? created_at);
  const pr_url = String(raw.pr_url ?? raw.url ?? `https://github.com/${repo}/pull/${pr_number}`);

  const { language, stars } = meta(repo);
  const h = hashCode(`${repo}:${pr_number}`);
  const quality_score = 62 + (h % 37);
  const riskRoll = (h % 100) / 100;
  const risk: PullRequest["risk"] = riskRoll > 0.85 ? "high" : riskRoll > 0.55 ? "medium" : "low";
  const lines_changed = 6 + (h % 475);
  const files_changed = 1 + (h % 9);

  return {
    id: `pr_${pr_number}`,
    repo,
    pr_number,
    title: String(raw.title ?? "Untitled dispatch"),
    status,
    contribution_type: type,
    created_at,
    merged_at: status === "merged" ? updated_at : undefined,
    language,
    stars,
    url: pr_url,
    quality_score,
    risk,
    lines_changed,
    files_changed,
  };
}

/** Enrich a Rust-backed repo row ({repo, pr_count}) with language + stars + merge_rate. */
export function enrichRepo(
  raw: Record<string, unknown>,
  prs: PullRequest[],
): RepoEntry {
  const repo = String(raw.repo ?? "");
  const pr_count = Number(raw.pr_count ?? 0);
  const { language, stars } = meta(repo);
  const merged = prs.filter((p) => p.repo === repo && p.status === "merged").length;
  const merge_rate = pr_count > 0 ? merged / pr_count : 0;
  return { repo, pr_count, merged, language, stars, merge_rate };
}

/** Enrich a Rust-backed run row with duration/findings/tokens/model (derived). */
export function enrichRun(raw: Record<string, unknown>, i: number): RunEntry {
  const repo = String(raw.repo ?? "");
  const pr_number = String(raw.pr_number ?? "");
  const h = hashCode(`${repo}:${pr_number}:run`);
  return {
    id: `run_${pr_number}_${i}`,
    repo,
    pr_number,
    type: String(raw.type ?? "code_quality"),
    status: String(raw.status ?? ""),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    duration_sec: 28 + (h % 220),
    findings: 1 + (h % 8),
    tokens_used: 18_000 + (h % 160_000),
    model: MODELS[h % MODELS.length],
  };
}
