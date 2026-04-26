"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

type GitHubPr = {
  repo: string;
  title: string;
  number: number;
  url: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  branch: string;
  base: string;
  additions: number;
  deletions: number;
  reviewDecision: string;
  isDraft: boolean;
  commentCount?: number;
};

type Tab = "inbox" | "github" | "dashboard";
type StatusFilter = "all" | "changes_requested" | "approved" | "review_needed" | "draft";

const PAGE_SIZE = 10;

export default function PRsPage() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [githubPrs, setGithubPrs] = useState<GitHubPr[]>([]);
  const [githubLogin, setGithubLogin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if ((tab === "github" || tab === "inbox") && githubPrs.length === 0) {
      setLoading(true);
      setError(null);
      fetch("/api/prs/github")
        .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error))))
        .then((data: { login: string; prs: GitHubPr[] }) => {
          setGithubLogin(data.login);
          setGithubPrs(data.prs);
        })
        .catch((err) => setError(typeof err === "string" ? err : String(err)))
        .finally(() => setLoading(false));
    }
  }, [tab, githubPrs.length]);

  // Filter + search
  const filtered = useMemo(() => {
    let prs = githubPrs;
    if (statusFilter !== "all") {
      prs = prs.filter((pr) => {
        if (statusFilter === "changes_requested") return pr.reviewDecision === "CHANGES_REQUESTED";
        if (statusFilter === "approved") return pr.reviewDecision === "APPROVED";
        if (statusFilter === "review_needed") return pr.reviewDecision === "REVIEW_REQUIRED";
        if (statusFilter === "draft") return pr.isDraft;
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      prs = prs.filter((pr) =>
        pr.repo.toLowerCase().includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q)
      );
    }
    return prs;
  }, [githubPrs, statusFilter, searchQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [statusFilter, searchQuery]);

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setGithubPrs([]);
    fetch("/api/prs/github")
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error))))
      .then((data: { login: string; prs: GitHubPr[] }) => {
        setGithubLogin(data.login);
        setGithubPrs(data.prs);
        toast("PRs refreshed", "ok");
      })
      .catch((err) => {
        setError(typeof err === "string" ? err : String(err));
        toast("Failed to load PRs", "alert");
      })
      .finally(() => setLoading(false));
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>Pull requests</>}
        description="View and follow up on your open PRs. Click any PR to see review comments and push fixes."
      />

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-0 border-b border-border">
        <button
          onClick={() => setTab("inbox")}
          className={cn(
            "px-4 py-2 text-[12px] transition-colors border-b-2 -mb-px",
            tab === "inbox"
              ? "text-signal border-signal"
              : "text-paper-muted border-transparent hover:text-paper",
          )}
        >
          Inbox
          {(() => {
            const actionable = githubPrs.filter((p) => p.reviewDecision === "CHANGES_REQUESTED" || (p.commentCount ?? 0) > 0);
            return actionable.length > 0 ? (
              <span className="ml-1.5 text-[10px] tabular-nums text-alert">{actionable.length}</span>
            ) : null;
          })()}
        </button>
        <button
          onClick={() => setTab("github")}
          className={cn(
            "px-4 py-2 text-[12px] transition-colors border-b-2 -mb-px",
            tab === "github"
              ? "text-signal border-signal"
              : "text-paper-muted border-transparent hover:text-paper",
          )}
        >
          All PRs
          {githubPrs.length > 0 && (
            <span className="ml-1.5 text-[10px] tabular-nums text-paper-faint">
              ({githubPrs.length})
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("dashboard")}
          className={cn(
            "px-4 py-2 text-[12px] transition-colors border-b-2 -mb-px",
            tab === "dashboard"
              ? "text-signal border-signal"
              : "text-paper-muted border-transparent hover:text-paper",
          )}
        >
          Dashboard PRs
        </button>
      </div>

      {/* Inbox tab — prioritized overview */}
      {tab === "inbox" && (
        <div className="mt-4">
          {loading && (
            <div className="border border-border bg-surface/40 divide-y divide-border-soft animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                  <div className="h-8 w-8 bg-surface-2 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-72 bg-surface-2 rounded" />
                    <div className="h-3 w-48 bg-surface-2 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert flex items-center justify-between">
              <span>{error}</span>
              <button onClick={handleRefresh} className="text-[10px] border border-alert/30 px-2 py-0.5 hover:bg-alert/10 transition">retry</button>
            </div>
          )}

          {!loading && !error && githubPrs.length === 0 && (
            <div className="border border-border bg-surface/40 p-8 text-center text-[12px] text-paper-muted">
              No open PRs yet. <Link href="/discover" className="text-signal hover:underline">Discover issues to fix</Link> or <Link href="/issues" className="text-signal hover:underline">browse suggested issues</Link> to get started.
            </div>
          )}

          {!loading && githubPrs.length > 0 && (() => {
            const needsAction = githubPrs.filter((p) => p.reviewDecision === "CHANGES_REQUESTED");
            const hasComments = githubPrs.filter((p) => (p.commentCount ?? 0) > 0 && p.reviewDecision !== "CHANGES_REQUESTED" && p.reviewDecision !== "APPROVED");
            const approved = githubPrs.filter((p) => p.reviewDecision === "APPROVED");
            const stale = githubPrs.filter((p) => {
              const daysSince = (Date.now() - new Date(p.updatedAt).getTime()) / 86400000;
              return daysSince > 7 && p.reviewDecision !== "APPROVED" && p.reviewDecision !== "CHANGES_REQUESTED";
            });
            const drafts = githubPrs.filter((p) => p.isDraft);
            const waiting = githubPrs.filter((p) =>
              !p.isDraft && p.reviewDecision !== "APPROVED" && p.reviewDecision !== "CHANGES_REQUESTED" &&
              (p.commentCount ?? 0) === 0 && (Date.now() - new Date(p.updatedAt).getTime()) / 86400000 <= 7
            );

            return (
              <div className="space-y-4">
                {/* Needs action — top priority */}
                {needsAction.length > 0 && (
                  <InboxSection
                    title="Needs your action"
                    subtitle="Reviewers requested changes"
                    color="alert"
                    prs={needsAction}
                    actionHint="Click a PR to review comments and push fixes with quick fix or deep fix."
                  />
                )}

                {hasComments.length > 0 && (
                  <InboxSection
                    title="Has comments"
                    subtitle="Review feedback to address"
                    color="signal"
                    prs={hasComments}
                    actionHint="Click to read comments and draft replies. Use AI to generate responses."
                  />
                )}

                {approved.length > 0 && (
                  <InboxSection
                    title="Ready to merge"
                    subtitle="Approved by reviewers"
                    color="ok"
                    prs={approved}
                    actionHint="These PRs are approved. Merge them on GitHub when ready."
                  />
                )}

                {stale.length > 0 && (
                  <InboxSection
                    title="Stale"
                    subtitle="No activity in 7+ days"
                    color="paper-muted"
                    prs={stale}
                    actionHint="Consider pinging the reviewer or closing if no longer needed."
                  />
                )}

                {waiting.length > 0 && (
                  <InboxSection
                    title="Waiting for review"
                    subtitle="No reviewer feedback yet"
                    color="info"
                    prs={waiting}
                  />
                )}

                {drafts.length > 0 && (
                  <InboxSection
                    title="Drafts"
                    subtitle="Not yet ready for review"
                    color="paper-faint"
                    prs={drafts}
                  />
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* GitHub PRs tab */}
      {tab === "github" && (
        <div className="mt-4">
          {loading && (
            <div className="border border-border bg-surface/40 divide-y divide-border-soft animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-4 w-40 bg-surface-2 rounded" />
                  <div className="h-4 w-72 bg-surface-2 rounded" />
                  <div className="ml-auto flex gap-3">
                    <div className="h-4 w-16 bg-surface-2 rounded" />
                    <div className="h-4 w-12 bg-surface-2 rounded" />
                    <div className="h-4 w-16 bg-surface-2 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert flex items-center justify-between">
              <span>{error}</span>
              <button onClick={handleRefresh} className="text-[10px] border border-alert/30 px-2 py-0.5 hover:bg-alert/10 transition">
                retry
              </button>
            </div>
          )}

          {!loading && !error && githubPrs.length === 0 && (
            <div className="border border-border bg-surface/40 p-8 text-center text-[12px] text-paper-muted">
              No open PRs found for {githubLogin || "your account"}. <Link href="/discover" className="text-signal hover:underline">Find an issue to fix</Link>.
            </div>
          )}

          {!loading && githubPrs.length > 0 && (
            <>
              {/* Filter bar */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                {/* Summary stats */}
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-paper-muted">
                    <span className="text-paper tabular-nums">{githubPrs.length}</span> open
                  </span>
                  {(() => {
                    const needsAction = githubPrs.filter((p) => p.reviewDecision === "CHANGES_REQUESTED");
                    return needsAction.length > 0 ? (
                      <span className="text-alert">
                        <span className="tabular-nums">{needsAction.length}</span> need changes
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const approved = githubPrs.filter((p) => p.reviewDecision === "APPROVED");
                    return approved.length > 0 ? (
                      <span className="text-ok">
                        <span className="tabular-nums">{approved.length}</span> approved
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const drafts = githubPrs.filter((p) => p.isDraft);
                    return drafts.length > 0 ? (
                      <span className="text-paper-faint">
                        <span className="tabular-nums">{drafts.length}</span> draft
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  {/* Search */}
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search PRs..."
                    className="bg-surface border border-border px-2.5 py-1 text-[11px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50 w-[180px]"
                  />
                  {/* Status filter */}
                  <div className="flex items-center gap-0.5">
                    {([
                      { key: "all", label: "All" },
                      { key: "changes_requested", label: "Needs changes" },
                      { key: "approved", label: "Approved" },
                      { key: "review_needed", label: "Review needed" },
                      { key: "draft", label: "Draft" },
                    ] as const).map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setStatusFilter(f.key)}
                        className={cn(
                          "text-[10px] px-2 py-1 transition border",
                          statusFilter === f.key
                            ? "text-signal border-signal/40 bg-signal/10"
                            : "text-paper-faint border-transparent hover:text-paper-muted",
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleRefresh}
                    className="text-[10px] text-paper-dim hover:text-signal border border-border px-2 py-1 transition"
                  >
                    refresh
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="border border-border bg-surface/40 overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border bg-ink/50 text-paper-muted">
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">Repository</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">Title</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">Status</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">Lines</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">Updated</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-[0.12em]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-[12px] text-paper-muted">
                          No PRs match your filters.{" "}
                          <button onClick={() => { setStatusFilter("all"); setSearchQuery(""); }} className="text-signal hover:underline">
                            Clear filters
                          </button>
                        </td>
                      </tr>
                    )}
                    {paginated.map((pr) => (
                      <tr
                        key={`${pr.repo}#${pr.number}`}
                        className="group border-b border-border-soft last:border-0 transition-colors hover:bg-surface-2/60 cursor-pointer"
                      >
                        <td className="px-3 py-2.5 text-paper-dim max-w-[200px] truncate">
                          <Link href={`/prs/${pr.repo}/${pr.number}`} className="hover:text-signal transition-colors">
                            {pr.repo}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-paper max-w-[400px] truncate">
                          <Link href={`/prs/${pr.repo}/${pr.number}`} className="hover:text-signal transition-colors">
                            {pr.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <PrBadge pr={pr} />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          <span className="text-ok">+{pr.additions}</span>
                          <span className="text-paper-faint"> / </span>
                          <span className="text-alert">-{pr.deletions}</span>
                        </td>
                        <td className="px-3 py-2.5 text-paper-muted whitespace-nowrap text-[11px]">
                          {timeAgo(pr.updatedAt)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              href={`/prs/${pr.repo}/${pr.number}`}
                              className="text-signal hover:underline text-[11px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              review
                            </Link>
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-paper-muted hover:text-signal text-[11px]"
                            >
                              #{pr.number} ↗
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="text-paper-faint">
                    Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="px-2.5 py-1 border border-border text-paper-dim hover:text-signal hover:border-signal/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setPage(i)}
                        className={cn(
                          "px-2 py-1 border transition tabular-nums",
                          i === page
                            ? "border-signal/40 text-signal bg-signal/10"
                            : "border-border text-paper-faint hover:text-paper-dim",
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="px-2.5 py-1 border border-border text-paper-dim hover:text-signal hover:border-signal/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Dashboard PRs tab */}
      {tab === "dashboard" && <DashboardPrs />}
    </div>
  );
}

function PrBadge({ pr }: { pr: GitHubPr }) {
  if (pr.isDraft) {
    return (
      <span className="text-[10px] uppercase tracking-[0.12em] text-paper-muted border border-border px-1.5 py-0.5">
        draft
      </span>
    );
  }
  if (pr.reviewDecision === "APPROVED") {
    return (
      <span className="text-[10px] uppercase tracking-[0.12em] text-ok border border-ok/30 px-1.5 py-0.5">
        approved
      </span>
    );
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return (
      <span className="text-[10px] uppercase tracking-[0.12em] text-alert border border-alert/30 px-1.5 py-0.5">
        changes requested
      </span>
    );
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED") {
    return (
      <span className="text-[10px] uppercase tracking-[0.12em] text-signal border border-signal/30 px-1.5 py-0.5">
        review needed
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-[0.12em] text-signal border border-signal/30 px-1.5 py-0.5">
      open
    </span>
  );
}

function DashboardPrs() {
  const [prs, setPrs] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/prs")
      .then((r) => r.json())
      .then(setPrs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mt-4 text-[12px] text-paper-muted animate-pulse-signal py-8 text-center">
        Fetching PRs created through the dashboard...
      </div>
    );
  }

  if (!prs.length) {
    return (
      <div className="mt-4 border border-border bg-surface/40 p-8 text-center text-[12px] text-paper-muted">
        No PRs created through the dashboard yet.
      </div>
    );
  }

  return <LazyPrTable prs={prs} />;
}

function LazyPrTable({ prs }: { prs: unknown[] }) {
  const [Table, setTable] = useState<React.ComponentType<{ prs: unknown[] }> | null>(null);

  useEffect(() => {
    import("@/components/pr-table").then((mod) => {
      setTable(() => mod.PrTable as unknown as React.ComponentType<{ prs: unknown[] }>);
    });
  }, []);

  if (!Table) return null;
  return (
    <div className="mt-4">
      <Table prs={prs} />
    </div>
  );
}

function InboxSection({ title, subtitle, color, prs, actionHint }: { title: string; subtitle: string; color: string; prs: GitHubPr[]; actionHint?: string }) {
  const statusIcon = color === "alert" ? "x" : color === "ok" ? "+" : color === "signal" ? "!" : color === "info" ? "~" : "-";
  return (
    <div className="border border-border bg-surface/40">
      <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-3">
        <span className="text-[12px] font-mono" role="img" aria-label={title}>{statusIcon}</span>
        <div>
          <span className="text-[12px] text-paper font-medium">{title}</span>
          <span className="ml-2 text-[10px] text-paper-faint tabular-nums">{prs.length}</span>
        </div>
        <span className="text-[10px] text-paper-faint ml-1">{subtitle}</span>
      </div>
      {actionHint && (
        <div className="px-4 py-1.5 border-b border-border-soft bg-ink/20 text-[10px] text-paper-faint">
          {actionHint}
        </div>
      )}
      <div className="divide-y divide-border-soft">
        {prs.map((pr) => (
          <Link
            key={`${pr.repo}#${pr.number}`}
            href={`/prs/${pr.repo}/${pr.number}`}
            className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/60 transition group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-paper-dim truncate">{pr.repo}</span>
                <span className="text-[10px] text-paper-faint">#{pr.number}</span>
              </div>
              <div className="text-[12px] text-paper truncate mt-0.5">{pr.title}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-[10px]">
              {(pr.commentCount ?? 0) > 0 && (
                <span className="text-info tabular-nums">{pr.commentCount} comment{pr.commentCount !== 1 ? "s" : ""}</span>
              )}
              <span className="text-ok tabular-nums">+{pr.additions}</span>
              <span className="text-alert tabular-nums">-{pr.deletions}</span>
              <span className="text-paper-faint w-16 text-right">{timeAgo(pr.updatedAt)}</span>
              <span className="text-signal opacity-0 group-hover:opacity-100 transition">review</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
