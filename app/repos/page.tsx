"use client";

import { useState, useEffect, useCallback } from "react";
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

const EMPTY_STATE: TabState = { repos: [], page: 0, hasMore: true, loading: false, error: null };

export default function ReposPage() {
  const [tab, setTab] = useState<Tab>("contributed");
  const [states, setStates] = useState<Record<Tab, TabState>>({
    contributed: { ...EMPTY_STATE },
    starred: { ...EMPTY_STATE },
    owned: { ...EMPTY_STATE },
  });
  const [search, setSearch] = useState("");

  const current = states[tab];

  const fetchPage = useCallback(async (t: Tab, page: number) => {
    setStates((prev) => ({
      ...prev,
      [t]: { ...prev[t], loading: true, error: null },
    }));

    try {
      const res = await fetch(`/api/repos/github?tab=${t}&page=${page}&per_page=15`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Request failed");
      }
      const data = (await res.json()) as { repos: GitHubRepo[]; hasMore: boolean };
      setStates((prev) => ({
        ...prev,
        [t]: {
          repos: page === 1 ? data.repos : [...prev[t].repos, ...data.repos],
          page,
          hasMore: data.hasMore,
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      setStates((prev) => ({
        ...prev,
        [t]: { ...prev[t], loading: false, error: err instanceof Error ? err.message : String(err) },
      }));
    }
  }, []);

  // Auto-fetch page 1 when switching to a tab that hasn't loaded
  useEffect(() => {
    if (current.page === 0 && !current.loading) {
      fetchPage(tab, 1);
    }
  }, [tab, current.page, current.loading, fetchPage]);

  const filtered = search
    ? current.repos.filter((r) =>
        r.nameWithOwner.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (r.language ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : current.repos;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>Repositories</>}
        description="Your GitHub repos. Build knowledge graphs, scan for issues, or explore any codebase."
      />

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-0 border-b border-border">
        {([
          { key: "contributed" as Tab, label: "Contributed to" },
          { key: "starred" as Tab, label: "Starred" },
          { key: "owned" as Tab, label: "My repos" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-[12px] transition-colors border-b-2 -mb-px",
              tab === t.key ? "text-signal border-signal" : "text-paper-muted border-transparent hover:text-paper",
            )}
          >
            {t.label}
            {states[t.key].repos.length > 0 && (
              <span className="ml-1.5 text-[10px] tabular-nums text-paper-faint">
                ({states[t.key].repos.length}{states[t.key].hasMore ? "+" : ""})
              </span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 border border-border bg-ink px-2.5 py-1 focus-within:border-signal/50 transition-colors">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter repos..."
            className="w-48 bg-transparent text-[12px] text-paper placeholder:text-paper-faint focus:outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="mt-4">
        {current.error && (
          <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert mb-3">{current.error}</div>
        )}

        {current.page === 0 && current.loading && (
          <div className="text-[12px] text-paper-muted animate-pulse-signal py-8 text-center">
            Loading repos from GitHub...
          </div>
        )}

        {current.page > 0 && filtered.length === 0 && !current.loading && (
          <div className="border border-border bg-surface/40 p-8 text-center text-[12px] text-paper-muted">
            {search ? "No repos match your search." : "No repos found."}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="border border-border bg-surface/40 divide-y divide-border-soft">
            {filtered.map((repo) => (
              <div
                key={repo.nameWithOwner}
                className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/60"
              >
                <span
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
                      <span className="text-[9px] text-paper-faint border border-border px-1 py-0.5">private</span>
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
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/graph?repo=${encodeURIComponent(repo.nameWithOwner)}`}
                    className="text-[10px] text-signal border border-signal/30 hover:bg-signal/10 px-2 py-0.5 transition"
                  >
                    graph
                  </Link>
                  <Link
                    href={`/issues?repo=${encodeURIComponent(repo.nameWithOwner)}`}
                    className="text-[10px] text-info border border-info/30 hover:bg-info/10 px-2 py-0.5 transition"
                  >
                    issues
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
              onClick={() => fetchPage(tab, current.page + 1)}
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
          <div className="mt-3 text-center text-[10px] text-paper-faint">
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
