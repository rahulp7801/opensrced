"use client";

import { useState, useEffect, useRef } from "react";
import { pollJson } from "@/lib/poll-json";
import { cn } from "@/lib/utils";
import { cacheGet, cacheSet } from "@/lib/client-cache";

type CachedSuggestions = { issues: SuggestedIssue[]; filteredOut: number; partial?: boolean };

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
  const stopRequest = useRef<(() => void) | undefined>(undefined);
  const [partial, setPartial] = useState(false);
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
    stopRequest.current?.();
    if (selectedLangs.length === 0) { setLoading(false); return; }

    // Cache key: stable across language order (sort), unique per tag mode.
    const key = `${tags}|${[...selectedLangs].sort().join(",")}`;

    if (!force) {
      const cached = cacheGet<CachedSuggestions>("suggested-issues", key);
      if (cached) {
        setIssues(cached.issues);
        setFilteredOut(cached.filteredOut);
        setError(null);
        setPartial(Boolean(cached.partial));
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);
    stopRequest.current = pollJson<CachedSuggestions>(
      `/api/issues/suggested?languages=${encodeURIComponent(selectedLangs.join(","))}&limit=20&tags=${tags}`,
      ({ data, error }) => {
        setLoading(false);
        setError(error);
        if (!data) return;
        const next = { issues: data.issues, filteredOut: data.filteredOut ?? 0, partial: Boolean(data.partial) };
        setIssues(next.issues);
        setFilteredOut(next.filteredOut);
        setPartial(next.partial);
        cacheSet("suggested-issues", key, next);
      }, 0, 50_000,
    );
  }

  useEffect(() => {
    fetchIssues();
    return () => stopRequest.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags]); // Refetch when the tag mode changes; languages still need explicit refresh

  return (
    <div className="border border-border bg-surface/40">
      {partial && !loading && <p role="status" className="px-4 py-2 text-xs text-paper-muted">Some GitHub searches did not complete. Showing available results; refresh to try again.</p>}
      <div className="flex items-start justify-between gap-4 border-b border-border-soft px-4 py-3">
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-[0.15em] text-signal">suggested issues</span>
          <span className="mt-1 block text-xs text-paper-faint">Good first issues matching your interests</span>
          {filteredOut > 0 && (
            <span
              className="text-xs text-paper-faint"
              title="Bot-engagement spam filtered out: bounty repos, token-farming quests, social-media tasks, follow/star quests."
            >
              · {filteredOut} bot-spam hidden
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-xs text-paper-faint hover:text-paper-muted transition"
          aria-expanded={expanded}
        >
          {expanded ? "Hide filters" : "Show filters"}
        </button>
      </div>

      {expanded && (
        <>
          {/* Language selector */}
          <div className="px-4 py-2 border-b border-border-soft bg-ink/20 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-paper-faint">Languages:</span>
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => toggleLang(lang)}
                className={cn(
                  "text-xs px-2 py-0.5 border transition",
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
              className="ml-auto text-xs text-signal border border-signal/30 px-2.5 py-0.5 hover:bg-signal/10 transition disabled:opacity-50"
            >
              {loading ? "searching..." : "refresh"}
            </button>
          </div>

          {/* Tag-strictness selector */}
          <div className="px-4 py-2 border-b border-border-soft bg-ink/10 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-paper-faint">Tags:</span>
            <button
              onClick={() => setTags("strict")}
              title='Only issues labeled exactly "good first issue"'
              className={cn(
                "text-xs px-2 py-0.5 border transition",
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
                "text-xs px-2 py-0.5 border transition",
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
                        <span className="text-xs text-paper-faint">#{issue.number}</span>
                        {issue.language && (
                          <span className="text-[11px] text-info border border-info/30 px-1 py-px">{issue.language}</span>
                        )}
                        {issue.labels.slice(0, 3).map((l) => (
                          <span key={l} className={cn(
                            "text-[11px] px-1 py-px border",
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
                    <div className="flex items-center gap-3 shrink-0 text-xs pt-1">
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
                        className="border border-signal/30 px-2 py-0.5 text-signal opacity-100 transition hover:bg-signal/10 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
