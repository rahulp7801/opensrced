"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  ChatCircle,
  FunnelSimple,
  GithubLogo,
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
    <section aria-labelledby="suggested-issues-title" className="card overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border-soft px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 id="suggested-issues-title" className="display text-[28px] leading-none text-paper sm:text-[32px]">Suggested issues</h2>
          <p className="mt-2.5 max-w-2xl text-[16px] leading-[1.55] text-paper-muted">
            Beginner-friendly work from active public repositories: unassigned, with no linked pull request.
            {filteredOut > 0 && <span title="Bounty, token-farming, social-media, and follow/star tasks are excluded."> {filteredOut} low-quality result{filteredOut === 1 ? "" : "s"} hidden.</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="btn-quiet shrink-0 self-start sm:self-auto"
          data-size="sm"
          aria-expanded={expanded}
          aria-controls="suggested-issues-filters"
        >
          <FunnelSimple aria-hidden size={15} />
          Filters
          <CaretDown aria-hidden size={13} className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {partial && !loading && (
        <p role="status" className="border-b border-border-soft bg-info-dim/30 px-5 py-3 text-[13px] text-info sm:px-6">
          Some GitHub searches timed out. These are the results that completed.
        </p>
      )}

      {expanded && (
        <div id="suggested-issues-filters" className="grid gap-5 border-b border-border-soft bg-ink-2 px-5 py-5 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-4">
            <fieldset>
              <legend className="field-label mb-2">Languages</legend>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGES.map((language) => (
                  <button
                    type="button"
                    key={language}
                    onClick={() => toggleLang(language)}
                    aria-pressed={selectedLangs.includes(language)}
                    className="pill capitalize"
                    data-size="sm"
                    data-edge=""
                  >
                    {language === "cpp" ? "C++" : language}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="field-label mb-2">Issue labels</legend>
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
                    className="pill"
                    data-size="sm"
                    data-edge=""
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
            className="btn-quiet"
            data-size="sm"
          >
            <SpinnerGap aria-hidden size={16} className={cn(loading && "animate-spin")} />
            {loading ? "Refreshing" : "Refresh results"}
          </button>
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <div role="alert" className="flex flex-col gap-3 border-b border-border-soft bg-alert-dim/30 px-5 py-4 text-[15px] text-alert sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>{error}</span>
            <button type="button" onClick={() => fetchIssues(true)} className="btn-quiet shrink-0 self-start sm:self-auto" data-size="sm">
              Try again
            </button>
          </div>
        )}

        {loading && issues.length === 0 && (
          <div role="status" className="divide-y divide-border-soft">
            <span className="sr-only">Finding suggested issues</span>
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="animate-pulse space-y-2.5 px-5 py-5 sm:px-6">
                <div className="h-2.5 w-1/4 rounded-full bg-surface-2" />
                <div className="h-3.5 w-2/3 rounded-full bg-surface-3" />
                <div className="h-2.5 w-1/3 rounded-full bg-surface-2" />
              </div>
            ))}
          </div>
        )}

        {!loading && issues.length === 0 && !error && (
          <div className="px-5 py-14 text-center">
            <p className="text-[16px] font-semibold text-paper">{selectedLangs.length === 0 ? "Choose a language to begin" : "No matching issues found"}</p>
            <p className="mt-1.5 text-[15px] text-paper-muted">{selectedLangs.length === 0 ? "Select one or more languages in the filters above." : "Try more languages or include all beginner tags."}</p>
          </div>
        )}

        {issues.length > 0 && (
          <div className="divide-y divide-border-soft">
            {issues.map((issue) => (
              <article key={issue.url} className="group px-5 py-5 transition-colors hover:bg-ink-2 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-paper-muted">
                      <span className="font-medium text-paper-dim">{issue.repo}</span>
                      <span>#{issue.number}</span>
                      {issue.language && <span className="tag" data-tone="info">{issue.language.toLowerCase()}</span>}
                      {issue.labels.slice(0, 2).map((label) => (
                        <span
                          key={label}
                          className="tag"
                          data-tone={label.toLowerCase().includes("good first") ? "ok" : label.toLowerCase().includes("bug") ? "alert" : undefined}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    <h3 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-paper transition-colors group-hover:text-signal">{issue.title}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12.5px] text-paper-muted">
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
                      className="btn-quiet"
                      data-size="sm"
                    >
                      <GithubLogo aria-hidden size={16} />
                      GitHub
                      <ArrowSquareOut aria-hidden size={13} />
                    </a>
                    {/* Through the scanner, which checks the issue (claimed, already fixed,
                        someone else's PR, the project's AI policy) before offering a run. */}
                    <a
                      href={`/issues?repo=${encodeURIComponent(issue.repo)}&issue=${issue.number}`}
                      title="Check this issue, then preview or solve it"
                      className="row-cta"
                      data-size="sm"
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
