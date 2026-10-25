"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";

import { useToast } from "@/components/toast";
import { pollJson } from "@/lib/poll-json";

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

function isGitHubPr(value: unknown): value is GitHubPr {
  if (!value || typeof value !== "object") return false;
  const pr = value as Partial<GitHubPr>;
  return typeof pr.repo === "string"
    && typeof pr.title === "string"
    && Number.isInteger(pr.number)
    && typeof pr.url === "string"
    && typeof pr.state === "string"
    && typeof pr.createdAt === "string"
    && typeof pr.updatedAt === "string"
    && typeof pr.branch === "string"
    && typeof pr.base === "string"
    && typeof pr.additions === "number" && Number.isFinite(pr.additions)
    && typeof pr.deletions === "number" && Number.isFinite(pr.deletions)
    && typeof pr.reviewDecision === "string"
    && typeof pr.isDraft === "boolean"
    && (pr.commentCount === undefined || Number.isInteger(pr.commentCount));
}

export default function PRsPage() {
  const [refresh, setRefresh] = useState(0);
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
    setLoading(true);
    setError(null);
    return pollJson<unknown>("/api/prs/github", result => {
      setLoading(false);
      if (result.error !== null) { setError(result.error); return; }
      const data = result.data as { login?: unknown; prs?: unknown } | null;
      if (!data || typeof data.login !== "string" || !Array.isArray(data.prs)) {
        setError("GitHub returned an invalid pull request list. Please refresh.");
        return;
      }
      const prs = data.prs.filter(isGitHubPr);
      if (data.prs.length > 0 && prs.length === 0) {
        setError("GitHub returned an invalid pull request list. Please refresh.");
        return;
      }
      setGithubLogin(data.login);
      setGithubPrs(prs);
      if (refresh > 0) toast("PRs refreshed", "ok");
    });
  }, [refresh, toast]);

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

  function handleRefresh() { setRefresh(value => value + 1); }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Pull requests</>}
        description="Your open pull requests: read what reviewers asked, then draft the fixes and replies."
      />

      <div className="tab-strip" role="tablist" aria-label="Pull request view">
        <button
          id="prs-tab-inbox"
          role="tab"
          aria-selected={tab === "inbox"}
          aria-controls="prs-panel-inbox"
          onClick={() => setTab("inbox")}
        >
          Inbox
          {(() => {
            const actionable = githubPrs.filter((p) => p.reviewDecision === "CHANGES_REQUESTED" || (p.commentCount ?? 0) > 0);
            return actionable.length > 0 ? (
              <span className="tab-count text-alert">{actionable.length}</span>
            ) : null;
          })()}
        </button>
        <button
          id="prs-tab-github"
          role="tab"
          aria-selected={tab === "github"}
          aria-controls="prs-panel-github"
          onClick={() => setTab("github")}
        >
          All PRs
          {githubPrs.length > 0 && <span className="tab-count">{githubPrs.length}</span>}
        </button>
        <button
          id="prs-tab-dashboard"
          role="tab"
          aria-selected={tab === "dashboard"}
          aria-controls="prs-panel-dashboard"
          onClick={() => setTab("dashboard")}
        >
          Opened with opensrcer
        </button>
      </div>
      <p className="mt-3 max-w-3xl text-[14px] text-paper-muted">
        Inbox and All PRs show every open pull request you started on GitHub. &ldquo;Opened with opensrcer&rdquo; lists only the ones opensrcer runs opened for you.
      </p>

      {/* Inbox tab — prioritized overview */}
      {tab === "inbox" && (
        <div id="prs-panel-inbox" role="tabpanel" aria-labelledby="prs-tab-inbox" className="mt-6">
          {loading && (
            <div className="card divide-y divide-border-soft overflow-hidden animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2 px-5 py-5">
                  <div className="h-3 w-40 max-w-full rounded-full bg-surface-2" />
                  <div className="h-3.5 w-72 max-w-full rounded-full bg-surface-3" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="callout flex items-center justify-between gap-3 text-[15px]" data-tone="alert">
              <span>{error}</span>
              <button onClick={handleRefresh} className="btn-quiet" data-size="sm">retry</button>
            </div>
          )}

          {!loading && !error && githubPrs.length === 0 && (
            <EmptyPrState />
          )}

          {!loading && githubPrs.length > 0 && (() => {
            const needsAction = githubPrs.filter((p) => p.reviewDecision === "CHANGES_REQUESTED");
            const hasComments = githubPrs.filter((p) => (p.commentCount ?? 0) > 0 && p.reviewDecision !== "CHANGES_REQUESTED" && p.reviewDecision !== "APPROVED");
            const approved = githubPrs.filter((p) => p.reviewDecision === "APPROVED");
            // Stale is the older half of "Waiting for review": PRs with comments
            // are already listed under "Has comments", drafts under "Drafts".
            const stale = githubPrs.filter((p) => {
              const daysSince = (Date.now() - new Date(p.updatedAt).getTime()) / 86400000;
              return !p.isDraft && (p.commentCount ?? 0) === 0 && daysSince > 7 && p.reviewDecision !== "APPROVED" && p.reviewDecision !== "CHANGES_REQUESTED";
            });
            const drafts = githubPrs.filter((p) => p.isDraft);
            const waiting = githubPrs.filter((p) =>
              !p.isDraft && p.reviewDecision !== "APPROVED" && p.reviewDecision !== "CHANGES_REQUESTED" &&
              (p.commentCount ?? 0) === 0 && (Date.now() - new Date(p.updatedAt).getTime()) / 86400000 <= 7
            );

            return (
              <div className="space-y-10">
                {/* Needs action — top priority */}
                {needsAction.length > 0 && (
                  <InboxSection
                    title="Needs your action"
                    subtitle="Reviewers requested changes"
                    color="alert"
                    prs={needsAction}
                    actionHint="Open a PR to read what reviewers asked for. opensrcer can draft each change for you to check: a quick fix looks at the file being discussed; a deep fix explores the whole project first, so it takes longer and costs more."
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
        <div id="prs-panel-github" role="tabpanel" aria-labelledby="prs-tab-github" className="mt-6">
          {loading && (
            <div className="card divide-y divide-border-soft overflow-hidden animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-3 w-40 rounded-full bg-surface-2" />
                  <div className="h-3 w-72 rounded-full bg-surface-3" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="callout flex items-center justify-between gap-3 text-[15px]" data-tone="alert">
              <span>{error}</span>
              <button onClick={handleRefresh} className="btn-quiet" data-size="sm">
                retry
              </button>
            </div>
          )}

          {!loading && !error && githubPrs.length === 0 && (
            <EmptyPrState account={githubLogin || "your account"} />
          )}

          {!loading && githubPrs.length > 0 && (
            <>
              {/* Filter bar */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                {/* Summary stats */}
                <div className="flex items-center gap-3 text-[13px]">
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
                      <span className="text-paper-muted">
                        <span className="tabular-nums">{drafts.length}</span> draft
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="w-full md:w-auto md:ml-auto flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <input
                    aria-label="Search pull requests"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search PRs..."
                    className="field min-h-10 w-full py-1.5 sm:w-[200px]"
                  />
                  {/* Status filter */}
                  <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Pull request status">
                    {([
                      { key: "all", label: "All" },
                      { key: "changes_requested", label: "Needs changes" },
                      { key: "approved", label: "Approved" },
                      { key: "review_needed", label: "Review needed" },
                      { key: "draft", label: "Draft" },
                    ] as const).map((f) => (
                      <button
                        key={f.key}
                        aria-pressed={statusFilter === f.key}
                        onClick={() => setStatusFilter(f.key)}
                        className="pill"
                        data-size="sm"
                        data-quiet={statusFilter === f.key ? undefined : ""}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="btn-quiet"
                    data-size="sm"
                  >
                    refresh
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border-y border-border-soft">
                <table className="w-full text-[15px]">
                  <thead>
                    <tr className="border-b border-border-soft text-paper-muted">
                      <th className="px-4 py-3 text-left font-mono text-[12px] font-normal text-paper-faint first:pl-6">Repository</th>
                      <th className="px-4 py-3 text-left font-mono text-[12px] font-normal text-paper-faint">Title</th>
                      <th className="px-4 py-3 text-left font-mono text-[12px] font-normal text-paper-faint">Status</th>
                      <th className="px-4 py-3 text-left font-mono text-[12px] font-normal text-paper-faint">Lines</th>
                      <th className="px-4 py-3 text-left font-mono text-[12px] font-normal text-paper-faint">Updated</th>
                      <th className="px-4 py-3 pr-6 text-right font-mono text-[12px] font-normal text-paper-faint">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-[14px] text-paper-muted">
                          No PRs match your filters.{" "}
                          <button onClick={() => { setStatusFilter("all"); setSearchQuery(""); }} className="link">
                            Clear filters
                          </button>
                        </td>
                      </tr>
                    )}
                    {paginated.map((pr) => (
                      <tr
                        key={`${pr.repo}#${pr.number}`}
                        className="group border-b border-border-soft last:border-0 transition-colors hover:bg-surface cursor-pointer"
                      >
                        <td className="px-4 py-3.5 pl-6 text-paper-dim max-w-[200px] truncate">
                          <Link href={`/prs/${pr.repo}/${pr.number}`} className="hover:text-signal transition-colors">
                            {pr.repo}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-paper max-w-[400px] truncate">
                          <Link href={`/prs/${pr.repo}/${pr.number}`} className="hover:text-signal transition-colors">
                            {pr.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5">
                          <PrBadge pr={pr} />
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[12.5px] tabular-nums">
                          <span className="text-ok">+{pr.additions}</span>
                          <span className="text-paper-muted"> / </span>
                          <span className="text-alert">-{pr.deletions}</span>
                        </td>
                        <td className="px-4 py-3.5 text-paper-muted whitespace-nowrap text-[12.5px]">
                          {timeAgo(pr.updatedAt)}
                        </td>
                        <td className="px-4 py-3.5 pr-6 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              href={`/prs/${pr.repo}/${pr.number}`}
                              className="row-cta"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Review <span aria-hidden>→</span>
                            </Link>
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-paper-muted hover:text-signal text-[12.5px]"
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
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <span className="text-paper-muted">
                    Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="pill"
                      data-size="sm"
                    >
                      prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setPage(i)}
                        aria-current={i === page ? "page" : undefined}
                        className="pill tabular-nums"
                        data-size="sm"
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="pill"
                      data-size="sm"
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
      {tab === "dashboard" && <div id="prs-panel-dashboard" role="tabpanel" aria-labelledby="prs-tab-dashboard"><DashboardPrs /></div>}
    </div>
  );
}

function PrBadge({ pr }: { pr: GitHubPr }) {
  if (pr.isDraft) return <span className="chip">draft</span>;
  if (pr.reviewDecision === "APPROVED") return <span className="chip" data-tone="ok">approved</span>;
  if (pr.reviewDecision === "CHANGES_REQUESTED") return <span className="chip" data-tone="alert">changes requested</span>;
  if (pr.reviewDecision === "REVIEW_REQUIRED") return <span className="chip" data-tone="info">review needed</span>;
  return <span className="chip" data-tone="info">open</span>;
}

function DashboardPrs() {
  const [prs, setPrs] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => pollJson<unknown[]>("/api/prs", ({ data, error }) => {
    setLoading(false);
    setError(error);
    if (data) setPrs(data);
  }), []);

  if (loading) {
    return (
      <div role="status" className="mt-6 py-10 text-center text-[14px] text-paper-muted">
        Fetching pull requests opened with opensrcer...
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="callout mt-6 p-8 text-center text-[14px]" data-tone="alert">
        Could not load pull requests opened with opensrcer. {error}
      </div>
    );
  }

  if (!prs.length) {
    return (
      <p className="mt-6 border-y border-border-soft py-8 text-[16px] text-paper-muted">
        No pull requests opened with opensrcer yet. Runs you publish show up here.
      </p>
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
    <div className="mt-6">
      <Table prs={prs} />
    </div>
  );
}

function InboxSection({ title, subtitle, prs, actionHint }: { title: string; subtitle: string; color: string; prs: GitHubPr[]; actionHint?: string }) {
  // A group is a heading with a mono count and one line of why, then a ruled
  // list: no card, no coloured band (the title already says what it is).
  return (
    <section aria-label={title}>
      <div className="list-head">
        <div>
          <h2 className="inline text-[15px] font-semibold text-paper">{title}</h2>
          <span className="ml-2 font-mono text-[12px] text-paper-faint tabular-nums">{prs.length}</span>
        </div>
        <span className="text-[14px] text-paper-muted">{subtitle}</span>
      </div>
      {actionHint && <p className="-mt-1 mb-3 max-w-3xl text-[14px] leading-[1.55] text-paper-muted">{actionHint}</p>}
      <div className="ruled">
        {prs.map((pr) => (
          <Link
            key={`${pr.repo}#${pr.number}`}
            href={`/prs/${pr.repo}/${pr.number}`}
            className="group grid gap-2 py-[18px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
          >
            <div className="min-w-0">
              <div className="text-[16px] font-semibold leading-snug text-paper sm:truncate">{pr.title}</div>
              <p className="meta mt-1">
                <span>{pr.repo} #{pr.number}</span>
                {(pr.commentCount ?? 0) > 0 && <span>{pr.commentCount} comment{pr.commentCount !== 1 ? "s" : ""}</span>}
                <span>+{pr.additions} −{pr.deletions}</span>
                <span>{timeAgo(pr.updatedAt)}</span>
              </p>
            </div>
            <span aria-hidden className="row-cta hidden sm:inline-flex">Review →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EmptyPrState({ account }: { account?: string }) {
  return (
    <div className="border-y border-border-soft py-10">
      <h2 className="max-w-2xl font-display text-[22px] leading-[1.3] text-paper" style={{ fontWeight: 650 }}>
        No open pull requests.{" "}
        <span className="font-sans font-normal text-paper-muted">
          {account ? `GitHub returned none for ${account}. Pick an issue someone wants fixed, and its draft and reviews will show up here.` : "Choose an issue and opensrcer will keep the resulting draft and review feedback here."}
        </span>
      </h2>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link href="/discover" className="btn-primary">
          Find an issue
        </Link>
        <Link href="/issues" className="text-link">
          Browse suggested issues
        </Link>
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
