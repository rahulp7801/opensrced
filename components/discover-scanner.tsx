"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { IconArrow, IconChevronDown, IconExternal, IconSearch } from "./icons";

type ScopeBucket = "doc" | "leaf" | "cross-file" | "refactor" | "new-file" | "unknown";

type ScopeInfo = {
  bucket: ScopeBucket;
  confidence: "low" | "medium" | "high";
  files: string[];
  symbols: string[];
  reason: string;
};

type DiscoverRepo = {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  stars: number;
  language: string | null;
  updatedAt: string;
  url: string;
  openIssuesCount: number;
};

type DiscoverIssue = {
  repo: DiscoverRepo;
  number: number;
  title: string;
  labels: string[];
  url: string;
  created_at: string;
  comments: number;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  complexity: number;
  est_minutes: number;
  solvable: boolean;
  reason: string;
  scope: ScopeInfo;
};

type DiscoverResponse = {
  query: unknown;
  warnings?: string[];
  repo_count: number;
  issue_count: number;
  repos: DiscoverRepo[];
  issues: DiscoverIssue[];
};

const LANGUAGES = [
  "", "python", "javascript", "typescript", "rust", "go", "java", "c", "cpp", "ruby",
];

function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("opensrcer-bookmarks");
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setBookmarks(parsed.filter((repo): repo is string =>
          typeof repo === "string" && repo.length <= 201 && /^[^/\s]+\/[^/\s]+$/.test(repo),
        ).slice(0, 100));
      }
    } catch { /* ignore */ }
  }, []);
  function toggle(repo: string) {
    setBookmarks((prev) => {
      const next = (prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]).slice(-100);
      try { localStorage.setItem("opensrcer-bookmarks", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  return { bookmarks, toggle, isBookmarked: (repo: string) => bookmarks.includes(repo) };
}

export function DiscoverScanner() {
  const [minStars, setMinStars] = useState("500");
  const { bookmarks, toggle: toggleBookmark, isBookmarked } = useBookmarks();
  // Empty string = no ceiling. Letting users target smaller repos where
  // a single contribution lands more visibly.
  const [maxStars, setMaxStars] = useState("");
  const [language, setLanguage] = useState("python");
  const [repoLimit, setRepoLimit] = useState("12");
  const [issuesPerRepo, setIssuesPerRepo] = useState("20");
  const [repoAgeDays, setRepoAgeDays] = useState("180");

  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Client-side refiners — no API round-trip to retune.
  const [ageFilter, setAgeFilter] = useState<"30" | "90" | "any">("30");
  const [difficulty, setDifficulty] = useState<"any" | "easy" | "medium" | "hard">("any");
  const [scopeFilter, setScopeFilter] = useState<"any" | "doc" | "leaf" | "cross-file" | "refactor" | "new-file">(
    "any",
  );
  const [solvableOnly, setSolvableOnly] = useState(true);

  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function runDiscover() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const params = new URLSearchParams({
        min_stars: minStars,
        repo_limit: repoLimit,
        issues_per_repo: issuesPerRepo,
      });
      if (maxStars.trim() && Number(maxStars) > 0) params.set("max_stars", maxStars.trim());
      if (language) params.set("language", language);
      if (repoAgeDays) params.set("max_repo_age_days", repoAgeDays);
      const res = await fetch(`/api/discover?${params.toString()}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      if (!controller.signal.aborted) setData(json);
    } catch (e) {
      if (controller.signal.aborted) return;
      setErr(e instanceof Error && e.name === "TimeoutError"
        ? "GitHub search took too long. Narrow the search or try again."
        : e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const now = Date.now();
  // Any filter narrower than "everything": offer a one-click way back.
  const filtersNarrow = ageFilter !== "any" || difficulty !== "any" || scopeFilter !== "any" || solvableOnly;
  function showAll() {
    setAgeFilter("any");
    setDifficulty("any");
    setScopeFilter("any");
    setSolvableOnly(false);
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const ageMs = ageFilter === "any" ? Infinity : Number(ageFilter) * 86_400_000;
    return data.issues.filter((i) => {
      if (solvableOnly && !i.solvable) return false;
      if (ageFilter !== "any") {
        const t = Date.parse(i.created_at);
        if (!Number.isFinite(t)) return false;
        if (now - t > ageMs) return false;
      }
      if (difficulty === "easy" && i.complexity > 2) return false;
      if (difficulty === "medium" && (i.complexity < 3 || i.complexity > 3)) return false;
      if (difficulty === "hard" && i.complexity < 4) return false;
      if (scopeFilter !== "any" && i.scope.bucket !== scopeFilter) return false;
      return true;
    });
  }, [data, ageFilter, difficulty, scopeFilter, solvableOnly, now]);

  return (
    <div>
      {/* Filter form */}
      <form
        onSubmit={(event) => { event.preventDefault(); void runDiscover(); }}
        className="card p-5 sm:p-6"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <LabeledSelect
            label="language"
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map((l) => ({ value: l, label: l || "(any)" }))}
          />
          <LabeledInput
            label="minimum stars"
            value={minStars}
            onChange={setMinStars}
            placeholder="500"
            type="number"
          />
          <LabeledInput
            label="maximum stars"
            value={maxStars}
            onChange={setMaxStars}
            placeholder="(no ceiling)"
            type="number"
          />
        </div>
        <div className="mt-5 grid gap-4 border-t border-border-soft pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none flex-col items-start justify-center gap-0.5 text-[14px] font-medium text-paper-dim hover:text-paper sm:flex-row sm:items-center sm:justify-start sm:gap-4">
              <span className="inline-flex items-center gap-2">
                Advanced filters
                <IconChevronDown size={14} className="text-paper-muted transition-transform group-open:rotate-180" />
              </span>
              <span className="text-[13px] font-normal text-paper-muted">How many repositories, and how recently updated</span>
            </summary>
            <div className="grid gap-4 pb-2 pt-3 sm:grid-cols-3">
              <LabeledInput
                label="repositories"
                value={repoLimit}
                onChange={setRepoLimit}
                placeholder="12"
                type="number"
              />
              <LabeledInput
                label="issues per repo"
                value={issuesPerRepo}
                onChange={setIssuesPerRepo}
                placeholder="20"
                type="number"
              />
              <LabeledInput
                label="updated within (days)"
                value={repoAgeDays}
                onChange={setRepoAgeDays}
                placeholder="180"
                type="number"
              />
            </div>
          </details>
          <button
            type="submit"
            disabled={loading || !minStars}
            className="btn-primary"
          >
            <IconSearch />
            {loading ? "Searching GitHub…" : "Search GitHub"}
            <IconArrow />
          </button>
        </div>
      </form>

      {loading && (
        <div role="status" aria-live="polite" className="callout mt-4 flex items-start gap-3">
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-signal" aria-hidden />
          <div>
            <p className="text-[14px] font-semibold text-paper">Searching GitHub</p>
            <p className="mt-0.5 text-[13px] text-paper-muted">Checking repositories and their open issues. Larger searches can take up to a minute.</p>
          </div>
        </div>
      )}

      {!!data?.warnings?.length && (
        <div role="status" className="callout mt-4 text-[13px]" data-tone="alert">
          Partial results: {data.warnings.join(" ")}
        </div>
      )}

      {err && (
        <div role="alert" className="callout mt-4 flex flex-wrap items-center justify-between gap-3 text-[15px]" data-tone="alert">
          <span>The search didn&apos;t finish: {err}</span>
          <button type="button" onClick={() => void runDiscover()} className="btn-quiet" data-size="sm">Try again</button>
        </div>
      )}

      {data && (
        <>
          {/* Summary and filters */}
          <div className="mt-10">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="display text-[56px] leading-[0.85] text-signal num-tabular">{filtered.length}</span>
              <span className="text-[16px] font-medium text-paper">issues to look at</span>
              <span className="text-[15px] text-paper-muted num-tabular">from {data.issue_count} open issues in {data.repo_count} repositories</span>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              <PillRow
                label="Opened"
                options={[
                  { k: "30", label: "last 30 days" },
                  { k: "90", label: "last 90 days" },
                  { k: "any", label: "any time" },
                ]}
                value={ageFilter}
                onChange={(v) => setAgeFilter(v as typeof ageFilter)}
              />
              <PillRow
                label="Difficulty"
                options={[
                  { k: "any", label: "any" },
                  { k: "easy", label: "easy" },
                  { k: "medium", label: "medium" },
                  { k: "hard", label: "hard" },
                ]}
                value={difficulty}
                onChange={(v) => setDifficulty(v as typeof difficulty)}
              />
              <PillRow
                label="Size of change"
                options={[
                  { k: "any", label: "any" },
                  { k: "doc", label: "docs only" },
                  { k: "leaf", label: "one file" },
                  { k: "cross-file", label: "several files" },
                  { k: "new-file", label: "a new file" },
                  { k: "refactor", label: "many files" },
                ]}
                value={scopeFilter}
                onChange={(v) => setScopeFilter(v as typeof scopeFilter)}
              />
              <button
                type="button"
                onClick={() => setSolvableOnly((v) => !v)}
                aria-pressed={solvableOnly}
                className="pill"
                data-size="sm"
              >
                Only issues ready for a fix
              </button>
              {filtersNarrow && (
                <button type="button" onClick={showAll} className="link min-h-10 px-1 text-[13px] font-medium">
                  Show all
                </button>
              )}
            </div>
          </div>

          {/* Results: one card per issue, its next step always in sight. */}
          <ul className="mt-6 space-y-2.5">
            {filtered.length === 0 ? (
              <li className="card px-5 py-10 text-center text-[14px] text-paper-muted">
                {data.repo_count === 0
                  ? "No repositories matched. Lower the minimum stars or choose any language."
                  : data.issue_count === 0
                    ? "Repositories matched, but none had open issues. Try a different star range or language."
                    : (
                      <>
                        Every issue found is hidden by the filters above.{" "}
                        <button type="button" onClick={showAll} className="link font-medium">Show all</button>
                      </>
                    )}
              </li>
            ) : (
              filtered.map((i) => {
                const href = `/issues?repo=${encodeURIComponent(i.repo.fullName)}&issue=${i.number}`;
                const saved = isBookmarked(i.repo.fullName);
                return (
                  <li
                    key={`${i.repo.fullName}#${i.number}`}
                    className={cn("group card px-5 py-4 sm:px-6", !i.solvable && "opacity-70")}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <Link href={href} className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-paper hover:text-signal">{i.title}</Link>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-paper-muted">
                          <span className="font-medium text-paper-dim">{i.repo.fullName}</span>
                          <span className="tabular-nums">★ {fmtStars(i.repo.stars)}</span>
                          {i.repo.language && <span>{i.repo.language}</span>}
                          <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-signal">#{i.number}<IconExternal /></a>
                          <span title={i.created_at}>opened {fmtRelative(i.created_at, now)}</span>
                        </p>
                        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-[14px] text-paper-muted">
                          <span className="inline-flex items-center gap-1.5">Size <ScopeBadge s={i.scope} /></span>
                          <span aria-hidden>·</span>
                          <span className="inline-flex items-center gap-1.5">Difficulty <ComplexityPips value={i.complexity} /></span>
                          <span aria-hidden>·</span>
                          <span className="mr-2">about {fmtMinutes(i.est_minutes)}</span>
                          {i.labels.slice(0, 3).map((l) => (
                            <span key={l} className="tag">{l}</span>
                          ))}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleBookmark(i.repo.fullName)}
                          aria-pressed={saved}
                          className="pill"
                          data-size="sm"
                          data-edge=""
                          title={saved ? "Remove this repository from Saved repos" : "Save this repository for later"}
                        >
                          {saved ? "Saved" : "Save repo"}
                        </button>
                        <Link href={href} className="row-cta">
                          Fix this issue <span aria-hidden>→</span>
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}

      {/* Bookmarked repos */}
      {bookmarks.length > 0 && (
        <div className="card mt-6 px-5 py-4">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="kicker text-signal">Saved repos</span>
            <span className="text-[12.5px] text-paper-muted">{bookmarks.length} bookmarked</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {bookmarks.map((repo) => (
              <div key={repo} className="flex items-center gap-2 rounded-full bg-ink-2 py-1 pl-3.5 pr-1 text-[13px] shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
                <Link href={`/issues?repo=${encodeURIComponent(repo)}`} className="font-medium text-paper hover:text-signal">{repo}</Link>
                <Link href={`/trigger?repo=${repo}`} className="link text-[12.5px]">fix</Link>
                <button onClick={() => toggleBookmark(repo)} aria-label={`Remove ${repo} from saved repos`} className="grid size-7 place-items-center rounded-full text-[13px] text-paper-muted hover:bg-surface-2 hover:text-alert">x</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data && !loading && (
        <section className="mt-12 border-t border-border pt-10" aria-labelledby="starter-repositories">
          <div className="max-w-2xl">
            <h2 id="starter-repositories" className="display text-[28px] leading-none text-paper sm:text-[32px]">
              Try a repository
            </h2>
            <p className="mt-3 text-[16px] leading-[1.6] text-paper-muted">
              Open a familiar project in the issue scanner, or use the filters above to search across GitHub.
            </p>
          </div>
          <div className="card mt-6 grid gap-px overflow-hidden bg-border-soft sm:grid-cols-3">
            {[
              { name: "astral-sh/ruff", lang: "Rust" },
              { name: "withastro/astro", lang: "TypeScript" },
              { name: "fastapi/fastapi", lang: "Python" },
            ].map((repo) => (
              <Link
                key={repo.name}
                href={`/issues?repo=${encodeURIComponent(`https://github.com/${repo.name}`)}`}
                className="group flex min-h-20 items-center justify-between gap-4 bg-surface px-6 py-5 transition-colors hover:bg-ink-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-semibold text-paper group-hover:text-signal">
                    {repo.name}
                  </span>
                  <span className="mt-1 block text-[13px] text-paper-muted">{repo.lang}</span>
                </span>
                <IconArrow className="shrink-0 text-paper-muted transition-transform group-hover:translate-x-0.5 group-hover:text-signal" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <label className="flex min-w-0 flex-col">
      <span className="field-label first-letter:uppercase">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="field bg-ink-2"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex min-w-0 flex-col">
      <span className="field-label first-letter:uppercase">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field bg-ink-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PillRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ k: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12.5px] font-semibold text-paper-muted">{label}</span>
      {options.map((opt) => (
        <button
          key={opt.k}
          type="button"
          onClick={() => onChange(opt.k)}
          aria-pressed={value === opt.k}
          className="pill"
          data-size="sm"
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}

function ScopeBadge({ s }: { s: ScopeInfo }) {
  // Plain coloured words (each >= 5.4:1 on the sheet), not a pill.
  const tones: Record<ScopeBucket, string> = {
    doc: "text-ok",
    leaf: "text-signal",
    "cross-file": "text-info",
    refactor: "text-alert",
    "new-file": "text-info",
    unknown: "text-paper-dim",
  };
  const label: Record<ScopeBucket, string> = {
    doc: "docs only",
    leaf: "one file",
    "cross-file": "several files",
    refactor: "many files",
    "new-file": "a new file",
    unknown: "unclear",
  };
  const title = [
    s.reason,
    s.files.length ? `files: ${s.files.slice(0, 4).join(", ")}` : "",
    s.symbols.length ? `symbols: ${s.symbols.slice(0, 4).join(", ")}` : "",
    `confidence: ${s.confidence}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span title={title} className={cn("cursor-help font-semibold", tones[s.bucket])}>
      {label[s.bucket]}
    </span>
  );
}

function ComplexityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-[3px] items-center" aria-label={`complexity ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "inline-block size-2 rounded-full",
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
      <span className="ml-1.5 text-[12.5px] text-paper-muted tabular-nums">{value}/5</span>
    </span>
  );
}

function fmtStars(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 15) / 4;
  return `${h}h`;
}

function fmtRelative(iso: string, now: number): string {
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
