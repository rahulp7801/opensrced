"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PullRequest } from "@/lib/types";
import { StatusChip } from "@/components/status-dot";
import { IconExternal, IconSearch, IconFilter } from "@/components/icons";
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
      <div className="flex flex-wrap items-center gap-3 border border-border border-b-0 bg-surface/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <IconFilter className="text-paper-muted" />
          <span className="text-[12px] text-paper-muted">Status</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-2.5 py-1 text-[11px] border transition-colors",
                filter === f.key
                  ? "border-signal/60 bg-signal/10 text-signal"
                  : "border-border text-paper-muted hover:text-paper hover:border-border-strong",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 border border-border bg-ink px-2.5 py-1.5 focus-within:border-signal transition-colors">
            <IconSearch className="text-paper-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search repo, title, #pr"
              className="w-64 bg-transparent text-[12px] text-paper placeholder:text-paper-faint focus:outline-none"
            />
          </div>
          <span className="text-[11px] text-paper-muted tabular-nums">
            {filtered.length}<span className="text-paper-faint"> / {prs.length}</span>
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border bg-surface/40 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-ink/50 text-paper-muted">
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
                  className="group border-b border-border-soft last:border-0 transition-colors hover:bg-surface-2/60"
                >
                  <td className="px-3 py-2.5 text-paper-muted tabular-nums w-12">{pad(i + 1, 3)}</td>
                  <td className="px-3 py-2.5 text-paper-faint tabular-nums">{shortSha(pr.repo, pr.pr_number)}</td>
                  <td className="px-3 py-2.5 text-paper-dim max-w-[220px] truncate">{pr.repo}</td>
                  <td className="px-3 py-2.5 text-paper max-w-[440px] truncate">{pr.title}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-paper-dim">
                      {pr.contribution_type.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <PrStatusChip status={pr.status} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <span className="text-ok">+{added}</span>
                    <span className="text-paper-faint"> / </span>
                    <span className="text-alert">−{removed}</span>
                  </td>
                  <td className="px-3 py-2.5 text-paper-muted whitespace-nowrap">
                    {formatRelative(pr.created_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/prs/${pr.repo}/${pr.pr_number}`}
                        className="text-[10px] text-signal border border-signal/30 hover:bg-signal/10 px-1.5 py-0.5 transition"
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
                <td colSpan={9} className="py-12 text-center text-paper-muted text-[12px]">
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
        "py-2.5 px-3 font-normal tracking-[0.15em] text-[10px] uppercase",
        align === "right" ? "text-right" : "text-left",
        sortable && "cursor-pointer hover:text-paper select-none",
        active && "text-paper",
      )}
      onClick={onClick}
    >
      {children}
      {sortable && (
        <span className="ml-1 text-paper-faint">
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
