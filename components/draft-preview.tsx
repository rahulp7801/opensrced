"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "./status-dot";
import { IconArrow, IconExternal, IconTrigger } from "./icons";
import { cn } from "@/lib/utils";

type FileChange = {
  path: string;
  original_content: string | null;
  new_content: string;
  is_new_file?: boolean;
  is_deleted?: boolean;
};

type Draft = {
  title: string;
  description: string;
  commit_message: string;
  changes: FileChange[];
  tests_added: FileChange[];
  branch_name?: string;
};

export function DraftPreview({
  dispatchId,
  repoUrl,
}: {
  dispatchId: string;
  repoUrl: string;
}) {
  const [drafts, setDrafts] = useState<Array<{ issue_number: number; title: string }> | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedFile, setSelectedFile] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "alert"; msg: string } | null>(null);
  const router = useRouter();

  // Poll for drafts
  useEffect(() => {
    let live = true;
    async function tick() {
      try {
        const res = await fetch(`/api/dispatches/${dispatchId}/drafts`, { cache: "no-store" });
        const data = await res.json();
        if (!live) return;
        const list = data.drafts ?? [];
        setDrafts(list);
        if (!selectedIssue && list[0]) setSelectedIssue(list[0].issue_number);
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [dispatchId, selectedIssue]);

  // Load selected draft
  useEffect(() => {
    if (!selectedIssue) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/dispatches/${dispatchId}/drafts?issue=${selectedIssue}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const d: Draft = await res.json();
        if (live) {
          setDraft(d);
          setSelectedFile(0);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      live = false;
    };
  }, [dispatchId, selectedIssue]);

  async function approve() {
    if (!draft || !selectedIssue) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/run/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          issue_number: selectedIssue,
          dry_run: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      setResult({ tone: "ok", msg: `Live run queued. Navigating to dispatch…` });
      setTimeout(() => router.push("/dispatches"), 900);
    } catch (e) {
      setResult({ tone: "alert", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  if (drafts === null) return null;
  if (drafts.length === 0) return null;

  const allFiles = draft ? [...draft.changes, ...draft.tests_added] : [];
  const current = allFiles[selectedFile];

  return (
    <div className="mt-8 border border-signal/40 bg-surface/40">
      {/* Header */}
      <div className="border-b border-border px-5 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <IconTrigger className="text-signal" />
          <span className="mono-label text-signal">pr draft · review before pushing</span>
        </div>
        {drafts.length > 1 && (
          <select
            value={selectedIssue ?? 0}
            onChange={(e) => setSelectedIssue(Number(e.target.value))}
            className="border border-border bg-ink text-paper text-[12px] px-2 py-1"
          >
            {drafts.map((d) => (
              <option key={d.issue_number} value={d.issue_number}>
                #{d.issue_number} · {d.title.slice(0, 60)}
              </option>
            ))}
          </select>
        )}
      </div>

      {draft && (
        <>
          {/* PR summary */}
          <div className="px-5 py-4 border-b border-border-soft">
            <div className="mono-label text-paper-muted">proposed title</div>
            <div className="mt-1 serif text-[24px] text-paper leading-snug">{draft.title}</div>
            {draft.description && (
              <details className="mt-3 text-[12px] text-paper-dim">
                <summary className="cursor-pointer hover:text-paper">
                  PR body ({draft.description.length} chars)
                </summary>
                <pre className="mt-2 p-3 bg-ink/60 border border-border-soft text-[11.5px] whitespace-pre-wrap text-paper-dim leading-relaxed max-h-60 overflow-auto">
                  {draft.description}
                </pre>
              </details>
            )}
            <div className="mt-3 flex items-center flex-wrap gap-3 text-[11px]">
              <StatusChip tone="info">{allFiles.length} file{allFiles.length === 1 ? "" : "s"}</StatusChip>
              {draft.branch_name && (
                <span className="text-paper-muted">
                  branch: <code className="text-paper">{draft.branch_name}</code>
                </span>
              )}
              {draft.commit_message && (
                <span className="text-paper-muted truncate max-w-md">
                  commit: <code className="text-paper">{draft.commit_message.split("\n")[0]}</code>
                </span>
              )}
            </div>
          </div>

          {/* File list + diff */}
          <div className="grid grid-cols-12">
            <aside className="col-span-4 lg:col-span-3 border-r border-border-soft">
              <div className="px-4 py-2 mono-label text-paper-muted">files</div>
              <ul className="max-h-[60vh] overflow-y-auto">
                {allFiles.map((f, i) => (
                  <li
                    key={f.path + i}
                    onClick={() => setSelectedFile(i)}
                    className={cn(
                      "px-4 py-2 cursor-pointer border-t border-border-soft text-[12px]",
                      selectedFile === i
                        ? "bg-surface-2/80 text-paper"
                        : "text-paper-dim hover:bg-surface-2/40 hover:text-paper",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {f.is_new_file && <span className="text-[9px] text-ok">NEW</span>}
                      {f.is_deleted && <span className="text-[9px] text-alert">DEL</span>}
                      <span className="truncate">{f.path}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="col-span-8 lg:col-span-9">
              {current ? (
                <DiffView file={current} />
              ) : (
                <div className="p-10 text-[12px] text-paper-muted text-center">
                  Select a file to view the proposed change.
                </div>
              )}
            </div>
          </div>

          {/* Approve */}
          <div className="border-t border-border px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-[11px] text-paper-muted max-w-2xl">
              Approving will rerun the pipeline in <span className="text-signal">live mode</span>:
              fork the repo, create a branch, commit these changes, and open the PR. Visible to the
              upstream maintainer.
            </div>
            <div className="flex items-center gap-3">
              {result && (
                <span
                  className={cn(
                    "text-[11px]",
                    result.tone === "ok" ? "text-ok" : "text-alert",
                  )}
                >
                  {result.msg}
                </span>
              )}
              <a
                href={draft.description.match(/https:\/\/github\.com\/\S+\/issues\/\d+/)?.[0] ?? repoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-paper-muted hover:text-paper"
              >
                issue <IconExternal />
              </a>
              <button
                onClick={approve}
                disabled={submitting || !draft}
                className="inline-flex items-center gap-2 border border-signal bg-signal/10 px-4 py-2 text-[12px] text-paper hover:bg-signal/20 disabled:opacity-50"
              >
                {submitting ? "queuing…" : "Approve & submit live PR"}
                <IconArrow />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DiffView({ file }: { file: FileChange }) {
  const original = file.original_content ?? "";
  const next = file.new_content ?? "";
  const origLines = original.split(/\r?\n/);
  const nextLines = next.split(/\r?\n/);
  // Very simple line-by-line diff — LCS would be nicer but this is a preview, not review.
  const maxLines = Math.max(origLines.length, nextLines.length);
  const rows: Array<{ kind: "ctx" | "add" | "del"; content: string; n: number }> = [];
  const origSet = new Set(origLines);
  const nextSet = new Set(nextLines);
  let i = 0,
    j = 0,
    n = 1;
  while (i < origLines.length || j < nextLines.length) {
    const a = origLines[i];
    const b = nextLines[j];
    if (a === b && a !== undefined) {
      rows.push({ kind: "ctx", content: a, n: n++ });
      i++;
      j++;
    } else if (b !== undefined && !origSet.has(b)) {
      rows.push({ kind: "add", content: b, n: n++ });
      j++;
    } else if (a !== undefined && !nextSet.has(a)) {
      rows.push({ kind: "del", content: a, n: n++ });
      i++;
    } else {
      // Fall back: emit both
      if (a !== undefined) rows.push({ kind: "del", content: a, n: n++ }), i++;
      if (b !== undefined) rows.push({ kind: "add", content: b, n: n++ }), j++;
    }
    if (rows.length > maxLines * 2 + 20) break; // safety
  }

  return (
    <pre className="max-h-[60vh] overflow-auto bg-ink/70 font-mono text-[11.5px] leading-relaxed">
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "px-4 py-0.5 whitespace-pre-wrap",
            r.kind === "add" && "bg-ok/10 text-ok",
            r.kind === "del" && "bg-alert/10 text-alert line-through opacity-80",
            r.kind === "ctx" && "text-paper-dim",
          )}
        >
          <span className="inline-block w-8 text-paper-faint tabular-nums select-none">
            {r.n}
          </span>
          <span className="inline-block w-4 text-paper-faint select-none">
            {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}
          </span>
          {r.content || " "}
        </div>
      ))}
    </pre>
  );
}
