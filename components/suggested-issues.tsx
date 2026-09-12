"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  ChatCircle,
  FunnelSimple,
  GithubLogo,
  Sparkle,
  SpinnerGap,
} from "@phosphor-icons/react";
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

function validIssue(value: unknown): value is SuggestedIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const issue = value as Partial<SuggestedIssue>;
  return typeof issue.repo === "string" && /^[^/\s]+\/[^/\s]+$/.test(issue.repo)
    && typeof issue.title === "string" && issue.title.length <= 500
    && Number.isSafeInteger(issue.number) && issue.number! > 0
    && typeof issue.url === "string" && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9]\d*$/.test(issue.url)
    && Array.isArray(issue.labels) && issue.labels.length <= 30 && issue.labels.every((label) => typeof label === "string" && label.length <= 100)
    && typeof issue.createdAt === "string" && Number.isFinite(Date.parse(issue.createdAt))
    && typeof issue.updatedAt === "string" && Number.isFinite(Date.parse(issue.updatedAt))
    && Number.isSafeInteger(issue.comments) && issue.comments! >= 0
    && typeof issue.language === "string" && issue.language.length <= 100
    && Number.isSafeInteger(issue.stars) && issue.stars! >= 0;
}

function validSuggestions(value: unknown): value is CachedSuggestions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<CachedSuggestions>;
  return Array.isArray(result.issues) && result.issues.length <= 20 && result.issues.every(validIssue)
    && Number.isSafeInteger(result.filteredOut) && result.filteredOut! >= 0
    && (result.partial === undefined || typeof result.partial === "boolean");
}

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
    setSelectedLangs((previous) =>
      previous.includes(lang) ? previous.filter((item) => item !== lang) : [...previous, lang],
    );
  }

  function fetchIssues(force = false) {
    stopRequest.current?.();
    if (selectedLangs.length === 0) {
      setIssues([]);
      setFilteredOut(0);
      setPartial(false);
      setError(null);
      setLoading(false);
      return;
    }

    const key = `${tags}|${[...selectedLangs].sort().join(",")}`;
    if (!force) {
      const cached = cacheGet<unknown>("suggested-issues", key);
      if (validSuggestions(cached)) {
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
    stopRequest.current = pollJson<unknown>(
      `/api/issues/suggested?languages=${encodeURIComponent(selectedLangs.join(","))}&limit=20&tags=${tags}`,
      ({ data, error: requestError }) => {
        setLoading(false);
        if (requestError) {
          setError(requestError);
          return;
        }
        if (!validSuggestions(data)) {
          setError("GitHub returned an invalid issue list. Please refresh.");
          return;
        }
        const next = { issues: data.issues, filteredOut: data.filteredOut, partial: Boolean(data.partial) };
        setError(null);
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
  }, [tags, selectedLangs]);

  return (
    <section aria-labelledby="suggested-issues-title" className="overflow-hidden rounded-lg border border-border bg-surface/55">
      <div className="flex flex-col gap-4 border-b border-border-soft px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-signal/25 bg-signal/10 text-signal">
            <Sparkle aria-hidden size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="suggested-issues-title" className="text-base font-semibold tracking-[-0.01em] text-paper">Suggested issues</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-paper-muted">
              Beginner-friendly work from active public repositories.
              {filteredOut > 0 && <span title="Bounty, token-farming, social-media, and follow/star tasks are excluded."> {filteredOut} low-quality result{filteredOut === 1 ? "" : "s"} hidden.</span>}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-paper-muted transition-colors hover:border-border-strong hover:text-paper sm:self-auto"
          aria-expanded={expanded}
          aria-controls="suggested-issues-filters"
        >
          <FunnelSimple aria-hidden size={15} />
          Filters
          <CaretDown aria-hidden size={13} className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {partial && !loading && (
        <p role="status" className="border-b border-border-soft bg-info/5 px-5 py-2.5 text-xs text-info">
          Some GitHub searches timed out. These are the results that completed.
        </p>
      )}

      {expanded && (
        <div id="suggested-issues-filters" className="grid gap-4 border-b border-border-soft bg-ink/25 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-paper-muted">Languages</legend>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGES.map((language) => (
                  <button
                    type="button"
                    key={language}
                    onClick={() => toggleLang(language)}
                    aria-pressed={selectedLangs.includes(language)}
                    className={cn(
                      "min-h-9 rounded-md border px-3 py-1.5 text-xs capitalize transition-colors",
                      selectedLangs.includes(language)
                        ? "border-signal/45 bg-signal/10 font-medium text-signal"
                        : "border-border bg-surface/50 text-paper-muted hover:border-border-strong hover:text-paper",
                    )}
                  >
                    {language === "cpp" ? "C++" : language}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-paper-muted">Issue labels</legend>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { value: "strict" as const, label: "Good first issue", hint: "Exact maintainer label" },
                  { value: "broad" as const, label: "All beginner tags", hint: "Includes beginner, starter, and easy" },
                ]).map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    onClick={() => setTags(option.value)}
                    aria-pressed={tags === option.value}
                    title={option.hint}
                    className={cn(
                      "min-h-9 rounded-md border px-3 py-1.5 text-xs transition-colors",
                      tags === option.value
                        ? "border-ok/45 bg-ok/10 font-medium text-ok"
                        : "border-border bg-surface/50 text-paper-muted hover:border-border-strong hover:text-paper",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <button
            type="button"
            onClick={() => fetchIssues(true)}
            disabled={loading || selectedLangs.length === 0}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-signal/35 px-4 py-2 text-xs font-medium text-signal transition-colors hover:bg-signal/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SpinnerGap aria-hidden size={16} className={cn(loading && "animate-spin")} />
            {loading ? "Refreshing" : "Refresh results"}
          </button>
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <div role="alert" className="flex flex-col gap-3 border-b border-alert/25 bg-alert/5 px-5 py-4 text-sm text-alert sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => fetchIssues(true)} className="shrink-0 self-start rounded-md border border-alert/35 px-3 py-1.5 text-xs font-medium hover:bg-alert/10 sm:self-auto">
              Try again
            </button>
          </div>
        )}

        {loading && issues.length === 0 && (
          <div role="status" className="space-y-1 p-2">
            <span className="sr-only">Finding suggested issues</span>
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="flex animate-pulse items-center gap-3 rounded-md px-3 py-3.5">
                <div className="size-8 shrink-0 rounded-md bg-surface-2" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-2/3 rounded bg-surface-2" />
                  <div className="h-2.5 w-1/3 rounded bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && issues.length === 0 && !error && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-paper">{selectedLangs.length === 0 ? "Choose a language to begin" : "No matching issues found"}</p>
            <p className="mt-1 text-xs text-paper-muted">{selectedLangs.length === 0 ? "Select one or more languages in the filters above." : "Try more languages or include all beginner tags."}</p>
          </div>
        )}

        {issues.length > 0 && (
          <div className="divide-y divide-border-soft">
            {issues.map((issue) => (
              <article key={issue.url} className="group px-5 py-4 transition-colors hover:bg-surface-2/45">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper-muted">
                      <span className="font-medium text-paper-dim">{issue.repo}</span>
                      <span className="text-paper-faint">#{issue.number}</span>
                      {issue.language && <span className="rounded border border-info/25 bg-info/5 px-1.5 py-0.5 text-info">{issue.language}</span>}
                      {issue.labels.slice(0, 2).map((label) => (
                        <span key={label} className={cn(
                          "rounded border px-1.5 py-0.5",
                          label.toLowerCase().includes("good first") ? "border-ok/25 bg-ok/5 text-ok" :
                          label.toLowerCase().includes("bug") ? "border-alert/25 bg-alert/5 text-alert" :
                          "border-border text-paper-muted",
                        )}>
                          {label}
                        </span>
                      ))}
                    </div>
                    <h3 className="mt-1.5 text-sm font-medium leading-snug text-paper">{issue.title}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-paper-faint">
                      <span>Updated {timeAgo(issue.updatedAt)}</span>
                      {issue.comments > 0 && <span className="inline-flex items-center gap-1"><ChatCircle aria-hidden size={14} />{issue.comments}</span>}
                      {issue.stars > 0 && <span>{issue.stars.toLocaleString()} stars</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${issue.repo} issue ${issue.number} on GitHub`}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-paper-muted transition-colors hover:border-border-strong hover:text-paper"
                    >
                      <GithubLogo aria-hidden size={16} />
                      GitHub
                      <ArrowSquareOut aria-hidden size={13} />
                    </a>
                    <a
                      href={`/trigger?repo=${encodeURIComponent(issue.repo)}&issue=${issue.number}`}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-signal px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-signal-soft"
                    >
                      Fix issue
                      <ArrowRight aria-hidden size={15} />
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function timeAgo(date: string): string {
  const difference = Math.max(0, Date.now() - new Date(date).getTime());
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}
