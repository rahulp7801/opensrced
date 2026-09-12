"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { cacheGet, cacheSet } from "@/lib/client-cache";
import { StatusChip } from "./status-dot";
import { IconArrow, IconChevronDown, IconExternal, IconSearch } from "./icons";

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
          now - Date.parse(i.created_at) <= RECENT_CUTOFF_MS,
      ).length
    : 0;

  const goodFirstCount = scan
    ? scan.issues.filter(
        (i) =>
          (filter === "solvable" ? i.solvable : true) &&
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
          if (repoUrl.trim()) void runScan(repoUrl.trim(), true);
        }}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center"
      >
        <label htmlFor="issue-repository" className="sr-only">GitHub repository</label>
        <IconSearch className="hidden text-paper-muted sm:block" />
        <input
          id="issue-repository"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11 w-full flex-1 rounded-md border border-border bg-ink px-3 text-base text-paper placeholder:text-paper-faint focus:border-signal sm:border-0 sm:bg-transparent"
        />
        <button
          type="submit"
          disabled={loading || !repoUrl.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-signal px-5 py-2 text-sm font-medium text-ink hover:bg-signal-soft disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Scan issues"} <IconArrow />
        </button>
      </form>

      {loading && (
        <div role="status" aria-live="polite" className="mt-4 flex items-start gap-3 rounded-md border border-border bg-surface/60 px-4 py-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-signal animate-pulse" aria-hidden />
          <div>
            <p className="text-sm font-medium text-paper">Scanning repository issues</p>
            <p className="mt-0.5 text-xs text-paper-muted">Fetching recent and beginner-labeled issues. Large repositories can take up to a minute.</p>
          </div>
        </div>
      )}

      {err && (
        <div className="mt-3 border border-alert/40 bg-alert/5 p-3 text-[12px] text-alert">
          {err}
        </div>
      )}

      {scan && (
        <>
          <section aria-labelledby="scan-results-title" className="mt-6 overflow-hidden rounded-lg border border-border bg-surface/45">
            <div className="border-b border-border-soft px-5 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-medium text-signal">Scan complete</p>
                  <h2 id="scan-results-title" className="mt-1 text-lg font-semibold text-paper">{scan.repo}</h2>
                  <p className="mt-1 text-sm text-paper-muted">
                    <span className="font-medium text-paper">{scan.total}</span> open issue{scan.total === 1 ? "" : "s"};{" "}
                    <span className="font-medium text-signal">{scan.solvable}</span> ready for an automated attempt.
                  </p>
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
                      <FilterButton key={option.k} active={beginner === option.k} tone="ok" onClick={() => setBeginner(option.k)}>{option.label}</FilterButton>
                    ))}
                  </FilterGroup>
                </div>
              </div>
            </div>

            {issues.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-paper">No issues match these filters</p>
                <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-paper-muted">
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
                    <article id={`issue-row-${issue.number}`} key={issue.number} className={cn("transition-colors", expanded ? "bg-surface-2/55" : "hover:bg-surface-2/30", !issue.solvable && "opacity-70")}>
                      <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-paper-muted">
                            <a href={issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-paper-dim hover:text-signal">
                              #{issue.number}<IconExternal />
                              <span className="sr-only">Open on GitHub</span>
                            </a>
                            <span title={issue.created_at}>Opened {fmtRelative(issue.created_at, now)}</span>
                            {now - Date.parse(issue.created_at) <= NEW_CUTOFF_MS && <span className="rounded border border-signal/30 bg-signal/5 px-1.5 py-0.5 text-signal">New</span>}
                            <span className="rounded border border-border px-1.5 py-0.5 text-paper-muted">{issue.category}</span>
                            {issue.labels.slice(0, 3).map((label) => <span key={label} className="rounded border border-border-soft px-1.5 py-0.5 text-paper-muted">{label}</span>)}
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedNumber(expanded ? null : issue.number)}
                            aria-expanded={expanded}
                            aria-controls={`issue-detail-${issue.number}`}
                            className="mt-2 flex w-full items-start gap-2 text-left"
                          >
                            <IconChevronDown className={cn("mt-0.5 shrink-0 text-paper-faint transition-transform", !expanded && "-rotate-90")} />
                            <span className="text-sm font-medium leading-snug text-paper">{issue.title}</span>
                          </button>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-paper-muted">
                            <span className="inline-flex items-center gap-1.5"><span className="text-paper-faint">Scope</span><ScopeBadge s={issue.scope} /></span>
                            <span className="inline-flex items-center gap-1.5"><span className="text-paper-faint">Risk</span><SeverityChip s={issue.severity} /></span>
                            <span className="inline-flex items-center gap-1.5"><span className="text-paper-faint">Complexity</span><ComplexityPips value={issue.complexity} /></span>
                            <span><span className="text-paper-faint">Estimate</span> ~{fmtMinutes(issue.est_minutes)}</span>
                            {issue.solvable ? <StatusChip tone="ok">Ready</StatusChip> : <StatusChip tone="muted">Needs review</StatusChip>}
                          </div>
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
                          ) : <p className="max-w-xs text-xs leading-relaxed text-paper-muted">{issue.reason}</p>}
                        </div>
                      </div>
                      {expanded && (
                        <div id={`issue-detail-${issue.number}`} className="border-t border-border-soft bg-ink/30 px-5 py-5">
                          <IssueDetail
                            issue={issue}
                            rec={rec}
                            disabled={dispatching !== null}
                            dispatching={dispatching?.number === issue.number ? dispatching.kind : null}
                            onPreview={() => solve(issue.number, true)}
                            onSolve={() => solve(issue.number, false)}
                          />
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
      <legend className="mb-1.5 text-xs font-medium text-paper-faint">{label}</legend>
      <div className="flex gap-1.5">{children}</div>
    </fieldset>
  );
}

function FilterButton({ active, tone = "signal", onClick, children }: {
  active: boolean;
  tone?: "signal" | "ok";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-9 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? tone === "ok" ? "border-ok/45 bg-ok/10 text-ok" : "border-signal/45 bg-signal/10 text-signal"
          : "border-border bg-surface/50 text-paper-muted hover:border-border-strong hover:text-paper",
      )}
    >
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
  if (months < 12) return `${months}mo ago`;
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
  return { action: "solve", headline: "Solve & open PR", reason: "Explore the repository and generate a fix. A draft PR opens only after the configured checks pass." };
}

const ACTION_META: Record<ActionKind, { label: string; tooltip: string }> = {
  preview: {
    label: "Preview patch",
    tooltip:
      "Generate a patch without pushing code or opening a PR. Review and copy the patch in Dispatches.",
  },
  solve: {
    label: "Solve & open PR",
    tooltip:
      "Explore the repository, generate a fix, and open a draft PR if the configured checks pass.",
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
  large = false,
}: {
  kind: ActionKind;
  recommended: boolean;
  disabled: boolean;
  dispatching: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const meta = ACTION_META[kind];
  // Three visual states: recommended (bold, colored), available (muted),
  // disabled (fades). The recommended one also carries a leading dot so
  // colorblind users still spot it.
  const recStyle = {
    preview: "border-paper-dim text-paper bg-surface-2",
    solve: "border-signal bg-signal/15 text-paper",
  }[kind];
  const base = large
    ? "min-h-11 px-4 py-2 text-xs"
    : "min-h-10 px-3 py-2 text-xs";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={meta.tooltip + (recommended ? "\n\nRecommended for this issue." : "")}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-40",
        base,
        recommended
          ? `${recStyle} hover:brightness-125`
          : "border-border bg-surface text-paper-muted hover:text-paper hover:border-border-strong",
      )}
    >
      {recommended && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", kind === "solve" ? "bg-signal" : "bg-paper-dim")}
        />
      )}
      {dispatching ? "Starting…" : meta.label}
    </button>
  );
}

function IssueDetail({
  issue,
  rec,
  disabled,
  dispatching,
  onPreview,
  onSolve,
}: {
  issue: Issue;
  rec: Recommendation;
  disabled: boolean;
  dispatching: ActionKind | null;
  onPreview: () => void;
  onSolve: () => void;
}) {
  const body = (issue.body ?? "").trim() || "(issue has no body)";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <h4 className="text-sm font-medium text-paper">Issue description</h4>
        <div className="mt-2 max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border-soft bg-ink/55 p-4 text-[13px] leading-relaxed text-paper-dim">
          {body}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h4 className="text-sm font-medium text-paper">Recommendation</h4>
          <div className={cn(
            "mt-2 rounded-md border p-3",
            rec.action === "solve" ? "border-signal/50 bg-signal/5" :
            "border-border-strong bg-surface-2",
          )}>
            <div className={cn(
              "text-[13px] font-medium",
              rec.action === "solve" ? "text-signal" : "text-paper",
            )}>
              {rec.headline}
            </div>
            <div className="mt-1.5 text-[11.5px] text-paper-muted leading-snug">
              {rec.reason}
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-paper">Start a run</h4>
          <div className="flex flex-col gap-2">
            <ActionButton kind="solve" recommended={rec.action === "solve"}
              disabled={disabled} dispatching={dispatching === "solve"} onClick={onSolve} large />
            <ActionButton kind="preview" recommended={rec.action === "preview"}
              disabled={disabled} dispatching={dispatching === "preview"} onClick={onPreview} large />
          </div>
          <div className="mt-2 text-xs leading-relaxed text-paper-faint">
            A preview creates a reviewable patch without pushing code. A solve opens a draft PR only after checks pass.
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-paper">Scope evidence</h4>
          <div className="text-xs leading-relaxed text-paper-muted">
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

function ScopeBadge({ s }: { s: ScopeInfo }) {
  // Tone map: doc/leaf are "safe" (green/muted), cross-file "caution",
  // refactor "danger" — drives at-a-glance risk reading. Title carries the
  // full reason + files/symbols so users can verify the guess.
  const styles: Record<ScopeBucket, string> = {
    doc: "border-ok/50 bg-ok/10 text-ok",
    leaf: "border-signal/50 bg-signal/10 text-signal",
    "cross-file": "border-info/50 bg-info/10 text-info",
    refactor: "border-alert/50 bg-alert/10 text-alert",
    "new-file": "border-info/50 bg-info/10 text-info",
    unknown: "border-border bg-surface text-paper-muted",
  };
  const label: Record<ScopeBucket, string> = {
    doc: "doc",
    leaf: "leaf",
    "cross-file": "cross",
    refactor: "refactor",
    "new-file": "new file",
    unknown: "?",
  };
  const titleParts = [s.reason];
  if (s.files.length) titleParts.push(`files: ${s.files.slice(0, 5).join(", ")}`);
  if (s.symbols.length) titleParts.push(`symbols: ${s.symbols.slice(0, 5).join(", ")}`);
  titleParts.push(`confidence: ${s.confidence}`);
  return (
    <span
      title={titleParts.join(" · ")}
      className={cn(
        "inline-block text-[11px] uppercase tracking-[0.12em] border px-1.5 py-0.5 leading-none cursor-help",
        styles[s.bucket],
      )}
    >
      {label[s.bucket]}
    </span>
  );
}

function SeverityChip({ s }: { s: "low" | "medium" | "high" | "critical" }) {
  const tone = { low: "muted", medium: "info", high: "signal", critical: "alert" } as const;
  return <StatusChip tone={tone[s]}>{s}</StatusChip>;
}

function ComplexityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5 items-center" aria-label={`complexity ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "inline-block h-2.5 w-1.5",
            i <= value
              ? value >= 4
                ? "bg-signal"
                : value >= 3
                  ? "bg-info"
                  : "bg-paper-dim"
              : "bg-border",
          )}
        />
      ))}
      <span className="ml-1.5 text-xs text-paper-muted tabular-nums">{value}/5</span>
    </span>
  );
}
