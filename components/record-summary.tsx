"use client";

// The account's own contribution record (GET /api/record): level, standing
// and where it came from, and the opt-in history import. Private; no
// leaderboard. Shown on /account behind OPENSRCER_RECORD.

import { useCallback, useEffect, useState } from "react";

type RecordData = {
  level: string;
  standing: number;
  breakdown: { [kind: string]: number };
  spamFlags: string[];
  contributions: unknown[];
  history: { importedAt: string; merged: number; contributedTo: number; signals: { opened: number; merged: number } } | null;
};

const KIND_LABEL: { [kind: string]: string } = {
  merged: "Merged PRs", merged_self: "Merged PRs you wrote yourself", imported_merged: "Imported merged PRs (half weight)",
  approval: "Maintainer approvals", review_replied: "Replied to review, then merged", lesson_clean: "Lessons finished without the last hint",
  brief_review: "Kickoff briefs reviewed",
};

export function RecordSummary() {
  const [record, setRecord] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/record", { cache: "no-store" });
    const body = (await r.json().catch(() => ({}))) as RecordData & { error?: string };
    if (!r.ok) throw new Error(body.error ?? "Could not load your record.");
    setRecord(body);
  }, []);

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);

  async function importHistory() {
    setImporting(true);
    setError(null);
    try {
      const r = await fetch("/api/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import" }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not import your history.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import your history.");
    } finally {
      setImporting(false);
    }
  }

  if (error && !record) return <p role="alert" className="card p-5 text-[14px] text-alert">{error}</p>;
  if (!record) return <p className="card p-5 text-[14px] text-paper-muted">Loading your record…</p>;
  const earned = Object.entries(record.breakdown).filter(([kind, points]) => points > 0 && KIND_LABEL[kind]);
  return (
    <div className="card px-5 py-4">
      <p className="text-[18px] font-semibold capitalize text-paper">{record.level}</p>
      <p className="mt-0.5 text-[14px] text-paper-muted">{record.standing} standing points. Opening a PR earns none; a closed PR costs none.</p>
      {earned.length > 0 && (
        <ul className="mt-3 space-y-1 text-[14px] text-paper-dim">
          {earned.map(([kind, points]) => <li key={kind}>{KIND_LABEL[kind]}: {points}</li>)}
        </ul>
      )}
      {record.spamFlags.length > 0 && (
        <p className="mt-3 text-[14px] text-paper">Level-ups are paused until a person reviews: {record.spamFlags.join(", ")}. Only you can see this.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
        <p className="min-w-0 flex-1 text-[14px] text-paper-muted">
          {record.history
            ? `Imported ${new Date(record.history.importedAt).toLocaleDateString()}: ${record.history.merged} merged public PRs, ${record.history.contributedTo} repositories.`
            : "Import your merged public PRs from GitHub. They count at half weight, up to Contributor."}
        </p>
        <button onClick={importHistory} disabled={importing} className="btn-quiet" data-size="sm">
          {importing ? "Importing…" : record.history ? "Import again" : "Import my GitHub history"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-[14px] text-alert">{error}</p>}
    </div>
  );
}
