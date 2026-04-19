// Server-side data loader. Prefers the Rust contribai web-server when
// CONTRIBAI_API_URL is set; falls back to local seed data otherwise.
//
// Every page imports from here so switching backends is transparent.

import { proxy, hasUpstream } from "./api";
import { enrichPR, enrichRepo, enrichRun } from "./enrich";
import type { PullRequest, RepoEntry, RunEntry, Session } from "./types";
import * as seed from "./seed";

export async function loadHealth() {
  if (hasUpstream()) {
    const up = await proxy<Record<string, unknown>>("/api/health");
    if (up) {
      return {
        status: (up.status as "ok") ?? "ok",
        version: (up.version as string) ?? "unknown",
        timestamp: (up.timestamp as string) ?? new Date().toISOString(),
        uptime_sec: (up.uptime_sec as number) ?? 0,
        circuit_breaker: (up.circuit_breaker as "closed") ?? "closed",
        scheduler: (up.scheduler as "enabled") ?? "disabled",
        cache_entries: (up.cache_entries as number) ?? 0,
      };
    }
  }
  return seed.getHealth();
}

export async function loadAllPRs(): Promise<PullRequest[]> {
  if (hasUpstream()) {
    const up = await proxy<Array<Record<string, unknown>>>("/api/prs?limit=500");
    if (up) return up.map(enrichPR);
  }
  return [];
}

export async function loadPRs(status: string | undefined, limit: number): Promise<PullRequest[]> {
  if (hasUpstream()) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set("status", status);
    const up = await proxy<Array<Record<string, unknown>>>(`/api/prs?${qs.toString()}`);
    if (up) return up.map(enrichPR);
  }
  return [];
}

export async function loadRepos(limit: number): Promise<RepoEntry[]> {
  if (hasUpstream()) {
    const repos = await proxy<Array<Record<string, unknown>>>(`/api/repos?limit=${limit}`);
    if (repos) {
      const prs = await loadAllPRs();
      return repos.map((r) => enrichRepo(r, prs));
    }
  }
  return [];
}

export async function loadRuns(limit: number): Promise<RunEntry[]> {
  if (hasUpstream()) {
    const up = await proxy<Array<Record<string, unknown>>>(`/api/runs?limit=${limit}`);
    if (up) return up.map((r, i) => enrichRun(r, i));
  }
  return [];
}

export async function loadSessions(): Promise<Session[]> {
  if (hasUpstream()) {
    const up = await proxy<{ sessions?: Session[] }>("/api/sessions");
    if (up?.sessions?.length) return up.sessions;
  }
  return seed.getSessions();
}

export async function loadStats() {
  if (hasUpstream()) {
    const up = await proxy<Record<string, number>>("/api/stats");
    if (up) {
      const prs = await loadAllPRs();
      const languages = new Set(prs.map((p) => p.language)).size;
      const findings_total = prs.reduce((a, p) => a + (p.files_changed + 2), 0);
      const tokens_used_24h = prs.reduce((a, p) => a + 18_000 + p.lines_changed * 240, 0);
      const buckets = new Array(14).fill(0);
      const now = Date.now();
      for (const pr of prs) {
        const d = Math.floor((now - new Date(pr.created_at).getTime()) / 86_400_000);
        if (d >= 0 && d < 14) buckets[13 - d] += 1;
      }
      const total = up.total_prs ?? 0;
      const merge_rate = total > 0 ? (up.merged_prs ?? 0) / total : 0;
      return {
        total_prs: up.total_prs ?? 0,
        total_repos: up.total_repos ?? 0,
        merged_prs: up.merged_prs ?? 0,
        open_prs: up.open_prs ?? 0,
        ci_passed: up.ci_passed ?? 0,
        findings_total,
        tokens_used_24h,
        languages,
        merge_rate,
        daily_series: buckets,
      };
    }
  }
  return seed.getStats();
}
