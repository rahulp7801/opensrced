"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { cacheGet, cacheSet } from "@/lib/client-cache";

type CachedSuggestions = { issues: SuggestedIssue[]; filteredOut: number };

type SuggestedIssue = {
  repo: string;
  title: string;
  number: number;
  url: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  comments: number;
  language: string;
  stars: number;
};

const LANGUAGES = [
  "python", "typescript", "javascript", "rust", "go", "java", "c", "cpp", "ruby", "swift",
];

export function SuggestedIssues() {
  const [issues, setIssues] = useState<SuggestedIssue[]>([]);
  const [filteredOut, setFilteredOut] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["python", "typescript"]);
  const [expanded, setExpanded] = useState(true);
  const [tags, setTags] = useState<"strict" | "broad">("strict");

  function toggleLang(lang: string) {
    setSelectedLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }

  function fetchIssues(force = false) {
    if (selectedLangs.length === 0) return;

    // Cache key: stable across language order (sort), unique per tag mode.
    const key = `${tags}|${[...selectedLangs].sort().join(",")}`;

    if (!force) {
      const cached = cacheGet<CachedSuggestions>("suggested-issues", key);
      if (cached) {
        setIssues(cached.issues);
        setFilteredOut(cached.filteredOut);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);
    fetch(`/api/issues/suggested?languages=${selectedLangs.join(",")}&limit=20&tags=${tags}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error))))
      .then((data: { issues: SuggestedIssue[]; filteredOut?: number }) => {
        const next = { issues: data.issues, filteredOut: data.filteredOut ?? 0 };
        setIssues(next.issues);
        setFilteredOut(next.filteredOut);
        cacheSet("suggested-issues", key, next);
      })
      .catch((err) => setError(typeof err === "string" ? err : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags]); // Refetch when the tag mode changes; languages still need explicit refresh

  return (
    <div className="border border-border bg-surface/40">
      <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-signal">suggested issues</span>
          <span className="text-[10px] text-paper-faint">Good first issues matching your interests</span>
          {filteredOut > 0 && (
            <span
              className="text-[10px] text-paper-faint"
              title="Bot-engagement spam filtered out: bounty repos, token-farming quests, social-media tasks, follow/star quests."
            >
              · {filteredOut} bot-spam hidden
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-paper-faint hover:text-paper-muted transition"
        >
          {expanded ? "collapse" : "expand"}
        </button>
      </div>

      {expanded && (
        <>
          {/* Language selector */}
          <div className="px-4 py-2 border-b border-border-soft bg-ink/20 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-paper-faint">Languages:</span>
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => toggleLang(lang)}
                className={cn(
                  "text-[10px] px-2 py-0.5 border transition",
                  selectedLangs.includes(lang)
                    ? "border-signal/40 text-signal bg-signal/10"
                    : "border-transparent text-paper-faint hover:text-paper-muted",
                )}
              >
                {lang}
              </button>
            ))}
            <button
              onClick={() => fetchIssues(true)}
              disabled={loading || selectedLangs.length === 0}
              title="Force a fresh search, bypassing the 5-minute cache"
              className="ml-auto text-[10px] text-signal border border-signal/30 px-2.5 py-0.5 hover:bg-signal/10 transition disabled:opacity-50"
            >
              {loading ? "searching..." : "refresh"}
            </button>
          </div>

          {/* Tag-strictness selector */}
          <div className="px-4 py-2 border-b border-border-soft bg-ink/10 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-paper-faint">Tags:</span>
            <button
              onClick={() => setTags("strict")}
              title='Only issues labeled exactly "good first issue"'
              className={cn(
                "text-[10px] px-2 py-0.5 border transition",
                tags === "strict"
                  ? "border-ok/40 text-ok bg-ok/10"
                  : "border-transparent text-paper-faint hover:text-paper-muted",
              )}
            >
              good first issue only
            </button>
            <button
              onClick={() => setTags("broad")}
              title='Also match "beginner", "starter", "first-timers-only", "easy"'
              className={cn(
                "text-[10px] px-2 py-0.5 border transition",
                tags === "broad"
                  ? "border-ok/40 text-ok bg-ok/10"
                  : "border-transparent text-paper-faint hover:text-paper-muted",
              )}
            >
              broader beginner tags
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[500px] overflow-y-auto">
            {error && (
              <div className="px-4 py-3 text-[11px] text-alert">{error}</div>
            )}

            {loading && issues.length === 0 && (
              <div className="divide-y divide-border-soft">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
                    <div className="h-4 w-40 bg-surface-2 rounded" />
                    <div className="h-4 w-64 bg-surface-2 rounded" />
                    <div className="ml-auto h-4 w-20 bg-surface-2 rounded" />
                  </div>
                ))}
              </div>
            )}

            {!loading && issues.length === 0 && !error && (
              <div className="px-4 py-6 text-center text-[12px] text-paper-muted">
                No issues found. Try selecting different languages.
              </div>
            )}

            {issues.length > 0 && (
              <div className="divide-y divide-border-soft">
                {issues.map((issue) => (
                  <div
                    key={issue.url}
                    className="px-4 py-3 flex items-start gap-3 hover:bg-surface-2/40 transition group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-paper-dim">{issue.repo}</span>
                        <span className="text-[10px] text-paper-faint">#{issue.number}</span>
                        {issue.language && (
                          <span className="text-[9px] text-info border border-info/30 px-1 py-px">{issue.language}</span>
                        )}
                        {issue.labels.slice(0, 3).map((l) => (
                          <span key={l} className={cn(
                            "text-[9px] px-1 py-px border",
                            l.includes("good first") ? "text-ok border-ok/30" :
                            l.includes("help wanted") ? "text-signal border-signal/30" :
                            l.includes("bug") ? "text-alert border-alert/30" :
                            "text-paper-faint border-border",
                          )}>
                            {l}
                          </span>
                        ))}
                      </div>
                      <div className="text-[12px] text-paper mt-0.5 truncate">{issue.title}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-[10px] pt-1">
                      {issue.comments > 0 && (
                        <span className="text-paper-faint tabular-nums">{issue.comments} comment{issue.comments !== 1 ? "s" : ""}</span>
                      )}
                      <span className="text-paper-faint tabular-nums w-14 text-right">{timeAgo(issue.updatedAt)}</span>
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-paper-faint hover:text-signal transition"
                        onClick={(e) => e.stopPropagation()}
                      >
                        github
                      </a>
                      <a
                        href={`/trigger?repo=${issue.repo}&issue=${issue.number}`}
                        className="text-signal opacity-0 group-hover:opacity-100 transition border border-signal/30 px-2 py-0.5 hover:bg-signal/10"
                      >
                        fix this
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
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
