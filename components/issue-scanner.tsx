"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { cacheGet, cacheSet } from "@/lib/client-cache";
import { StatusChip } from "./status-dot";
import { IconArrow, IconExternal, IconSearch } from "./icons";

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
  const [dispatchingNumber, setDispatchingNumber] = useState<number | null>(null);
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
      if (!request.signal.aborted) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  async function solve(n: number, dryRun: boolean) {
    if (!scan) return;
    setDispatchingNumber(n);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      router.push(`/dispatches?dispatch=${encodeURIComponent(data.dispatch_id)}`);
    } catch (e) {
      setErr(e instanceof Error && e.name === "TimeoutError"
        ? "Starting the run timed out. Please try again."
        : e instanceof Error ? e.message : String(e));
    } finally {
      setDispatchingNumber(null);
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

      {err && (
        <div className="mt-3 border border-alert/40 bg-alert/5 p-3 text-[12px] text-alert">
          {err}
        </div>
      )}

      {scan && (
        <>
          {/* Summary */}
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mono-label text-paper-muted">scan · {scan.repo}</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="serif text-[40px] leading-none text-paper num-tabular">
                  {scan.total}
                </span>
                <span className="text-[13px] text-paper-muted">open issues</span>
                <span className="text-paper-faint">·</span>
                <span className="serif text-[28px] leading-none text-signal num-tabular">
                  {scan.solvable}
                </span>
                <span className="text-[13px] text-paper-muted">classified as solvable</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {([
                { k: "solvable", label: `Solvable (${scan.solvable})` },
                { k: "all", label: `All (${scan.total})` },
              ] as const).map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setFilter(opt.k)}
                  aria-pressed={filter === opt.k}
                  className={cn(
                    "min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    filter === opt.k
                      ? "border-signal/60 bg-signal/10 text-signal"
                      : "border-border text-paper-muted hover:text-paper",
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <span className="mx-1 self-center text-paper-faint">·</span>
              {([
                { k: "recent", label: `Last 30d (${recentCount})` },
                { k: "any", label: "Any age" },
              ] as const).map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setAge(opt.k)}
                  aria-pressed={age === opt.k}
                  className={cn(
                    "min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    age === opt.k
                      ? "border-signal/60 bg-signal/10 text-signal"
                      : "border-border text-paper-muted hover:text-paper",
                  )}
                  title={
                    opt.k === "recent"
                      ? "Show only issues opened in the last 30 days (sorted newest first)"
                      : "Show all issues regardless of age"
                  }
                >
                  {opt.label}
                </button>
              ))}
              <span className="mx-1 self-center text-paper-faint">·</span>
              {([
                { k: "any", label: "Any tag" },
                { k: "good-first", label: `Good first (${goodFirstCount})` },
              ] as const).map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setBeginner(opt.k)}
                  aria-pressed={beginner === opt.k}
                  className={cn(
                    "min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    beginner === opt.k
                      ? "border-ok/60 bg-ok/10 text-ok"
                      : "border-border text-paper-muted hover:text-paper",
                  )}
                  title={
                    opt.k === "good-first"
                      ? "Only issues maintainers tagged for newcomers (good first issue, beginner, starter, first-timers-only, easy, low-hanging-fruit)"
                      : "Show issues regardless of beginner-friendly tags"
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="mt-6 border border-border bg-surface/40 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-ink/50 text-paper-muted">
                  {["#", "TITLE", "OPENED", "CATEGORY", "SCOPE", "SEVERITY", "COMPLEXITY", "EST. TIME", "STATE", "ACTION"].map((h) => (
                    <th
                      key={h}
                      className="py-2.5 px-3 text-left font-normal tracking-[0.15em] text-[10px] uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issues.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-paper-muted text-[12px]">
                      {beginner === "good-first"
                        ? "No beginner-tagged issues match the current filters. Switch to 'Any tag', or widen age/solvability."
                        : age === "recent" && filter === "solvable"
                          ? "No solvable issues opened in the last 30 days. Switch to 'Any age' to widen the window."
                          : filter === "solvable"
                            ? "No solvable issues in this repo. Switch to 'All' to see non-actionable ones."
                            : "No issues."}
                    </td>
                  </tr>
                ) : (
                  issues.map((issue) => {
                    const expanded = expandedNumber === issue.number;
                    const rec = recommendFor(issue);
                    return (
                      <Fragment key={issue.number}>
                        <tr
                          id={`issue-row-${issue.number}`}
                          onClick={() =>
                            setExpandedNumber(expanded ? null : issue.number)
                          }
                          className={cn(
                            "group border-b border-border-soft last:border-0 transition-colors cursor-pointer",
                            expanded ? "bg-surface-2/80" : "hover:bg-surface-2/60",
                            !issue.solvable && "opacity-60",
                          )}
                        >
                          <td className="px-3 py-2.5 text-paper-faint tabular-nums whitespace-nowrap">
                            <a
                              href={issue.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-signal inline-flex items-center gap-1"
                            >
                              #{issue.number}
                              <IconExternal />
                            </a>
                          </td>
                          <td className="px-3 py-2.5 text-paper max-w-[420px]">
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                "inline-block text-paper-faint text-[10px] transition-transform",
                                expanded && "rotate-90",
                              )}>▸</span>
                              <span className="truncate flex-1">{issue.title}</span>
                            </div>
                            {issue.labels.length > 0 && (
                              <div className="mt-1 flex gap-1 flex-wrap pl-4">
                                {issue.labels.slice(0, 4).map((l) => (
                                  <span
                                    key={l}
                                    className="text-[9px] uppercase tracking-[0.1em] border border-border-soft px-1 py-0.5 text-paper-muted"
                                  >
                                    {l}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap" title={issue.created_at}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-paper-muted tabular-nums text-[11px]">
                                {fmtRelative(issue.created_at, now)}
                              </span>
                              {now - Date.parse(issue.created_at) <= NEW_CUTOFF_MS && (
                                <span className="text-[9px] uppercase tracking-[0.12em] text-signal border border-signal/40 bg-signal/5 px-1 py-px leading-none">
                                  new
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[10px] uppercase tracking-[0.12em] text-paper-dim">
                            {issue.category}
                          </td>
                          <td className="px-3 py-2.5">
                            <ScopeBadge s={issue.scope} />
                          </td>
                          <td className="px-3 py-2.5">
                            <SeverityChip s={issue.severity} />
                          </td>
                          <td className="px-3 py-2.5">
                            <ComplexityPips value={issue.complexity} />
                          </td>
                          <td className="px-3 py-2.5 text-paper-muted tabular-nums whitespace-nowrap">
                            ~{fmtMinutes(issue.est_minutes)}
                          </td>
                          <td className="px-3 py-2.5">
                            {issue.solvable ? (
                              <StatusChip tone="ok">ready</StatusChip>
                            ) : (
                              <StatusChip tone="muted" className="cursor-help">skip</StatusChip>
                            )}
                          </td>
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            {issue.solvable ? (
                              <ActionButtons
                                recommended={rec.action}
                                disabled={dispatchingNumber !== null}
                                dispatching={dispatchingNumber === issue.number}
                                onPreview={() => solve(issue.number, true)}
                                onSolve={() => solve(issue.number, false)}
                              />
                            ) : (
                              <span className="text-[10px] text-paper-muted italic" title={issue.reason}>
                                {issue.reason.slice(0, 48)}
                              </span>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-border bg-ink/40">
                            <td colSpan={10} className="px-6 py-5">
                              <IssueDetail
                                issue={issue}
                                rec={rec}
                                disabled={dispatchingNumber !== null}
                                dispatching={dispatchingNumber === issue.number}
                                onPreview={() => solve(issue.number, true)}
                                onSolve={() => solve(issue.number, false)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!scan && !loading && !err && (
        <div className="mt-8 border border-border bg-surface/40 p-8 text-center">
          <div className="serif text-[28px] text-paper">Scan a repository.</div>
          <p className="mt-2 text-[12px] text-paper-muted">
            Paste any public GitHub repo URL. You&apos;ll see every open issue, classified and
            scored for complexity so you can pick the ones worth solving.
          </p>
        </div>
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

const ACTION_META: Record<ActionKind, { label: string; tooltip: string; iconColor: string }> = {
  preview: {
    label: "preview",
    tooltip:
      "Generate a patch without pushing code or opening a PR. Review and copy the patch in Dispatches.",
    iconColor: "text-paper-dim",
  },
  solve: {
    label: "solve & open PR",
    tooltip:
      "Explore the repository, generate a fix, and open a draft PR if the configured checks pass.",
    iconColor: "text-signal",
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
  dispatching: boolean;
  onPreview: () => void;
  onSolve: () => void;
}) {
  return (
    <div className="flex gap-1.5 justify-end">
      <ActionButton kind="preview" recommended={recommended === "preview"}
        disabled={disabled} dispatching={dispatching && recommended === "preview"} onClick={onPreview} />
      <ActionButton kind="solve" recommended={recommended === "solve"}
        disabled={disabled} dispatching={dispatching && recommended === "solve"} onClick={onSolve} />
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
    ? "px-4 py-2 text-[12px]"
    : "px-2.5 py-1 text-[11px]";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={meta.tooltip + (recommended ? "\n\nRecommended for this issue." : "")}
      className={cn(
        "relative inline-flex items-center gap-1.5 border transition-colors disabled:opacity-40",
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
      {dispatching ? "…" : meta.label}
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
  dispatching: boolean;
  onPreview: () => void;
  onSolve: () => void;
}) {
  const body = (issue.body ?? "").trim() || "(issue has no body)";
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* Left: full body */}
      <div>
        <div className="mono-label text-paper-muted mb-2">issue #{issue.number} · body</div>
        <div className="border border-border-soft bg-ink/60 p-4 text-[12.5px] text-paper leading-relaxed font-mono whitespace-pre-wrap max-h-[420px] overflow-y-auto">
          {body}
        </div>
      </div>

      {/* Right: recommendation + actions */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="mono-label text-paper-muted mb-2">recommendation</div>
          <div className={cn(
            "border p-3",
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
          <div className="mono-label text-paper-muted mb-2">start a run</div>
          <div className="flex flex-col gap-2">
            <ActionButton kind="solve" recommended={rec.action === "solve"}
              disabled={disabled} dispatching={dispatching && rec.action === "solve"} onClick={onSolve} large />
            <ActionButton kind="preview" recommended={rec.action === "preview"}
              disabled={disabled} dispatching={dispatching && rec.action === "preview"} onClick={onPreview} large />
          </div>
          <div className="mt-2 text-[10.5px] text-paper-faint leading-snug">
            <span className="text-signal">Solve &amp; open PR</span> = generate a fix and open a draft PR after checks.{" "}
            <span className="text-paper">preview</span> = generate a patch without pushing or opening a PR.
          </div>
        </div>

        <div>
          <div className="mono-label text-paper-muted mb-2">scope evidence</div>
          <div className="text-[11px] text-paper-muted leading-snug">
            <span className="text-paper">{issue.scope.reason}</span>
            {issue.scope.files.length > 0 && (
              <div className="mt-1">
                <span className="text-paper-faint">files:</span>{" "}
                {issue.scope.files.slice(0, 6).map((f, i) => (
                  <code key={f} className="text-paper">{i > 0 ? ", " : ""}{f}</code>
                ))}
              </div>
            )}
            {issue.scope.symbols.length > 0 && (
              <div className="mt-1">
                <span className="text-paper-faint">symbols:</span>{" "}
                {issue.scope.symbols.slice(0, 6).map((s, i) => (
                  <code key={s} className="text-paper">{i > 0 ? ", " : ""}{s}</code>
                ))}
              </div>
            )}
            <div className="mt-1 text-paper-faint">
              confidence: {issue.scope.confidence} · complexity {issue.complexity}/5 · ~{fmtMinutes(issue.est_minutes)}
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
        "inline-block text-[9px] uppercase tracking-[0.12em] border px-1.5 py-0.5 leading-none cursor-help",
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
      <span className="ml-1.5 text-[10px] text-paper-muted tabular-nums">{value}/5</span>
    </span>
  );
}
