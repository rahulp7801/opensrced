"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { cacheGet, cacheSet } from "@/lib/client-cache";
import { IconArrow, IconChevronDown, IconSearch } from "./icons";

type ScopeBucket = "doc" | "leaf" | "cross-file" | "refactor" | "new-file" | "unknown";

type ScopeInfo = {
  bucket: ScopeBucket;
  confidence: "low" | "medium" | "high";
  files: string[];
  symbols: string[];
  reason: string;
};

type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
  author: string;
  created_at: string;
  updated_at: string;
  comments: number;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  complexity: number;
  est_minutes: number;
  solvable: boolean;
  reason: string;
  scope: ScopeInfo;
};

type Scan = {
  repo: string;
  total: number;
  solvable: number;
  /** The project's stance on AI contributions (lib/contrib-guard.ts). */
  policy?: { ai: "ban" | "disclose" | "unknown"; source: string | null; excerpt: string | null; discussFirst: string | null } | null;
  issues: Issue[];
};

export function IssueScanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = searchParams.get("repo") ?? "";
  const initialIssue = Number(searchParams.get("issue") ?? "") || null;
  const [repoUrl, setRepoUrl] = useState(initial);
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A failed Preview/Solve on a row far down the list must still be seen.
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (err) errRef.current?.scrollIntoView({ block: "nearest" }); }, [err]);
  const [filter, setFilter] = useState<"all" | "solvable">("solvable");
  const [age, setAge] = useState<"recent" | "any">("recent");
  const [beginner, setBeginner] = useState<"any" | "good-first">("any");
  const [dispatching, setDispatching] = useState<{ number: number; kind: ActionKind } | null>(null);
  const scanRequest = useRef<AbortController | null>(null);
  // Row expansion — one issue at a time, showing the full body + scope
  // details inline. Auto-opens when ?issue=N is in the URL (used by the
  // discover page's row link).
  const [expandedNumber, setExpandedNumber] = useState<number | null>(initialIssue);

  const RECENT_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
  const NEW_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  useEffect(() => {
    if (initial) void runScan(initial);
    return () => { scanRequest.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When arriving with ?issue=N, widen the default filters so the target
  // row is actually visible — discover lands users on specific issues that
  // may be older than 30 days or tagged unsolvable.
  useEffect(() => {
    if (initialIssue) {
      setAge("any");
      setFilter("all");
    }
  }, [initialIssue]);

  // Scroll the expanded row into view once the scan resolves.
  useEffect(() => {
    if (!scan || !expandedNumber) return;
    const el = document.getElementById(`issue-row-${expandedNumber}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [scan, expandedNumber]);

  async function runScan(url: string, force = false) {
    scanRequest.current?.abort();
    const request = new AbortController();
    scanRequest.current = request;
    const key = url.trim().toLowerCase();

    if (!force) {
      const cached = cacheGet<Scan>("issue-scan", key);
      if (cached) {
        setScan(cached);
        setErr(null);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setErr(null);
    setScan(null);
    try {
      const res = await fetch(`/api/issues/scan?repo=${encodeURIComponent(url)}`, {
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
      });
      const data = await res.json();
      if (request.signal.aborted) return;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setScan(data);
      cacheSet("issue-scan", key, data);
    } catch (e) {
      if (!request.signal.aborted) setErr(e instanceof Error && e.name === "TimeoutError"
        ? "Repository scan took too long. Try again in a moment."
        : e instanceof Error ? e.message : String(e));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  async function solve(n: number, dryRun: boolean) {
    if (!scan) return;
    setDispatching({ number: n, kind: dryRun ? "preview" : "solve" });
    try {
      const res = await fetch("/api/run/agentic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: `https://github.com/${scan.repo}`,
          issue_number: n,
          dry_run: dryRun,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => null) as { dispatch_id?: unknown; message?: string; error?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      if (typeof data?.dispatch_id !== "string" || !data.dispatch_id.trim()) {
        throw new Error("The server returned an invalid run response. Please try again.");
      }
      router.push(`/dispatches?dispatch=${encodeURIComponent(data.dispatch_id)}`);
    } catch (e) {
      setErr(e instanceof Error && e.name === "TimeoutError"
        ? "Starting the run timed out. Please try again."
        : e instanceof Error ? e.message : String(e));
    } finally {
      setDispatching(null);
    }
  }

  const issues = scan
    ? scan.issues
        .filter((i) => (filter === "solvable" ? i.solvable : true))
        .filter((i) => {
          if (age === "any") return true;
          const created = Date.parse(i.created_at);
          if (!Number.isFinite(created)) return true;
          return now - created <= RECENT_CUTOFF_MS;
        })
        .filter((i) => (beginner === "good-first" ? isGoodFirstIssue(i) : true))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    : [];

  const recentCount = scan
    ? scan.issues.filter(
        (i) =>
          (filter === "solvable" ? i.solvable : true) &&
          (beginner === "good-first" ? isGoodFirstIssue(i) : true) &&
          now - Date.parse(i.created_at) <= RECENT_CUTOFF_MS,
      ).length
    : 0;

  const goodFirstCount = scan
    ? scan.issues.filter(
        (i) =>
          (filter === "solvable" ? i.solvable : true) &&
          (age === "recent" ? !Number.isFinite(Date.parse(i.created_at)) || now - Date.parse(i.created_at) <= RECENT_CUTOFF_MS : true) &&
          isGoodFirstIssue(i),
      ).length
    : 0;

  return (
    <div>
      {/* Repo input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Explicit submit forces a fresh scan even if cached; auto-load
          // from ?repo= (the useEffect below) uses the cache.
          if (repoUrl.trim()) {
            setExpandedNumber(null);
            void runScan(repoUrl.trim(), true);
          }
        }}
        className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:rounded-full sm:py-2 sm:pl-6 sm:pr-2"
      >
        <label htmlFor="issue-repository" className="sr-only">GitHub repository</label>
        <IconSearch className="hidden shrink-0 text-paper-muted sm:block" />
        <input
          id="issue-repository"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          spellCheck={false}
          autoComplete="off"
          className="field bg-ink-2 sm:flex-1 sm:bg-transparent sm:shadow-none"
        />
        <button
          type="submit"
          disabled={loading || !repoUrl.trim()}
          className="btn-primary"
        >
          {loading ? "Scanning…" : "Scan issues"} <IconArrow />
        </button>
      </form>

      {loading && (
        <div role="status" aria-live="polite" className="callout mt-4 flex items-start gap-3">
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-signal" aria-hidden />
          <div>
            <p className="text-[14px] font-semibold text-paper">Scanning repository issues</p>
            <p className="mt-0.5 text-[13px] text-paper-muted">Fetching recent and beginner-labeled issues. Large repositories can take up to a minute.</p>
          </div>
        </div>
      )}

      {err && (
        <div ref={errRef} role="alert" className="callout mt-4 text-[15px]" data-tone="alert">
          {err}
        </div>
      )}

      {scan && (
        <>
          <section aria-labelledby="scan-results-title" className="card mt-8 overflow-hidden">
            <div className="border-b border-border-soft px-5 py-6 sm:px-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="kicker text-signal">Scan complete</p>
                  <h2 id="scan-results-title" className="display mt-2 break-all text-[28px] leading-none text-paper sm:text-[32px]">{scan.repo}</h2>
                  <p className="mt-2.5 text-[14px] text-paper-muted">
                    <span className="font-semibold text-paper">{scan.total}</span> open issue{scan.total === 1 ? "" : "s"};{" "}
                    <span className="font-semibold text-signal">{scan.solvable}</span> ready for an automated attempt.
                  </p>
                  {scan.policy?.ai === "ban" && (
                    <p role="alert" className="callout mt-3 max-w-2xl text-[15px]" data-tone="alert">
                      This project does not accept AI-generated contributions ({scan.policy.source}). Previews still work; publishing is refused.
                    </p>
                  )}
                  {scan.policy?.ai === "disclose" && (
                    <p className="mt-2 max-w-2xl text-[13px] text-paper-muted">
                      This project asks contributors to disclose AI assistance ({scan.policy.source}); opensrcer adds that note to every PR.
                    </p>
                  )}
                  {scan.policy?.discussFirst && (
                    <p className="mt-1 max-w-2xl text-[13px] text-paper-muted">Maintainers ask for discussion first: {scan.policy.discussFirst}.</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
                  <FilterGroup label="Readiness">
                    {([
                      { k: "solvable", label: `Ready (${scan.solvable})` },
                      { k: "all", label: `All (${scan.total})` },
                    ] as const).map((option) => (
                      <FilterButton key={option.k} active={filter === option.k} onClick={() => setFilter(option.k)}>{option.label}</FilterButton>
                    ))}
                  </FilterGroup>
                  <FilterGroup label="Opened">
                    {([
                      { k: "recent", label: `Last 30d (${recentCount})` },
                      { k: "any", label: "Any time" },
                    ] as const).map((option) => (
                      <FilterButton key={option.k} active={age === option.k} onClick={() => setAge(option.k)}>{option.label}</FilterButton>
                    ))}
                  </FilterGroup>
                  <FilterGroup label="Labels" className="col-span-2">
                    {([
                      { k: "any", label: "Any label" },
                      { k: "good-first", label: `Beginner (${goodFirstCount})` },
                    ] as const).map((option) => (
                      <FilterButton key={option.k} active={beginner === option.k} onClick={() => setBeginner(option.k)}>{option.label}</FilterButton>
                    ))}
                  </FilterGroup>
                </div>
              </div>
            </div>

            {initialIssue && !scan.issues.some((i) => i.number === initialIssue) && (
              <p role="status" className="border-b border-border-soft bg-info-dim/30 px-5 py-3 text-[13px] text-info sm:px-6">
                Issue #{initialIssue} is not in this scan (it may be closed, or older than the issues scanned).{" "}
                <a href={`https://github.com/${scan.repo}/issues/${initialIssue}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open it on GitHub</a>{" "}
                or pick one below.
              </p>
            )}
            {issues.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <p className="text-[16px] font-semibold text-paper">No issues match these filters</p>
                <p className="mx-auto mt-1.5 max-w-lg text-[15px] leading-relaxed text-paper-muted">
                  {beginner === "good-first"
                    ? "Include any label or widen the age and readiness filters."
                    : age === "recent" && filter === "solvable"
                      ? "Include older issues or show every readiness state."
                      : filter === "solvable"
                        ? "Show all issues to review items that need more context."
                        : "This repository has no open issues in the scan window."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border-soft">
                {issues.map((issue) => {
                  const expanded = expandedNumber === issue.number;
                  const rec = recommendFor(issue);
                  return (
                    <article id={`issue-row-${issue.number}`} key={issue.number} className={cn("transition-colors", expanded ? "bg-ink-2" : "hover:bg-ink-2", !issue.solvable && "opacity-70")}>
                      <div className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="min-w-0">
                          <div className="meta">
                            <a href={issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 min-h-6 max-sm:min-h-10 max-sm:min-w-10">
                              #{issue.number}<span aria-hidden>↗</span>
                              <span className="sr-only">Open on GitHub</span>
                            </a>
                            <span title={issue.created_at}>opened {fmtRelative(issue.created_at, now)}</span>
                            {now - Date.parse(issue.created_at) <= NEW_CUTOFF_MS && <span className="tag" data-tone="signal">new</span>}
                            <span className="tag" data-tone="info">{issue.category}</span>
                            {/* A label that only repeats the category ("bug" · "bug") is dropped. */}
                            {issue.labels.filter((label) => label.toLowerCase() !== issue.category.toLowerCase()).slice(0, 3).map((label) => <span key={label} className="tag">{label}</span>)}
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedNumber(expanded ? null : issue.number)}
                            aria-expanded={expanded}
                            aria-controls={`issue-detail-${issue.number}`}
                            className="mt-2 flex w-full items-start gap-2 text-left max-sm:min-h-10"
                          >
                            <IconChevronDown className={cn("mt-1 shrink-0 text-paper-muted transition-transform", !expanded && "-rotate-90")} />
                            <span className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-paper">{issue.title}</span>
                          </button>
                          {/* Size and effort as one readable phrase; only the difficulty dots are drawn.
                              The status is a dot and a word at the end, not a pill. */}
                          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-paper-muted">
                            <span className="first-letter:uppercase"><ScopeBadge s={issue.scope} />,</span>
                            <span>about {fmtMinutes(issue.est_minutes)},</span>
                            <span className="inline-flex items-center gap-1.5">difficulty <ComplexityPips value={issue.complexity} />,</span>
                            <span>risk <SeverityChip s={issue.severity} /></span>
                            <span className={cn("chip ml-2", !issue.solvable && "font-normal")} data-tone={issue.solvable ? "ok" : undefined}>{issue.solvable ? "Ready" : "Needs review"}</span>
                          </p>
                        </div>
                        <div className="lg:justify-self-end">
                          {issue.solvable ? (
                            <ActionButtons
                              recommended={rec.action}
                              disabled={dispatching !== null}
                              dispatching={dispatching?.number === issue.number ? dispatching.kind : null}
                              onPreview={() => solve(issue.number, true)}
                              onSolve={() => solve(issue.number, false)}
                            />
                          ) : <p className="max-w-xs text-[13px] leading-relaxed text-paper-muted">{issue.reason}</p>}
                        </div>
                      </div>
                      {expanded && (
                        <div id={`issue-detail-${issue.number}`} className="border-t border-border-soft px-5 py-6 sm:px-6">
                          {/* The row above holds the run buttons; the detail only explains. */}
                          <IssueDetail issue={issue} rec={rec} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

    </div>
  );
}

const GOOD_FIRST_PATTERNS = [
  /good\s*-?\s*first/i,
  /^beginner/i,
  /^starter$/i,
  /first[\s-]*timers?[\s-]*only/i,
  /^easy$/i,
  /low[\s-]*hanging/i,
];

function isGoodFirstIssue(issue: { labels: string[] }): boolean {
  return issue.labels.some((l) => GOOD_FIRST_PATTERNS.some((p) => p.test(l)));
}

function FilterGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <fieldset className={className}>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function FilterButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="pill" data-size="sm" data-edge="">
      {children}
    </button>
  );
}

function fmtMinutes(m: number) {
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 15) / 4;
  return `${h}h`;
}

function fmtRelative(iso: string, now: number) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diffMs = Math.max(0, now - t);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes || "<1"}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

type ActionKind = "preview" | "solve";

type Recommendation = {
  action: ActionKind;
  headline: string;  // short label shown on the detail banner
  reason: string;    // one-sentence why
};

function recommendFor(issue: Issue): Recommendation {
  if (issue.scope.bucket === "refactor" || issue.scope.bucket === "unknown") {
    return { action: "preview", headline: "Preview first", reason: "Review a patch before publishing changes when the scope is broad or uncertain." };
  }
  return { action: "solve", headline: "Fix it, then review", reason: "The agent explores the repository and writes a fix, then stops for your review. A draft PR opens only when you confirm it on the run page." };
}

const ACTION_META: Record<ActionKind, { label: string; tooltip: string }> = {
  preview: {
    label: "Preview patch",
    tooltip:
      "A practice run: generate a patch to read. It can't be published; run it again to publish.",
  },
  solve: {
    label: "Fix it (you review first)",
    tooltip:
      "Explore the repository and generate a fix, then stop for your review. Nothing is posted until you confirm.",
  },
};

function ActionButtons({
  recommended,
  disabled,
  dispatching,
  onPreview,
  onSolve,
}: {
  recommended: ActionKind;
  disabled: boolean;
  dispatching: ActionKind | null;
  onPreview: () => void;
  onSolve: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      <ActionButton kind="preview" recommended={recommended === "preview"}
        disabled={disabled} dispatching={dispatching === "preview"} onClick={onPreview} />
      <ActionButton kind="solve" recommended={recommended === "solve"}
        disabled={disabled} dispatching={dispatching === "solve"} onClick={onSolve} />
    </div>
  );
}

function ActionButton({
  kind,
  recommended,
  disabled,
  dispatching,
  onClick,
}: {
  kind: ActionKind;
  recommended: boolean;
  disabled: boolean;
  dispatching: boolean;
  onClick: () => void;
}) {
  const meta = ACTION_META[kind];
  // Recommended: the row's one outlined button; the other is a text link.
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={meta.tooltip + (recommended ? "\n\nRecommended for this issue." : "")}
      className={recommended ? "btn-quiet" : "text-link text-[14px]"}
      data-size="sm"
    >
      {dispatching ? "Starting…" : meta.label}
    </button>
  );
}

function IssueDetail({ issue, rec }: { issue: Issue; rec: Recommendation }) {
  const body = (issue.body ?? "").trim() || "(issue has no body)";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <h4 className="kicker text-paper-muted">Issue description</h4>
        <div className="mt-3 max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-surface p-5 text-[16px] leading-[1.65] text-paper-dim shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
          {body}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <h4 className="kicker text-paper-muted">Recommendation</h4>
          <div className="callout mt-3" data-tone={rec.action === "solve" ? "signal" : undefined}>
            <div className={cn(
              "text-[16px] font-semibold",
              rec.action === "solve" ? "text-signal" : "text-paper",
            )}>
              {rec.headline}
            </div>
            <div className="mt-1.5 text-[15px] leading-[1.55] text-paper-dim">
              {rec.reason}
            </div>
          </div>
          <p className="mt-3 text-[14px] leading-[1.55] text-paper-muted">
            Use the buttons above. A preview is a practice run you can read but never publish. &ldquo;Fix it&rdquo; also stops for your review: the draft PR opens only when you confirm it on the run page.
          </p>
        </div>

        <div>
          <h4 className="kicker mb-3 text-paper-muted">Why &ldquo;{SCOPE_LABEL[issue.scope.bucket]}&rdquo;</h4>
          <div className="text-[13px] leading-relaxed text-paper-muted">
            <p className="text-paper-dim">{issue.scope.reason}</p>
            {issue.scope.files.length > 0 && (
              <div className="mt-2">
                <span className="text-paper-faint">Files:</span>{" "}
                {issue.scope.files.slice(0, 6).map((f, i) => (
                  <code key={f} className="text-paper">{i > 0 ? ", " : ""}{f}</code>
                ))}
              </div>
            )}
            {issue.scope.symbols.length > 0 && (
              <div className="mt-1.5">
                <span className="text-paper-faint">Symbols:</span>{" "}
                {issue.scope.symbols.slice(0, 6).map((s, i) => (
                  <code key={s} className="text-paper">{i > 0 ? ", " : ""}{s}</code>
                ))}
              </div>
            )}
            <div className="mt-2 text-paper-faint">
              {issue.scope.confidence} confidence · complexity {issue.complexity}/5 · about {fmtMinutes(issue.est_minutes)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tone name → its text colour (each >= 5.4:1 on the sheet and its hover). */
const TONE_TEXT: Record<string, string> = { ok: "text-ok", signal: "text-signal", info: "text-info", alert: "text-alert" };

function ScopeBadge({ s }: { s: ScopeInfo }) {
  // Tone map: doc/leaf are "safe" (green/muted), cross-file "caution",
  // refactor "danger" — drives at-a-glance risk reading. Title carries the
  // full reason + files/symbols so users can verify the guess.
  const tones: Record<ScopeBucket, string | undefined> = {
    doc: "ok",
    leaf: undefined,
    "cross-file": "info",
    refactor: "alert",
    "new-file": "info",
    unknown: undefined,
  };
  const titleParts = [s.reason];
  if (s.files.length) titleParts.push(`files: ${s.files.slice(0, 5).join(", ")}`);
  if (s.symbols.length) titleParts.push(`symbols: ${s.symbols.slice(0, 5).join(", ")}`);
  titleParts.push(`confidence: ${s.confidence}`);
  return (
    <span title={titleParts.join(" · ")} className={cn("cursor-help font-semibold", TONE_TEXT[tones[s.bucket] ?? ""] ?? "text-paper")}>
      {SCOPE_LABEL[s.bucket]}
    </span>
  );
}

/** The scanner's guess at how much code a fix touches, in plain words. */
const SCOPE_LABEL: Record<ScopeBucket, string> = {
  doc: "docs only",
  leaf: "one file",
  "cross-file": "several files",
  refactor: "many files",
  "new-file": "a new file",
  unknown: "unclear",
};

function SeverityChip({ s }: { s: "low" | "medium" | "high" | "critical" }) {
  const tone = { low: "text-paper-dim", medium: "text-info", high: "text-alert", critical: "text-alert" } as const;
  return <span className={cn("font-semibold", tone[s])}>{s}</span>;
}

function ComplexityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-[3px] items-center" aria-label={`complexity ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "inline-block size-2 rounded-full",
            // Filled dots are ink, empty ones a hairline: the count is the signal, not a colour.
            i <= value ? "bg-paper-dim" : "bg-border",
          )}
        />
      ))}
      <span className="ml-1.5 text-[12.5px] text-paper-muted tabular-nums">{value}/5</span>
    </span>
  );
}
