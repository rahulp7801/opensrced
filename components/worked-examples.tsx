"use client";

// Recommendation extras for the existing issue lists (PLAN.md §6.5 item 2.5).
// The list routes add `recs` to an issue only when OPENSRCER_RECS is on and the
// issue is in the catalog index, so with the flag off none of this renders.

import { useState } from "react";
import { cn } from "@/lib/utils";

/** lib/recs/rank.ts IssueInsight, as JSON. */
export type IssueInsight = {
  difficulty: number | null;
  reasons: string[];
  testable: boolean;
  unreachableReason: string | null;
  workedExamples: number;
};

type Example = {
  repo: string; number: number; title: string; url: string; closingPr: number; prUrl: string;
  fixFiles: number | null; fixAdd: number | null; fixDel: number | null; mergeHours: number | null; sameRepo: boolean;
};

/** "Testable here" / "can't run here" for the meta line. */
export function TestableTag({ recs }: { recs?: IssueInsight }) {
  if (!recs) return null;
  if (recs.testable) return <span className="tag" data-tone="ok" title="This project's tests run in opensrcer">testable here</span>;
  if (recs.unreachableReason) return <span className="tag" title={recs.unreachableReason}>can&apos;t run here</span>;
  return null;
}

function fmtMergeTime(hours: number | null): string {
  if (hours === null) return "";
  if (hours < 24) return ` merged in ${Math.max(1, hours)}h`;
  const days = Math.round(hours / 24);
  return ` merged in ${days} day${days === 1 ? "" : "s"}`;
}

/** Why the difficulty is what it is, plus a drawer of similar solved issues
 *  and the PRs that fixed them, loaded only when opened. */
export function DifficultyAndExamples({ repo, number, recs, className }: { repo: string; number: number; recs?: IssueInsight; className?: string }) {
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!recs) return null;

  async function load() {
    if (examples || error) return;
    try {
      const res = await fetch(`/api/recs/similar?repo=${encodeURIComponent(repo)}&issue=${number}`, { signal: AbortSignal.timeout(20_000) });
      const data = await res.json() as { examples?: Example[]; error?: string };
      if (!res.ok || !Array.isArray(data.examples)) throw new Error(data.error ?? "Worked examples are unavailable right now.");
      setExamples(data.examples);
    } catch (e) {
      setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Worked examples timed out.");
    }
  }

  return (
    <div className={cn("text-[13px] leading-relaxed text-paper-muted", className)}>
      {recs.difficulty !== null && (
        <>
          <h4 className="label-mono mb-2">Difficulty {recs.difficulty}/5</h4>
          {recs.reasons.length > 0
            ? <ul className="list-disc space-y-0.5 pl-4 text-paper-dim">{recs.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            : <p className="text-paper-dim">No strong signals either way.</p>}
        </>
      )}
      <details className="mt-3" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) void load(); }}>
        <summary className="cursor-pointer font-semibold text-paper">
          Worked examples{recs.workedExamples > 0 ? ` (${recs.workedExamples})` : ""}
        </summary>
        <div className="mt-2" aria-live="polite">
          {error && <p role="alert">{error}</p>}
          {!error && !examples && <p>Loading…</p>}
          {examples?.length === 0 && <p>No similar solved issues yet.</p>}
          {examples && examples.length > 0 && (
            <ul className="space-y-1.5">
              {examples.map((example) => (
                <li key={`${example.repo}#${example.number}`}>
                  <a href={example.url} target="_blank" rel="noreferrer" className="text-link">
                    {example.sameRepo ? "" : `${example.repo} `}#{example.number}
                  </a>{" "}
                  <span className="text-paper-dim">{example.title}</span> → fixed by{" "}
                  <a href={`${example.prUrl}/files`} target="_blank" rel="noreferrer" className="text-link">PR #{example.closingPr}</a>
                  {example.fixAdd !== null && example.fixDel !== null && ` (+${example.fixAdd} −${example.fixDel}`}
                  {example.fixFiles !== null && `, ${example.fixFiles} file${example.fixFiles === 1 ? "" : "s"}`}
                  {fmtMergeTime(example.mergeHours)}
                  {example.fixAdd !== null && example.fixDel !== null && ")"}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
