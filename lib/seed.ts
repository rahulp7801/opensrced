import type { ContributionType, PullRequest, RepoEntry, RunEntry, Session } from "./types";

// Deterministic PRNG so the "observatory" shows stable numbers across reloads.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xc0de_a1);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const REPOS: Array<{ repo: string; language: string; stars: number }> = [
  { repo: "sherlock-project/sherlock", language: "python", stars: 58200 },
  { repo: "astral-sh/ruff", language: "rust", stars: 32100 },
  { repo: "soimort/you-get", language: "python", stars: 52800 },
  { repo: "pola-rs/polars", language: "rust", stars: 31400 },
  { repo: "tokio-rs/tokio", language: "rust", stars: 28000 },
  { repo: "huggingface/transformers", language: "python", stars: 132000 },
  { repo: "denoland/deno", language: "rust", stars: 97200 },
  { repo: "vuejs/core", language: "typescript", stars: 48800 },
  { repo: "vercel/next.js", language: "typescript", stars: 126000 },
  { repo: "facebook/react", language: "javascript", stars: 232000 },
  { repo: "soulteary/maigret", language: "python", stars: 19400 },
  { repo: "worldmonitor/worldmonitor", language: "typescript", stars: 45300 },
  { repo: "robusta-dev/holmesgpt", language: "python", stars: 2800 },
  { repo: "amanusk/s-tui", language: "python", stars: 5100 },
  { repo: "dalgona-dev/kairos", language: "go", stars: 1450 },
  { repo: "signal-k/lantern", language: "typescript", stars: 8800 },
  { repo: "aptos-labs/aptos-core", language: "rust", stars: 6200 },
  { repo: "openobserve/openobserve", language: "rust", stars: 12900 },
  { repo: "surrealdb/surrealdb", language: "rust", stars: 27600 },
  { repo: "bevyengine/bevy", language: "rust", stars: 36800 },
  { repo: "ggerganov/llama.cpp", language: "c++", stars: 67000 },
  { repo: "chartjs/Chart.js", language: "javascript", stars: 64500 },
  { repo: "withastro/astro", language: "typescript", stars: 45100 },
];

const TITLES: Record<ContributionType, string[]> = {
  security_fix: [
    "Guard against path traversal in archive extractor",
    "Sanitize user input in webhook dispatch",
    "Fix SQLi in report query builder",
    "Mitigate XSS via Markdown rendering pipeline",
    "Close resource leak in TLS handshake retry",
    "Constant-time comparison for session tokens",
  ],
  docs_improve: [
    "Add migration guide from v3 to v4",
    "Document thread-safety guarantees of Cache",
    "Clarify default values in config reference",
    "Add troubleshooting section for SIGPIPE",
    "Document env var precedence in README",
  ],
  code_quality: [
    "Extract shared retry helper from HTTP clients",
    "Remove dead code in legacy encoder path",
    "Consolidate error variants in parser module",
    "Simplify async cancellation in scheduler loop",
    "Replace manual mutex with parking_lot",
  ],
  feature_add: [
    "Support YAML output in `stats` command",
    "Add `--since` flag to activity timeline",
    "Introduce configurable cache TTL",
    "Add pagination to /api/prs endpoint",
  ],
  ui_ux_fix: [
    "Improve contrast of disabled buttons",
    "Restore focus ring on dialog close",
    "Fix chart tooltip overflow on narrow viewports",
  ],
  performance_opt: [
    "Cache compiled regex in log filter hot path",
    "Stream large response bodies instead of buffering",
    "Reduce allocations in AST visitor",
  ],
  refactor: [
    "Split `client.rs` into auth, rate-limit, retry modules",
    "Pull LLM prompt builders into dedicated namespace",
  ],
  test_add: [
    "Add property tests for retry backoff",
    "Cover edge cases in YAML parser",
    "Integration test for webhook replay",
  ],
};

const MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro",
  "gpt-4.1-mini",
  "claude-sonnet-4-5",
  "gemini-3-flash-preview",
  "gemini-3-flash-preview",
];

const TYPES = Object.keys(TITLES) as Array<keyof typeof TITLES>;

const STATUSES: Array<{ s: PullRequest["status"]; w: number }> = [
  { s: "merged", w: 22 },
  { s: "open", w: 26 },
  { s: "ci_passed", w: 12 },
  { s: "ci_failed", w: 5 },
  { s: "draft", w: 6 },
  { s: "closed", w: 9 },
];

function weighted<T extends { w: number }>(items: T[]): T {
  const total = items.reduce((a, b) => a + b.w, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function generatePRs(count: number): PullRequest[] {
  const now = Date.now();
  const prs: PullRequest[] = [];
  for (let i = 0; i < count; i++) {
    const repo = pick(REPOS);
    const type = pick(TYPES);
    const title = pick(TITLES[type]);
    const status = weighted(STATUSES).s;
    const ageHours = Math.floor(rand() * 24 * 60); // up to 60 days
    const created = new Date(now - ageHours * 3_600_000).toISOString();
    const merged =
      status === "merged"
        ? new Date(
            now - Math.max(0, (ageHours - Math.floor(rand() * 40)) * 3_600_000),
          ).toISOString()
        : undefined;
    const pr_number = (1200 + i + Math.floor(rand() * 4000)).toString();
    const quality = Math.round(62 + rand() * 36);
    const riskRoll = rand();
    const risk: PullRequest["risk"] = riskRoll > 0.85 ? "high" : riskRoll > 0.55 ? "medium" : "low";
    prs.push({
      id: `pr_${i.toString(36)}_${pr_number}`,
      repo: repo.repo,
      pr_number,
      title,
      status,
      contribution_type: type,
      created_at: created,
      merged_at: merged,
      language: repo.language,
      stars: repo.stars,
      url: `https://github.com/${repo.repo}/pull/${pr_number}`,
      quality_score: quality,
      risk,
      lines_changed: Math.floor(6 + rand() * 480),
      files_changed: Math.floor(1 + rand() * 9),
    });
  }
  prs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return prs;
}

const _PRS = generatePRs(84);

export function getPRs(status?: string, limit = 50): PullRequest[] {
  let list = _PRS;
  if (status) list = list.filter((p) => p.status === status);
  return list.slice(0, limit);
}

export function getAllPRs(): PullRequest[] {
  return _PRS;
}

export function getRepos(limit = 20): RepoEntry[] {
  const map = new Map<string, RepoEntry>();
  for (const pr of _PRS) {
    const existing = map.get(pr.repo);
    if (existing) {
      existing.pr_count += 1;
      if (pr.status === "merged") existing.merged += 1;
    } else {
      map.set(pr.repo, {
        repo: pr.repo,
        pr_count: 1,
        merged: pr.status === "merged" ? 1 : 0,
        language: pr.language,
        stars: pr.stars,
        merge_rate: 0,
      });
    }
  }
  const list = Array.from(map.values()).map((r) => ({
    ...r,
    merge_rate: r.pr_count ? r.merged / r.pr_count : 0,
  }));
  list.sort((a, b) => b.pr_count - a.pr_count);
  return list.slice(0, limit);
}

export function getRuns(limit = 30): RunEntry[] {
  return _PRS.slice(0, limit).map((pr, i) => ({
    id: `run_${pr.id}`,
    repo: pr.repo,
    pr_number: pr.pr_number,
    type: pr.contribution_type,
    status: pr.status === "merged" ? "success" : pr.status === "ci_failed" ? "failed" : "ok",
    created_at: pr.created_at,
    duration_sec: Math.floor(28 + (i % 11) * 14 + (pr.lines_changed % 60)),
    findings: Math.floor(1 + (pr.files_changed + i) % 8),
    tokens_used: Math.floor(18_000 + (pr.lines_changed * 240) + (i % 7) * 4200),
    model: MODELS[i % MODELS.length],
  }));
}

export function getStats() {
  const prs = _PRS;
  const merged = prs.filter((p) => p.status === "merged").length;
  const open = prs.filter((p) => p.status === "open" || p.status === "ci_passed").length;
  const ci_passed = prs.filter((p) => p.status === "ci_passed").length;
  const repos = new Set(prs.map((p) => p.repo));
  const langs = new Set(prs.map((p) => p.language));
  const findings = prs.reduce((a, p) => a + (p.files_changed + 2), 0);

  // 14-day series of PR activity
  const buckets = new Array(14).fill(0);
  const now = Date.now();
  for (const pr of prs) {
    const d = Math.floor((now - new Date(pr.created_at).getTime()) / 86_400_000);
    if (d >= 0 && d < 14) buckets[13 - d] += 1;
  }

  return {
    total_prs: prs.length,
    total_repos: repos.size,
    merged_prs: merged,
    open_prs: open,
    ci_passed,
    findings_total: findings,
    tokens_used_24h: 1_428_900,
    languages: langs.size,
    merge_rate: prs.length ? merged / prs.length : 0,
    daily_series: buckets,
  };
}

export function getSessions(): Session[] {
  const now = Date.now();
  return [
    {
      id: "ses_h4nt_01",
      name: "nightly-hunt",
      mode: "hunt",
      status: "running",
      started_at: new Date(now - 23 * 60_000).toISOString(),
    },
    {
      id: "ses_patr_02",
      name: "patrol-open-prs",
      mode: "patrol",
      status: "running",
      started_at: new Date(now - 3 * 3600_000).toISOString(),
    },
    {
      id: "ses_sec_03",
      name: "security-sweep",
      mode: "target",
      status: "idle",
      started_at: new Date(now - 26 * 3600_000).toISOString(),
    },
  ];
}

export function getHealth() {
  return {
    status: "ok" as const,
    version: "6.0.0",
    timestamp: new Date().toISOString(),
    uptime_sec: 318_492,
    circuit_breaker: "closed" as const,
    scheduler: "enabled" as const,
    cache_entries: 4812,
  };
}
