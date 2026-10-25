"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { Doodle } from "@/components/brand/doodles";
import { circle } from "@/components/brand/doodle-data";

import { useToast } from "@/components/toast";
import { pollJson } from "@/lib/poll-json";
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
        description="View and follow up on your open PRs. Click any PR to see review comments and push fixes."
      />

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Pull request view">
        <button
          id="prs-tab-inbox"
          role="tab"
          aria-selected={tab === "inbox"}
          aria-controls="prs-panel-inbox"
          onClick={() => setTab("inbox")}
          className="pill"
        >
          Inbox
          {(() => {
            const actionable = githubPrs.filter((p) => p.reviewDecision === "CHANGES_REQUESTED" || (p.commentCount ?? 0) > 0);
            return actionable.length > 0 ? (
              <span className="grid min-w-5 place-items-center rounded-full bg-alert px-1.5 text-[11.5px] font-semibold leading-5 text-white tabular-nums">{actionable.length}</span>
            ) : null;
          })()}
        </button>
        <button
          id="prs-tab-github"
          role="tab"
          aria-selected={tab === "github"}
          aria-controls="prs-panel-github"
          onClick={() => setTab("github")}
          className="pill"
        >
          All PRs
          {githubPrs.length > 0 && (
            <span className={cn("text-[12px] tabular-nums", tab === "github" ? "text-ink/75" : "text-paper-muted")}>
              {githubPrs.length}
            </span>
          )}
        </button>
        <button
          id="prs-tab-dashboard"
          role="tab"
          aria-selected={tab === "dashboard"}
          aria-controls="prs-panel-dashboard"
          onClick={() => setTab("dashboard")}
          className="pill"
        >
          Opened with opensrcer
        </button>
      </div>
      <p className="mt-3 max-w-3xl text-[13px] text-paper-muted">
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
            <div className="callout flex items-center justify-between gap-3 text-[13.5px]" data-tone="alert">
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
              <div className="space-y-5">
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
            <div className="callout flex items-center justify-between gap-3 text-[13.5px]" data-tone="alert">
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
              <div className="card overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-b border-border-soft text-paper-muted">
                      <th className="kicker px-4 py-3 text-left font-semibold first:pl-6">Repository</th>
                      <th className="kicker px-4 py-3 text-left font-semibold">Title</th>
                      <th className="kicker px-4 py-3 text-left font-semibold">Status</th>
                      <th className="kicker px-4 py-3 text-left font-semibold">Lines</th>
                      <th className="kicker px-4 py-3 text-left font-semibold">Updated</th>
                      <th className="kicker px-4 py-3 pr-6 text-right font-semibold">Actions</th>
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
                        className="group border-b border-border-soft last:border-0 transition-colors hover:bg-ink-2 cursor-pointer"
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
                              data-size="sm"
                              onClick={(e) => e.stopPropagation()}
                            >
                              review
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
  if (pr.reviewDecision === "REVIEW_REQUIRED") return <span className="chip" data-tone="signal">review needed</span>;
  return <span className="chip" data-tone="signal">open</span>;
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
      <div className="card mt-6 p-10 text-center text-[14px] text-paper-muted">
        No pull requests opened with opensrcer yet. Runs you publish show up here.
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
    <div className="mt-6">
      <Table prs={prs} />
    </div>
  );
}

function InboxSection({ title, subtitle, color, prs, actionHint }: { title: string; subtitle: string; color: string; prs: GitHubPr[]; actionHint?: string }) {
  // A plain colored dot: the title already says what the section is, and a
  // glyph like "x" read as a close button.
  const dot = { alert: "bg-alert", ok: "bg-ok", signal: "bg-signal", info: "bg-info" }[color] ?? "bg-paper-faint";
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-soft px-5 py-4 sm:px-6">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", dot)} />
        <div>
          <span className="text-[16px] font-semibold text-paper">{title}</span>
          <span className="ml-2 text-[13px] text-paper-muted tabular-nums">{prs.length}</span>
        </div>
        <span className="w-full text-[13px] text-paper-muted sm:ml-1 sm:w-auto">{subtitle}</span>
      </div>
      {actionHint && (
        <div className="border-b border-border-soft bg-ink-2 px-5 py-3 text-[13px] leading-[1.55] text-paper-dim sm:px-6">
          {actionHint}
        </div>
      )}
      <div className="divide-y divide-border-soft">
        {prs.map((pr) => (
          <Link
            key={`${pr.repo}#${pr.number}`}
            href={`/prs/${pr.repo}/${pr.number}`}
            className="group grid gap-2 px-5 py-4 transition hover:bg-ink-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-6"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-medium text-paper-dim">{pr.repo}</span>
                <span className="text-[12.5px] text-paper-muted">#{pr.number}</span>
              </div>
              <div className="mt-1 text-[15px] font-semibold leading-snug text-paper group-hover:text-signal sm:truncate">{pr.title}</div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] sm:justify-end">
              {(pr.commentCount ?? 0) > 0 && (
                <span className="text-info tabular-nums">{pr.commentCount} comment{pr.commentCount !== 1 ? "s" : ""}</span>
              )}
              <span className="font-mono text-ok tabular-nums">+{pr.additions}</span>
              <span className="font-mono text-alert tabular-nums">-{pr.deletions}</span>
              <span className="text-paper-muted sm:w-16 sm:text-right">{timeAgo(pr.updatedAt)}</span>
              <span className="row-cta hidden opacity-0 transition group-hover:opacity-100 sm:inline-flex" data-size="sm">review</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function EmptyPrState({ account }: { account?: string }) {
  return (
    <div className="card relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
      <h2 className="display text-[36px] leading-none text-paper sm:text-[48px]">No open pull requests</h2>
      <p className="mt-4 max-w-md text-[15px] leading-[1.6] text-paper-muted">
        {account ? `GitHub returned no open pull requests for ${account}.` : "Choose an issue and opensrcer will keep the resulting draft and review feedback here."}
      </p>
      <Doodle doodle={circle} draw="load" className="pointer-events-none absolute -right-4 top-6 hidden h-36 w-52 sm:block" />
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/discover" className="btn-primary min-h-11 px-6">
          Find an issue
        </Link>
        <Link href="/issues" className="btn-quiet min-h-11 px-6">
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
