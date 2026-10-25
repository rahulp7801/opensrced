"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PullRequest } from "@/lib/types";
import { StatusChip } from "@/components/status-dot";
import { IconExternal, IconFilter } from "@/components/icons";
import { formatRelative, pad, shortSha, cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{ key: string | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "merged", label: "Merged" },
  { key: "open", label: "Open" },
  { key: "ci_passed", label: "CI passed" },
  { key: "ci_failed", label: "CI failed" },
  { key: "draft", label: "Draft" },
  { key: "closed", label: "Closed" },
];

type SortKey = "created" | "repo" | "status" | "lines";

export function PrTable({ prs }: { prs: PullRequest[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "created",
    dir: "desc",
  });

  const filtered = useMemo(() => {
    let list = prs.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (q && !`${p.repo} ${p.title} ${p.pr_number}`.toLowerCase().includes(q.toLowerCase()))
        return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.key) {
        case "repo":
          return a.repo.localeCompare(b.repo) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "lines":
          return (a.lines_changed - b.lines_changed) * dir;
        case "created":
        default:
          return a.created_at.localeCompare(b.created_at) * dir;
      }
    });
    return list;
  }, [prs, filter, q, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <IconFilter className="text-paper-muted" />
          <span className="text-[13px] font-semibold text-paper-muted">Status</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className="pill"
              data-size="sm"
              data-quiet={filter === f.key ? undefined : ""}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search pull requests opened with opensrcer"
            placeholder="search repo, title, #pr"
            className="field min-h-10 py-1.5 sm:w-64"
          />
          <span className="shrink-0 text-[13px] text-paper-muted tabular-nums">
            {filtered.length} / {prs.length}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-border-soft text-paper-muted">
              <Th>№</Th>
              <Th>SHA</Th>
              <Th sortable onClick={() => toggleSort("repo")} active={sort.key === "repo"} dir={sort.dir}>Repository</Th>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th sortable onClick={() => toggleSort("status")} active={sort.key === "status"} dir={sort.dir}>Status</Th>
              <Th sortable onClick={() => toggleSort("lines")} active={sort.key === "lines"} dir={sort.dir}>Δ lines</Th>
              <Th sortable onClick={() => toggleSort("created")} active={sort.key === "created"} dir={sort.dir}>Created</Th>
              <Th align="right">Open</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((pr, i) => {
              const added = pr.lines_changed - Math.floor(pr.lines_changed * 0.18);
              const removed = Math.floor(pr.lines_changed * 0.18);
              return (
                <tr
                  key={pr.id}
                  className="group border-b border-border-soft last:border-0 transition-colors hover:bg-ink-2"
                >
                  <td className="px-4 py-3.5 pl-6 font-mono text-[12.5px] text-paper-muted tabular-nums w-12">{pad(i + 1, 3)}</td>
                  <td className="px-4 py-3.5 font-mono text-[12.5px] text-paper-muted tabular-nums">{shortSha(pr.repo, pr.pr_number)}</td>
                  <td className="px-4 py-3.5 text-paper-dim max-w-[220px] truncate">{pr.repo}</td>
                  <td className="px-4 py-3.5 font-medium text-paper max-w-[440px] truncate">{pr.title}</td>
                  <td className="px-4 py-3.5">
                    <span className="text-[12.5px] font-medium text-paper-dim">
                      {pr.contribution_type.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <PrStatusChip status={pr.status} />
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[12.5px] tabular-nums">
                    <span className="text-ok">+{added}</span>
                    <span className="text-paper-muted"> / </span>
                    <span className="text-alert">−{removed}</span>
                  </td>
                  <td className="px-4 py-3.5 text-[12.5px] text-paper-muted whitespace-nowrap">
                    {formatRelative(pr.created_at)}
                  </td>
                  <td className="px-4 py-3.5 pr-6 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/prs/${pr.repo}/${pr.pr_number}`}
                        className="row-cta"
                        data-size="sm"
                        title="Review & fix comments"
                      >
                        review
                      </Link>
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-paper-muted hover:text-signal"
                        title="Open on GitHub"
                      >
                        #{pr.pr_number}
                        <IconExternal />
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-paper-muted text-[14px]">
                  No PRs match — clear the filter or search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  sortable,
  onClick,
  active,
  dir,
  align = "left",
}: {
  children: React.ReactNode;
  sortable?: boolean;
  onClick?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "kicker py-3 px-4 font-semibold first:pl-6 last:pr-6",
        align === "right" ? "text-right" : "text-left",
        sortable && "cursor-pointer hover:text-paper select-none",
        active && "text-paper",
      )}
      onClick={onClick}
    >
      {children}
      {sortable && (
        <span className="ml-1 text-paper-muted">

          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      )}
    </th>
  );
}

function PrStatusChip({ status }: { status: string }) {
  const map: Record<string, { tone: "ok" | "signal" | "alert" | "muted" | "info"; text: string }> = {
    merged: { tone: "ok", text: "merged" },
    open: { tone: "signal", text: "open" },
    ci_passed: { tone: "info", text: "ci ok" },
    ci_failed: { tone: "alert", text: "ci fail" },
    draft: { tone: "muted", text: "draft" },
    closed: { tone: "muted", text: "closed" },
  };
  const cfg = map[status] ?? { tone: "muted" as const, text: status };
  return <StatusChip tone={cfg.tone}>{cfg.text}</StatusChip>;
}
