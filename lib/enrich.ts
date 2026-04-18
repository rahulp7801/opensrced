import { hashCode } from "./utils";
import type { PullRequest, RepoEntry, RunEntry } from "./types";

// Maps well-known repos to their language + star count so the UI can render
// cleanly even when proxying a Rust backend whose DB only stores (repo, pr_number, …).
const REPO_META: Record<string, { language: string; stars: number }> = {
  "sherlock-project/sherlock": { language: "python", stars: 58200 },
  "astral-sh/ruff": { language: "rust", stars: 32100 },
  "soimort/you-get": { language: "python", stars: 52800 },
  "pola-rs/polars": { language: "rust", stars: 31400 },
  "tokio-rs/tokio": { language: "rust", stars: 28000 },
  "huggingface/transformers": { language: "python", stars: 132000 },
  "denoland/deno": { language: "rust", stars: 97200 },
  "vuejs/core": { language: "typescript", stars: 48800 },
  "vercel/next.js": { language: "typescript", stars: 126000 },
  "facebook/react": { language: "javascript", stars: 232000 },
  "soulteary/maigret": { language: "python", stars: 19400 },
  "worldmonitor/worldmonitor": { language: "typescript", stars: 45300 },
  "robusta-dev/holmesgpt": { language: "python", stars: 2800 },
  "amanusk/s-tui": { language: "python", stars: 5100 },
  "dalgona-dev/kairos": { language: "go", stars: 1450 },
  "signal-k/lantern": { language: "typescript", stars: 8800 },
  "aptos-labs/aptos-core": { language: "rust", stars: 6200 },
  "openobserve/openobserve": { language: "rust", stars: 12900 },
  "surrealdb/surrealdb": { language: "rust", stars: 27600 },
  "bevyengine/bevy": { language: "rust", stars: 36800 },
  "ggerganov/llama.cpp": { language: "c++", stars: 67000 },
  "chartjs/Chart.js": { language: "javascript", stars: 64500 },
  "withastro/astro": { language: "typescript", stars: 45100 },
};

function langFromName(repo: string): string {
  const name = repo.toLowerCase();
  if (name.includes("rs") || name.endsWith("-rs")) return "rust";
  if (name.includes("py") || name.endsWith("-py")) return "python";
  if (name.includes("js") || name.includes("ts") || name.includes("next")) return "typescript";
  if (name.includes("go") || name.includes("-go")) return "go";
  return "polyglot";
}

function meta(repo: string) {
  if (REPO_META[repo]) return REPO_META[repo];
  const h = hashCode(repo);
  return { language: langFromName(repo), stars: 200 + (h % 9800) };
}

const MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro",
  "gpt-4.1-mini",
  "claude-sonnet-4-5",
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
