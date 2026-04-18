"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
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
  repo_count: number;
  issue_count: number;
  repos: DiscoverRepo[];
  issues: DiscoverIssue[];
};

const LANGUAGES = [
  "", "python", "javascript", "typescript", "rust", "go", "java", "c", "cpp", "ruby",
];

export function DiscoverScanner() {
  const [minStars, setMinStars] = useState("500");
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

  async function runDiscover() {
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
      const res = await fetch(`/api/discover?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const now = Date.now();

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
      <div className="border border-border bg-surface/40 p-4 grid grid-cols-1 sm:grid-cols-6 gap-3">
        <LabeledInput
          label="min stars"
          value={minStars}
          onChange={setMinStars}
          placeholder="500"
          type="number"
        />
        <LabeledInput
          label="max stars"
          value={maxStars}
          onChange={setMaxStars}
          placeholder="(no ceiling)"
          type="number"
        />
        <LabeledSelect
          label="language"
          value={language}
          onChange={setLanguage}
          options={LANGUAGES.map((l) => ({ value: l, label: l || "(any)" }))}
        />
        <LabeledInput
          label="repos"
          value={repoLimit}
          onChange={setRepoLimit}
          placeholder="12"
          type="number"
        />
        <LabeledInput
          label="issues/repo"
          value={issuesPerRepo}
          onChange={setIssuesPerRepo}
          placeholder="20"
          type="number"
        />
        <LabeledInput
          label="repo active within N days"
          value={repoAgeDays}
          onChange={setRepoAgeDays}
          placeholder="180"
          type="number"
        />
        <div className="sm:col-span-6 flex justify-end">
          <button
            onClick={runDiscover}
            disabled={loading || !minStars}
            className="inline-flex items-center gap-2 border border-signal bg-signal/10 text-paper px-4 py-2 text-[12px] hover:bg-signal/20 disabled:opacity-50"
          >
            <IconSearch />
            {loading ? "Searching GitHub…" : "Discover"}
            <IconArrow />
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 border border-alert/40 bg-alert/5 p-3 text-[12px] text-alert">
          {err}
        </div>
      )}

      {data && (
        <>
          {/* Summary + refiner pills */}
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mono-label text-paper-muted">discover</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="serif text-[40px] leading-none text-paper num-tabular">
                  {data.repo_count}
                </span>
                <span className="text-[13px] text-paper-muted">repos</span>
                <span className="text-paper-faint">·</span>
                <span className="serif text-[28px] leading-none text-signal num-tabular">
                  {filtered.length}
                </span>
                <span className="text-[13px] text-paper-muted">issues after filters</span>
                <span className="text-paper-faint">·</span>
                <span className="text-[13px] text-paper-muted num-tabular">
                  {data.issue_count} total scanned
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <PillRow
                label="age"
                options={[
                  { k: "30", label: "30d" },
                  { k: "90", label: "90d" },
                  { k: "any", label: "any" },
                ]}
                value={ageFilter}
                onChange={(v) => setAgeFilter(v as typeof ageFilter)}
              />
              <span className="mx-1 self-center text-paper-faint">·</span>
              <PillRow
                label="difficulty"
                options={[
                  { k: "any", label: "any" },
                  { k: "easy", label: "easy (1-2)" },
                  { k: "medium", label: "med (3)" },
                  { k: "hard", label: "hard (4-5)" },
                ]}
                value={difficulty}
                onChange={(v) => setDifficulty(v as typeof difficulty)}
              />
              <span className="mx-1 self-center text-paper-faint">·</span>
              <PillRow
                label="scope"
                options={[
                  { k: "any", label: "any" },
                  { k: "doc", label: "doc" },
                  { k: "leaf", label: "leaf" },
                  { k: "cross-file", label: "cross" },
                  { k: "new-file", label: "new file" },
                  { k: "refactor", label: "refactor" },
                ]}
                value={scopeFilter}
                onChange={(v) => setScopeFilter(v as typeof scopeFilter)}
              />
              <span className="mx-1 self-center text-paper-faint">·</span>
              <button
                onClick={() => setSolvableOnly((v) => !v)}
                className={cn(
                  "px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] border transition-colors",
                  solvableOnly
                    ? "border-signal/60 bg-signal/10 text-signal"
                    : "border-border text-paper-muted hover:text-paper",
                )}
              >
                solvable only
              </button>
            </div>
          </div>

          {/* Results table */}
          <div className="mt-6 border border-border bg-surface/40 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-ink/50 text-paper-muted">
                  {["REPO", "★", "#", "TITLE", "OPENED", "CATEGORY", "SCOPE", "SEVERITY", "COMPLEXITY", "EST. TIME", "ACTION"].map(
                    (h) => (
                      <th
                        key={h}
                        className="py-2.5 px-3 text-left font-normal tracking-[0.15em] text-[10px] uppercase"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-paper-muted text-[12px]">
                      {data.issue_count === 0
                        ? "No repos matched. Loosen the star threshold or clear the language filter."
                        : "Issues found but all filtered out. Relax the age/difficulty/scope pills."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((i) => (
                    <tr
                      key={`${i.repo.fullName}#${i.number}`}
                      className={cn(
                        "group border-b border-border-soft last:border-0 transition-colors hover:bg-surface-2/60",
                        !i.solvable && "opacity-60",
                      )}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Link
                          href={`/issues?repo=${encodeURIComponent(i.repo.fullName)}&issue=${i.number}`}
                          className="text-paper hover:text-signal"
                          title={i.repo.description || i.repo.fullName}
                        >
                          {i.repo.fullName}
                        </Link>
                        {i.repo.language && (
                          <span className="ml-2 text-[9px] uppercase tracking-[0.12em] text-paper-faint border border-border-soft px-1 py-0.5">
                            {i.repo.language}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-paper-muted tabular-nums whitespace-nowrap">
                        {fmtStars(i.repo.stars)}
                      </td>
                      <td className="px-3 py-2.5 text-paper-faint tabular-nums whitespace-nowrap">
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-signal inline-flex items-center gap-1"
                        >
                          #{i.number}
                          <IconExternal />
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-paper max-w-[380px]">
                        <div className="truncate">{i.title}</div>
                        {i.labels.length > 0 && (
                          <div className="mt-1 flex gap-1 flex-wrap">
                            {i.labels.slice(0, 3).map((l) => (
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
                      <td className="px-3 py-2.5 whitespace-nowrap text-paper-muted tabular-nums text-[11px]" title={i.created_at}>
                        {fmtRelative(i.created_at, now)}
                      </td>
                      <td className="px-3 py-2.5 text-[10px] uppercase tracking-[0.12em] text-paper-dim">
                        {i.category}
                      </td>
                      <td className="px-3 py-2.5">
                        <ScopeBadge s={i.scope} />
                      </td>
                      <td className="px-3 py-2.5">
                        <SeverityChip s={i.severity} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ComplexityPips value={i.complexity} />
                      </td>
                      <td className="px-3 py-2.5 text-paper-muted tabular-nums whitespace-nowrap">
                        ~{fmtMinutes(i.est_minutes)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/issues?repo=${encodeURIComponent(i.repo.fullName)}&issue=${i.number}`}
                          className="inline-flex items-center gap-1.5 border border-border bg-surface px-2.5 py-1 text-[11px] text-paper-dim hover:text-paper hover:border-border-strong"
                          title="Load this repo in the scanner"
                        >
                          open
                          <IconArrow />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !loading && !err && (
        <div className="mt-8 border border-border bg-surface/40 p-8 text-center">
          <div className="serif text-[28px] text-paper">Search GitHub for issues worth solving.</div>
          <p className="mt-2 text-[12px] text-paper-muted">
            Set a star floor and (optionally) a language, then pick through the results by
            age, difficulty, and scope. Click any row to scan that repo&apos;s full issue list.
          </p>
        </div>
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
    <label className="flex flex-col gap-1">
      <span className="mono-label text-paper-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="bg-surface border border-border px-3 py-2 text-[13px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-border-strong"
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
    <label className="flex flex-col gap-1">
      <span className="mono-label text-paper-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface border border-border px-3 py-2 text-[13px] text-paper focus:outline-none focus:border-border-strong"
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
    <span className="inline-flex items-center gap-1" title={label}>
      {options.map((opt) => (
        <button
          key={opt.k}
          onClick={() => onChange(opt.k)}
          className={cn(
            "px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] border transition-colors",
            value === opt.k
              ? "border-signal/60 bg-signal/10 text-signal"
              : "border-border text-paper-muted hover:text-paper",
          )}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}

function ScopeBadge({ s }: { s: ScopeInfo }) {
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
  const title = [
    s.reason,
    s.files.length ? `files: ${s.files.slice(0, 4).join(", ")}` : "",
    s.symbols.length ? `symbols: ${s.symbols.slice(0, 4).join(", ")}` : "",
    `confidence: ${s.confidence}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
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
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
