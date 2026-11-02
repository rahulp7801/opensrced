"use client";

// The lesson's read-only code viewer (PLAN §7.8 centre column): the repo at
// the lesson's pinned commit, a filterable file list, and the file's text
// with line numbers. Files come straight from raw.githubusercontent.com (the
// /learn CSP allows it), the list from /api/ide/tree, like the IDE.
// ponytail: plain text, no highlighting or go-to-definition; the full VS
// Code workbench is several MB and boots once per page, so it stays on the
// write-it-yourself page. Upgrade path: Monaco read-only here.

import { useEffect, useId, useMemo, useState } from "react";
import { rawFileUrl, type RepoTree } from "@/lib/ide/repo-tree";
import { markExplored } from "../project-map";
import { cn } from "@/lib/utils";

/** Files above this are not shown inline (generated, vendored, data). */
const MAX_VIEW_BYTES = 400_000;
const LIST_LIMIT = 200;

export function CodeViewer({ repo, sha, className }: { repo: string; sha: string | null; className?: string }) {
  const [tree, setTree] = useState<RepoTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const filterId = useId();

  useEffect(() => {
    if (!sha) return;
    const controller = new AbortController();
    fetch(`/api/ide/tree?repo=${encodeURIComponent(repo)}&sha=${sha}`, { signal: controller.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (RepoTree & { error?: string }) | null;
        if (!r.ok || !body) throw new Error(body?.error ?? `Could not load the file list (${r.status}).`);
        setTree(body);
      })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [repo, sha]);

  useEffect(() => {
    if (!open || !sha) return;
    const size = tree?.files.find((f) => f.path === open)?.size ?? 0;
    setText(null);
    setFileError(null);
    if (size > MAX_VIEW_BYTES) { setFileError("This file is too large to show here. Open it on GitHub."); return; }
    markExplored(repo, open);
    const controller = new AbortController();
    fetch(rawFileUrl(repo, sha, open), { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`Could not load the file (${r.status}).`); setText(await r.text()); })
      .catch((e: Error) => { if (!controller.signal.aborted) setFileError(e.message); });
    return () => controller.abort();
  }, [open, repo, sha, tree]);

  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (tree?.files ?? []).filter((f) => words.every((w) => f.path.toLowerCase().includes(w))).slice(0, LIST_LIMIT);
  }, [tree, filter]);

  if (!sha) return <p className={cn("text-[15px] text-paper-muted", className)}>The code viewer needs the lesson&apos;s commit; it could not be looked up yet. Reload in a minute.</p>;
  return (
    <section aria-label="Code" className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-mono">Code at {sha.slice(0, 7)}</h2>
        <a href={`https://github.com/${repo}/tree/${sha}${open ? `/${open}` : ""}`} target="_blank" rel="noreferrer" className="text-link text-[13px]">GitHub</a>
      </div>
      {error && <p role="alert" className="mt-2 text-alert">{error}</p>}
      {open ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen(null)} className="text-link text-[14px]">← Files</button>
            <span className="min-w-0 truncate font-mono text-[13px] text-paper-dim">{open}</span>
          </div>
          {fileError && <p role="alert" className="mt-2 text-alert">{fileError}</p>}
          {text === null && !fileError && <p role="status" className="mt-2 text-paper-muted">Loading…</p>}
          {text !== null && (
            <pre tabIndex={0} aria-label={`Contents of ${open}`} className="mt-2 min-h-0 flex-1 overflow-auto rounded-md bg-ink-2 p-3 font-mono text-[12.5px] leading-[1.55] text-paper-dim">
              {text.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre"><span aria-hidden className="mr-4 inline-block w-10 select-none text-right text-paper-faint">{i + 1}</span>{line || " "}</div>
              ))}
            </pre>
          )}
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <label htmlFor={filterId} className="sr-only">Filter files</label>
          <input id={filterId} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files, e.g. session test" className="field" />
          {!tree && !error && <p role="status" className="mt-2 text-paper-muted">Loading the file list…</p>}
          {tree && (
            <ul className="mt-2 min-h-0 flex-1 overflow-y-auto font-mono text-[13px]">
              {shown.map((f) => (
                <li key={f.path}>
                  <button type="button" onClick={() => setOpen(f.path)} className="block min-h-8 w-full truncate text-left text-paper-dim hover:text-signal">{f.path}</button>
                </li>
              ))}
              {shown.length === LIST_LIMIT && <li className="py-1 font-sans text-paper-muted">Showing the first {LIST_LIMIT}; type to narrow.</li>}
              {shown.length === 0 && <li className="py-1 font-sans text-paper-muted">No file matches.</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
