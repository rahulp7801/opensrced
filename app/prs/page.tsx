"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
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
};

type Tab = "github" | "dashboard";

export default function PRsPage() {
  const [tab, setTab] = useState<Tab>("github");
  const [githubPrs, setGithubPrs] = useState<GitHubPr[]>([]);
  const [githubLogin, setGithubLogin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "github" && githubPrs.length === 0) {
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

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>Pull requests</>}
        description="View and follow up on your open PRs. Click any PR to see review comments and push fixes."
      />

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-0 border-b border-border">
        <button
          onClick={() => setTab("github")}
          className={cn(
            "px-4 py-2 text-[12px] transition-colors border-b-2 -mb-px",
            tab === "github"
              ? "text-signal border-signal"
              : "text-paper-muted border-transparent hover:text-paper",
          )}
        >
          My open PRs
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

      {/* GitHub PRs tab */}
      {tab === "github" && (
        <div className="mt-4">
          {loading && (
            <div className="text-[12px] text-paper-muted animate-pulse-signal py-8 text-center">
              Fetching open PRs from GitHub...
            </div>
          )}

          {error && (
            <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">
              {error}
            </div>
          )}

          {!loading && !error && githubPrs.length === 0 && (
            <div className="border border-border bg-surface/40 p-8 text-center text-[12px] text-paper-muted">
              No open PRs found for {githubLogin || "your account"}.
            </div>
          )}

          {!loading && githubPrs.length > 0 && (
            <>
            {/* Summary stats */}
            <div className="flex items-center gap-4 mb-3 flex-wrap">
              <div className="flex items-center gap-4 text-[11px]">
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
            </div>
            <div className="border border-border bg-surface/40 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-ink/50 text-paper-muted">
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">
                      Repository
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">
                      Title
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">
                      Lines
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em]">
                      Updated
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-[0.12em]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {githubPrs.map((pr) => (
                    <tr
                      key={`${pr.repo}#${pr.number}`}
                      className="group border-b border-border-soft last:border-0 transition-colors hover:bg-surface-2/60"
                    >
                      <td className="px-3 py-2.5 text-paper-dim max-w-[200px] truncate">
                        {pr.repo}
                      </td>
                      <td className="px-3 py-2.5 text-paper max-w-[400px] truncate">
                        {pr.title}
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
                            className="text-[10px] text-signal border border-signal/30 hover:bg-signal/10 px-1.5 py-0.5 transition"
                          >
                            review
                          </Link>
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
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
            </>
          )}
        </div>
      )}

      {/* Dashboard PRs tab — lazy load the old server component */}
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
        Loading dispatch PRs...
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

  // Dynamically import PrTable to avoid bundling it in the initial load
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
