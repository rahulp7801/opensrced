"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { cn } from "@/lib/utils";

type GitHubRepo = {
  nameWithOwner: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  updatedAt: string;
  isPrivate: boolean;
  source: "contributed" | "starred" | "owned";
};

type Tab = "contributed" | "starred" | "owned";

type TabState = {
  repos: GitHubRepo[];
  page: number;
  hasMore: boolean;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

const LANG_COLORS: Record<string, string> = {
  Rust: "#dea584", Python: "#3572a5", TypeScript: "#3178c6",
  JavaScript: "#f1e05a", Go: "#00add8", "C++": "#f34b7d",
  Java: "#b07219", Ruby: "#701516", PHP: "#4F5D95",
  "C#": "#178600", C: "#555555", Shell: "#89e051",
  Kotlin: "#A97BFF", Swift: "#F05138",
};

const EMPTY_STATE: TabState = { repos: [], page: 0, hasMore: true, nextCursor: null, loading: false, error: null };

function isGitHubRepo(value: unknown): value is GitHubRepo {
  if (!value || typeof value !== "object") return false;
  const repo = value as Partial<GitHubRepo>;
  return typeof repo.nameWithOwner === "string"
    && typeof repo.description === "string"
    && typeof repo.language === "string"
    && typeof repo.stars === "number" && Number.isFinite(repo.stars)
    && typeof repo.forks === "number" && Number.isFinite(repo.forks)
    && typeof repo.updatedAt === "string"
    && typeof repo.isPrivate === "boolean"
    && ["contributed", "starred", "owned"].includes(repo.source ?? "");
}

export default function ReposPage() {
  const [tab, setTab] = useState<Tab>("contributed");
  const [states, setStates] = useState<Record<Tab, TabState>>({
    contributed: { ...EMPTY_STATE },
    starred: { ...EMPTY_STATE },
    owned: { ...EMPTY_STATE },
  });
  const [search, setSearch] = useState("");

  const requests = useRef(new Map<Tab, AbortController>());
  useEffect(() => () => { for (const request of requests.current.values()) request.abort(); }, []);
  const current = states[tab];

  const fetchPage = useCallback(async (t: Tab, page: number, cursor: string | null = null) => {
    if (requests.current.get(t) && !requests.current.get(t)!.signal.aborted) return;
    const controller = new AbortController();
    requests.current.set(t, controller);
    setStates((prev) => ({
      ...prev,
      [t]: { ...prev[t], loading: true, error: null },
    }));

    try {
      const res = await fetch(`/api/repos/github?tab=${t}&page=${page}&per_page=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(err?.error ?? `GitHub returned ${res.status}. Please try again.`);
      }
      const data = (await res.json()) as { repos?: unknown; hasMore?: unknown; nextCursor?: unknown };
      if (!Array.isArray(data.repos)) throw new Error("GitHub returned an invalid repository list. Please try again.");
      const repos = data.repos.filter(isGitHubRepo);
      if (data.repos.length > 0 && repos.length === 0) throw new Error("GitHub returned an invalid repository list. Please try again.");
      if (controller.signal.aborted) return;
      setStates((prev) => ({
        ...prev,
        [t]: {
          repos: page === 1 ? repos : [...prev[t].repos, ...repos],
          page,
          hasMore: data.hasMore === true,
          nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setStates((prev) => ({
        ...prev,
        [t]: { ...prev[t], loading: false, error: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      if (requests.current.get(t) === controller) requests.current.delete(t);
    }
  }, []);

  // Auto-fetch page 1 when switching to a tab that hasn't loaded
  useEffect(() => {
    if (current.page === 0 && !current.loading && !current.error) {
      fetchPage(tab, 1);
    }
  }, [tab, current.page, current.loading, current.error, fetchPage]);

  const filtered = search
    ? current.repos.filter((r) =>
        r.nameWithOwner.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (r.language ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : current.repos;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Your repos</>}
        description="Your GitHub repos. Build knowledge graphs, scan for issues, or explore any codebase."
      />

      <div className="mt-4 flex flex-wrap items-center gap-y-2 border-b border-border">
        <div className="flex items-center" role="tablist" aria-label="Repository source">
          {([
            { key: "contributed" as Tab, label: "Contributed to" },
            { key: "starred" as Tab, label: "Starred" },
            { key: "owned" as Tab, label: "My repos" },
          ]).map((t) => (
            <button
              key={t.key}
              id={`repos-tab-${t.key}`}
              role="tab"
              aria-selected={tab === t.key}
              aria-controls="repos-panel"
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-[12px] transition-colors",
                tab === t.key ? "border-signal text-signal" : "border-transparent text-paper-muted hover:text-paper",
              )}
            >
              {t.label}
              {states[t.key].repos.length > 0 && (
                <span className="ml-1.5 text-xs tabular-nums text-paper-faint">
                  ({states[t.key].repos.length}{states[t.key].hasMore ? "+" : ""})
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 border border-border bg-ink px-2.5 py-1 focus-within:border-signal/50 transition-colors">
          <input
            aria-label="Filter repositories"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter repos..."
            className="w-full sm:w-48 bg-transparent text-[12px] text-paper placeholder:text-paper-faint focus:outline-none"
          />
        </div>
      </div>

      <div id="repos-panel" role="tabpanel" aria-labelledby={`repos-tab-${tab}`} className="mt-4">
        {current.error && (
          <div role="alert" className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert mb-3">
            {current.error}
            <button className="ml-3 underline" disabled={current.loading} onClick={() => fetchPage(tab, current.page + 1, current.nextCursor)}>Retry</button>
          </div>
        )}

        {current.page === 0 && current.loading && (
          <div className="text-[12px] text-paper-muted animate-pulse-signal py-8 text-center">
            Loading repos from GitHub...
          </div>
        )}

        {current.page > 0 && filtered.length === 0 && !current.loading && (
          <div className="rounded-md border border-border bg-surface/40 p-8 text-center text-[12px] text-paper-muted">
            {search ? "No repos match your search." : "No repos found."}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="divide-y divide-border-soft overflow-hidden rounded-md border border-border bg-surface/40">
            {filtered.map((repo) => (
              <div
                key={repo.nameWithOwner}
                className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2/60"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: LANG_COLORS[repo.language] ?? "var(--color-paper-muted)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://github.com/${repo.nameWithOwner}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-paper hover:text-signal truncate"
                    >
                      {repo.nameWithOwner}
                    </a>
                    {repo.isPrivate && (
                      <span className="text-[11px] text-paper-faint border border-border px-1 py-0.5">private</span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-0.5 text-[11px] text-paper-muted truncate max-w-[500px]">{repo.description}</p>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-4 text-[11px] text-paper-muted shrink-0">
                  {repo.language && <span>{repo.language}</span>}
                  <span>★ {repo.stars.toLocaleString()}</span>
                  {repo.updatedAt && <span className="text-paper-faint">{timeAgo(repo.updatedAt)}</span>}
                </div>
                <div className="ml-6 flex w-full items-center gap-2 sm:ml-0 sm:w-auto">
                  <Link
                    href={`/graph?repo=${encodeURIComponent(repo.nameWithOwner)}`}
                    className="inline-flex min-h-8 items-center rounded-md border border-signal/30 px-3 text-xs text-signal transition hover:bg-signal/10"
                  >
                    Graph
                  </Link>
                  <Link
                    href={`/issues?repo=${encodeURIComponent(repo.nameWithOwner)}`}
                    className="inline-flex min-h-8 items-center rounded-md border border-info/30 px-3 text-xs text-info transition hover:bg-info/10"
                  >
                    Issues
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more / loading indicator */}
        {current.hasMore && current.page > 0 && (
          <div className="mt-3 text-center">
            <button
              onClick={() => fetchPage(tab, current.page + 1, current.nextCursor)}
              disabled={current.loading}
              className={cn(
                "px-6 py-2 text-[11px] uppercase tracking-[0.12em] border transition",
                current.loading
                  ? "border-border text-paper-faint"
                  : "border-signal/40 text-signal hover:bg-signal/10",
              )}
            >
              {current.loading ? "loading..." : "load more"}
            </button>
          </div>
        )}

        {!current.hasMore && current.repos.length > 0 && (
          <div className="mt-3 text-center text-xs text-paper-faint">
            All {current.repos.length} repos loaded
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (!Number.isFinite(then)) return "Unknown";
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(dateStr).toLocaleDateString();
}
