export type PrStatus = "open" | "merged" | "closed" | "ci_passed" | "ci_failed" | "draft";

export type ContributionType =
  | "security_fix"
  | "docs_improve"
  | "code_quality"
  | "feature_add"
  | "ui_ux_fix"
  | "performance_opt"
  | "refactor"
  | "test_add";

export interface PullRequest {
  id: string;
  repo: string;
  pr_number: string;
  title: string;
  status: PrStatus;
  contribution_type: ContributionType;
  created_at: string;
  merged_at?: string;
  language: string;
  stars: number;
  url: string;
  quality_score: number;
  risk: "low" | "medium" | "high";
  lines_changed: number;
  files_changed: number;
}

export interface RepoEntry {
  repo: string;
  pr_count: number;
  merged: number;
  language: string;
  stars: number;
  merge_rate: number;
}

export interface RunEntry {
  id: string;
  repo: string;
  pr_number: string;
  type: string;
  status: string;
  created_at: string;
  duration_sec: number;
  findings: number;
  tokens_used: number;
  model: string;
}

export interface StatsResponse {
  total_prs: number;
  total_repos: number;
  merged_prs: number;
  open_prs: number;
  ci_passed: number;
  // Extensions
  findings_total: number;
  tokens_used_24h: number;
  languages: number;
  merge_rate: number;
  daily_series: number[];
}

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  version: string;
  timestamp: string;
  uptime_sec: number;
  circuit_breaker: "closed" | "open" | "half_open";
  scheduler: "enabled" | "disabled";
  cache_entries: number;
}

export interface Session {
  id: string;
  name: string;
  mode: string;
  status: string;
  started_at: string;
}
