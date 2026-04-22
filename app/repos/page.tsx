"use client";

import { useState, useEffect } from "react";
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

const LANG_COLORS: Record<string, string> = {
  Rust: "#dea584",
  Python: "#3572a5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Go: "#00add8",
  "C++": "#f34b7d",
  Java: "#b07219",
  Ruby: "#701516",
  PHP: "#4F5D95",
  "C#": "#178600",
  C: "#555555",
  Shell: "#89e051",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
};

export default function ReposPage() {
  const [tab, setTab] = useState<Tab>("contributed");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fetched, setFetched] = useState<Set<Tab>>(new Set());

  useEffect(() => {
    if (fetched.has(tab)) return;
    setLoading(true);
    setError(null);

    fetch(`/api/repos/github?tab=${tab}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error))))
      .then((data: { repos: GitHubRepo[] }) => {
        setRepos((prev) => [...prev.filter((r) => r.source !== tab), ...data.repos]);
        setFetched((prev) => new Set(prev).add(tab));
      })
      .catch((err) => setError(typeof err === "string" ? err : String(err)))
      .finally(() => setLoading(false));
  }, [tab, fetched]);

  const filtered = repos
    .filter((r) => r.source === tab)
    .filter((r) =>
      !search || r.nameWithOwner.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (r.language ?? "").toLowerCase().includes(search.toLowerCase()),
    );

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
          </button>
        ))}

        {/* Search */}
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
        {loading && (
          <div className="text-[12px] text-paper-muted animate-pulse-signal py-8 text-center">
            Loading repos from GitHub...
          </div>
        )}

        {error && (
          <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
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
                {/* Language dot */}
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: LANG_COLORS[repo.language] ?? "var(--color-paper-muted)" }}
                />

                {/* Repo info */}
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

                {/* Stats */}
                <div className="hidden sm:flex items-center gap-4 text-[11px] text-paper-muted shrink-0">
                  {repo.language && <span>{repo.language}</span>}
                  <span>★ {repo.stars.toLocaleString()}</span>
                  <span className="text-paper-faint">{timeAgo(repo.updatedAt)}</span>
                </div>

                {/* Actions */}
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
