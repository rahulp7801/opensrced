"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaretDown,
  FunnelSimple,
  SpinnerGap,
} from "@phosphor-icons/react";
import { pollJson } from "@/lib/poll-json";
import { cn } from "@/lib/utils";
import { cacheGet, cacheSet } from "@/lib/client-cache";
import { DifficultyAndExamples, TestableTag, type IssueInsight } from "./worked-examples";
import { StartLessonButton } from "./lesson/start-lesson";

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
  /** Difficulty v2 and friends, present only with OPENSRCER_RECS for catalog issues. */
  recs?: IssueInsight;
};

function validInsight(value: unknown): value is IssueInsight {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recs = value as Partial<IssueInsight>;
  return (recs.difficulty === null || (Number.isInteger(recs.difficulty) && recs.difficulty! >= 1 && recs.difficulty! <= 5))
    && Array.isArray(recs.reasons) && recs.reasons.length <= 20 && recs.reasons.every((reason) => typeof reason === "string" && reason.length <= 300)
    && typeof recs.testable === "boolean"
    && (recs.unreachableReason === null || (typeof recs.unreachableReason === "string" && recs.unreachableReason.length <= 300))
    && Number.isSafeInteger(recs.workedExamples) && recs.workedExamples! >= 0;
}

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
    && Number.isSafeInteger(issue.stars) && issue.stars! >= 0
    && (issue.recs === undefined || validInsight(issue.recs));
}

function validSuggestions(value: unknown): value is CachedSuggestions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<CachedSuggestions>;
  return Array.isArray(result.issues) && result.issues.length <= 20 && result.issues.every(validIssue)
    && Number.isSafeInteger(result.filteredOut) && result.filteredOut! >= 0
    && (result.partial === undefined || typeof result.partial === "boolean");
}

/** `lessons`: OPENSRCER_LESSONS is on (the page reads it on the server).
 *  `home`: the user's home project (owner/name), listed first. */
export function SuggestedIssues({ lessons = false, home = null }: { lessons?: boolean; home?: string | null }) {
  const isHome = (repo: string) => home !== null && repo.toLowerCase() === home.toLowerCase();
  const stopRequest = useRef<(() => void) | undefined>(undefined);
  const [partial, setPartial] = useState(false);
  const [issues, setIssues] = useState<SuggestedIssue[]>([]);
  const [filteredOut, setFilteredOut] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["python", "typescript"]);
  const [expanded, setExpanded] = useState(true);
  const [tags, setTags] = useState<"strict" | "broad">("strict");
  const [testableOnly, setTestableOnly] = useState(false);
  // The home project first; the sort is stable, so the rest keep their order.
  const shown = (testableOnly ? issues.filter((issue) => issue.recs?.testable) : issues)
    .toSorted((a, b) => Number(isHome(b.repo)) - Number(isHome(a.repo)));

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
    <section aria-labelledby="suggested-issues-title">
      <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
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
        <p role="status" className="callout mb-4 text-[14px]" data-tone="info">
          Some GitHub searches timed out. These are the results that completed.
        </p>
      )}

      {expanded && (
        <div id="suggested-issues-filters" className="card mb-6 grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-end">
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
            {/* Only when the recommendations index knows some of these issues. */}
            {issues.some((issue) => issue.recs) && (
              <button
                type="button"
                onClick={() => setTestableOnly((value) => !value)}
                aria-pressed={testableOnly}
                className="pill"
                data-size="sm"
                data-edge=""
              >
                Testable here
              </button>
            )}
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
          <div role="alert" className="callout mb-4 flex flex-col gap-3 text-[15px] sm:flex-row sm:items-center sm:justify-between" data-tone="alert">
            <span>{error}</span>
            <button type="button" onClick={() => fetchIssues(true)} className="btn-quiet shrink-0 self-start sm:self-auto" data-size="sm">
              Try again
            </button>
          </div>
        )}

        {loading && issues.length === 0 && (
          <div role="status" className="ruled">
            <span className="sr-only">Finding suggested issues</span>
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="animate-pulse space-y-2.5 py-5">
                <div className="h-2.5 w-1/4 rounded-full bg-surface-2" />
                <div className="h-3.5 w-2/3 rounded-full bg-surface-3" />
                <div className="h-2.5 w-1/3 rounded-full bg-surface-2" />
              </div>
            ))}
          </div>
        )}

        {!loading && issues.length === 0 && !error && (
          <div className="border-y border-border-soft py-10">
            <p className="text-[16px] font-semibold text-paper">{selectedLangs.length === 0 ? "Choose a language to begin" : "No matching issues found"}</p>
            <p className="mt-1.5 text-[15px] text-paper-muted">{selectedLangs.length === 0 ? "Select one or more languages in the filters above." : "Try more languages or include all beginner tags."}</p>
          </div>
        )}

        {issues.length > 0 && shown.length === 0 && (
          <p className="border-y border-border-soft py-10 text-[15px] text-paper-muted">None of these issues are in a project whose tests run here yet.</p>
        )}

        {shown.length > 0 && (
          <div className="ruled">
            {shown.map((issue) => (
              <article key={issue.url} className="group py-[18px]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-paper">{issue.title}</h3>
                    {/* Everything else about the issue is one mono line of facts. */}
                    <p className="meta mt-1">
                      <span>{issue.repo} #{issue.number}</span>
                      {isHome(issue.repo) && <span className="tag" data-tone="ok">your home project</span>}
                      {issue.stars > 0 && <span>★ {issue.stars.toLocaleString()}</span>}
                      {issue.language && <span>{issue.language.toLowerCase()}</span>}
                      <span>updated {timeAgo(issue.updatedAt)}</span>
                      {issue.comments > 0 && <span>{issue.comments} comment{issue.comments === 1 ? "" : "s"}</span>}
                      {issue.recs?.difficulty != null && <span title={issue.recs.reasons.join("; ") || undefined}>difficulty {issue.recs.difficulty}/5</span>}
                      <TestableTag recs={issue.recs} />
                      {issue.labels.slice(0, 2).map((label) => (
                        <span
                          key={label}
                          className="tag"
                          data-tone={label.toLowerCase().includes("good first") ? "ok" : label.toLowerCase().includes("bug") ? "alert" : undefined}
                        >
                          {label}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-5">
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${issue.repo} issue ${issue.number} on GitHub`}
                      className="text-link text-[14px]"
                    >
                      GitHub
                    </a>
                    {/* Through the scanner, which checks the issue (claimed, already fixed,
                        someone else's PR, the project's AI policy) before offering a run. */}
                    <a
                      href={`/issues?repo=${encodeURIComponent(issue.repo)}&issue=${issue.number}`}
                      title="Check this issue, then preview or solve it"
                      className="row-cta"
                    >
                      Fix this issue <span aria-hidden>→</span>
                    </a>
                    {lessons && <StartLessonButton repo={issue.repo} issue={issue.number} />}
                  </div>
                </div>
                <DifficultyAndExamples repo={issue.repo} number={issue.number} recs={issue.recs} className="mt-2" />
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
