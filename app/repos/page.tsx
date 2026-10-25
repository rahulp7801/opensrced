"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";

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
        [t]: { ...prev[t], loading: false, error: err instanceof Error && err.name === "TimeoutError"
          ? "GitHub took too long to return repositories. Try again."
          : err instanceof Error ? err.message : String(err) },
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
        description="Repositories you own, starred or contributed to: map one, or scan its issues."
      />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="tab-strip w-full sm:w-auto sm:flex-1" role="tablist" aria-label="Repository source">
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
            >
              {t.label}
              {states[t.key].repos.length > 0 && (
                <span className="tab-count">
                  {states[t.key].repos.length}{states[t.key].hasMore ? "+" : ""}
                </span>
              )}
            </button>
          ))}
        </div>

        <input
          type="search"
          aria-label="Filter repositories"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter repos"
          className="field sm:ml-auto sm:w-64"
        />
      </div>

      <div id="repos-panel" role="tabpanel" aria-labelledby={`repos-tab-${tab}`} className="mt-6">
        {current.error && (
          <div role="alert" className="callout mb-4 flex flex-col gap-3 text-[15px] sm:flex-row sm:items-center sm:justify-between" data-tone="alert">
            <div>
              <p className="font-semibold">Couldn&apos;t load your repos from GitHub.</p>
              {/* A bare server error adds nothing; a specific reason is worth showing. */}
              {!/^internal server error\.?$/i.test(current.error.trim()) && <p className="mt-0.5 text-paper-dim">{current.error}</p>}
            </div>
            <button
              type="button"
              className="btn-quiet shrink-0 self-start sm:self-auto"
              data-size="sm"
              disabled={current.loading}
              onClick={() => fetchPage(tab, current.page + 1, current.nextCursor)}
            >
              Retry
            </button>
          </div>
        )}

        {current.page === 0 && current.loading && (
          <div role="status" className="py-10 text-center text-[15px] text-paper-muted">
            Loading repos from GitHub...
          </div>
        )}

        {current.page > 0 && filtered.length === 0 && !current.loading && (
          search ? (
            <p className="border-y border-border-soft py-10 text-[15px] text-paper-muted">No repos match your search.</p>
          ) : (
            <div className="border-y border-border-soft py-10">
              <p className="max-w-2xl font-display text-[22px] leading-[1.3] text-paper" style={{ fontWeight: 650 }}>
                <span>No repos here yet.</span>{" "}
                <span className="font-sans font-normal text-paper-muted">A good first step: pick a beginner-friendly issue in a public project.</span>
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href="/issues" className="btn-primary">Find a beginner issue</Link>
                <Link href="/discover" className="text-link">Discover projects</Link>
              </div>
            </div>
          )
        )}

        {filtered.length > 0 && (
          <div className="ruled">
            {filtered.map((repo) => (
              <div
                key={repo.nameWithOwner}
                className="group flex flex-wrap items-center gap-x-5 gap-y-2 py-[18px]"
              >

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://github.com/${repo.nameWithOwner}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-[16px] font-semibold text-paper hover:text-signal"
                    >
                      {repo.nameWithOwner}
                    </a>
                    {repo.isPrivate && (
                      <span className="tag">private</span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-1 max-w-[560px] truncate text-[14px] text-paper-muted">{repo.description}</p>
                  )}
                </div>
                <p className="meta hidden shrink-0 sm:flex">
                  {repo.language && <span>{repo.language.toLowerCase()}</span>}
                  <span>★ {repo.stars.toLocaleString()}</span>
                  {repo.updatedAt && <span>{timeAgo(repo.updatedAt)}</span>}
                </p>
                <div className="flex w-full items-center gap-5 sm:w-auto">
                  <Link
                    href={`/graph?repo=${encodeURIComponent(repo.nameWithOwner)}`}
                    className="text-link text-[14px]"
                  >
                    Graph
                  </Link>
                  <Link
                    href={`/issues?repo=${encodeURIComponent(repo.nameWithOwner)}`}
                    className="row-cta"
                  >
                    Issues <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more / loading indicator */}
        {current.hasMore && current.page > 0 && (
          <div className="mt-5 text-center">
            <button
              onClick={() => fetchPage(tab, current.page + 1, current.nextCursor)}
              disabled={current.loading}
              className="btn-quiet"
            >
              {current.loading ? "loading..." : "load more"}
            </button>
          </div>
        )}

        {!current.hasMore && current.repos.length > 0 && (
          <div className="mt-5 text-center text-[12.5px] text-paper-muted">
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
