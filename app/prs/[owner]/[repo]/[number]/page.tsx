"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { cn } from "@/lib/utils";

type ReviewComment = {
  id: number;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  diffHunk: string | null;
  createdAt: string;
  type: "review" | "issue";
  inReplyTo: number | null;
};

type PrInfo = {
  title: string;
  state: string;
  url: string;
  branch: string;
  base: string;
  author: string;
};

type FixState = {
  commentId: number;
  status: "generating" | "done" | "error";
  response: string;
  tools: { tool: string; detail: string }[];
  cost: number | null;
};

export default function PrDetailPage() {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const repoFull = `${params.owner}/${params.repo}`;
  const prNumber = params.number;

  const [pr, setPr] = useState<PrInfo | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixState, setFixState] = useState<FixState | null>(null);
  const fixRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/prs/review?repo=${encodeURIComponent(repoFull)}&pr=${prNumber}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error))))
      .then((data: { pr: PrInfo; comments: ReviewComment[] }) => {
        setPr(data.pr);
        setComments(data.comments);
      })
      .catch((err) => setError(typeof err === "string" ? err : String(err)))
      .finally(() => setLoading(false));
  }, [repoFull, prNumber]);

  useEffect(() => {
    if (fixRef.current) fixRef.current.scrollIntoView({ behavior: "smooth" });
  }, [fixState?.response]);

  async function handleFix(comment: ReviewComment) {
    setFixState({
      commentId: comment.id,
      status: "generating",
      response: "",
      tools: [],
      cost: null,
    });

    try {
      const res = await fetch("/api/prs/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_number: parseInt(prNumber),
          branch: pr?.branch,
          comment_body: comment.body,
          file_path: comment.path,
          line: comment.line,
          diff_hunk: comment.diffHunk,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6)) as {
              text?: string;
              tool?: string;
              detail?: string;
              cost?: number;
              done?: boolean;
              error?: string;
            };
            if (p.tool) {
              setFixState((prev) =>
                prev
                  ? {
                      ...prev,
                      tools: [
                        ...prev.tools,
                        { tool: p.tool!, detail: p.detail ?? "" },
                      ],
                    }
                  : prev,
              );
            }
            if (p.text) {
              setFixState((prev) =>
                prev ? { ...prev, response: prev.response + p.text } : prev,
              );
            }
            if (p.cost !== undefined) {
              setFixState((prev) =>
                prev ? { ...prev, cost: p.cost as number } : prev,
              );
            }
            if (p.done) {
              setFixState((prev) =>
                prev ? { ...prev, status: "done" } : prev,
              );
            }
            if (p.error) {
              setFixState((prev) =>
                prev
                  ? { ...prev, response: p.error!, status: "error" }
                  : prev,
              );
            }
          } catch {
            /* skip */
          }
        }
      }

      setFixState((prev) =>
        prev && prev.status === "generating"
          ? { ...prev, status: "done" }
          : prev,
      );
    } catch (err) {
      setFixState((prev) =>
        prev
          ? {
              ...prev,
              response: err instanceof Error ? err.message : "Network error",
              status: "error",
            }
          : prev,
      );
    }
  }

  const isFixing = fixState?.status === "generating";

  return (
    <div
      className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-6 flex flex-col"
      style={{ minHeight: "calc(100vh - 56px)" }}
    >
      <PageHeading
        title={<>PR #{prNumber}</>}
        description={`Review comments on ${repoFull}#${prNumber}. Click "Fix" to generate and push a follow-up commit.`}
      />

      {loading && (
        <div className="mt-8 text-[12px] text-paper-muted animate-pulse-signal">
          Loading PR data...
        </div>
      )}

      {error && (
        <div className="mt-8 border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">
          {error}
        </div>
      )}

      {pr && (
        <>
          {/* PR header */}
          <div className="mt-4 border border-border bg-surface/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border",
                  pr.state === "OPEN"
                    ? "text-signal border-signal/30"
                    : pr.state === "MERGED"
                      ? "text-ok border-ok/30"
                      : "text-paper-muted border-border",
                )}
              >
                {pr.state}
              </span>
              <span className="text-[14px] text-paper font-medium">
                {pr.title}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-4 text-[11px] text-paper-muted">
              <span>
                {pr.author} wants to merge{" "}
                <span className="text-info">{pr.branch}</span> into{" "}
                <span className="text-info">{pr.base}</span>
              </span>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener"
                className="text-signal hover:underline"
              >
                view on GitHub
              </a>
            </div>
          </div>

          {/* Review comments */}
          <div className="mt-4 space-y-3">
            {comments.length === 0 && (
              <div className="border border-border bg-surface/40 px-4 py-6 text-center text-[12px] text-paper-muted">
                No review comments from maintainers yet.
              </div>
            )}

            {comments.map((c) => (
              <div
                key={c.id}
                className="border border-border bg-surface/40"
              >
                {/* Comment header */}
                <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2">
                  <span className="text-[11px] text-paper font-medium">
                    {c.author}
                  </span>
                  <span className="text-[10px] text-paper-faint">
                    {new Date(c.createdAt).toLocaleDateString()}{" "}
                    {new Date(c.createdAt).toLocaleTimeString()}
                  </span>
                  {c.path && (
                    <span className="ml-auto text-[10px] text-info font-mono">
                      {c.path}
                      {c.line ? `:${c.line}` : ""}
                    </span>
                  )}
                  {c.type === "review" && (
                    <span className="text-[9px] text-signal border border-signal/30 px-1 py-0.5">
                      inline
                    </span>
                  )}
                </div>

                {/* Diff hunk context */}
                {c.diffHunk && (
                  <div className="px-4 py-2 border-b border-border-soft bg-ink/30 overflow-x-auto">
                    <pre className="text-[10px] text-paper-faint font-mono whitespace-pre-wrap">
                      {c.diffHunk}
                    </pre>
                  </div>
                )}

                {/* Comment body */}
                <div className="px-4 py-3">
                  <p className="text-[12px] text-paper-dim whitespace-pre-wrap break-words">
                    {c.body}
                  </p>
                </div>

                {/* Fix button */}
                <div className="px-4 py-2 border-t border-border-soft flex items-center gap-2">
                  <button
                    onClick={() => handleFix(c)}
                    disabled={isFixing}
                    className="text-[11px] text-signal border border-signal/40 hover:bg-signal/10 px-3 py-1 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {fixState?.commentId === c.id && isFixing
                      ? "generating fix..."
                      : "fix this"}
                  </button>
                  <span className="text-[10px] text-paper-faint">
                    Claude will read the file, generate a fix, and show the
                    diff
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Fix output */}
          {fixState && (
            <div
              ref={fixRef}
              className="mt-4 border border-border bg-surface/40"
            >
              <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.15em] text-signal">
                  fix generation
                </span>
                {fixState.status === "generating" && (
                  <span className="ml-auto text-[10px] text-signal animate-pulse-signal">
                    generating...
                  </span>
                )}
                {fixState.status === "done" && fixState.cost !== null && (
                  <span className="ml-auto text-[10px] text-paper-muted tabular-nums">
                    ${fixState.cost.toFixed(4)}
                  </span>
                )}
              </div>

              {/* Tool activity */}
              {fixState.tools.length > 0 && (
                <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
                  <div className="flex flex-wrap gap-1.5">
                    {fixState.tools.map((t, i) => (
                      <span
                        key={i}
                        className={cn(
                          "inline-flex items-center gap-1 text-[9.5px] tracking-[0.05em] px-1.5 py-0.5 border leading-none",
                          t.tool === "grep" && "border-signal/30 text-signal",
                          t.tool === "read_file" && "border-info/30 text-info",
                          t.tool === "find_definition" &&
                            "border-ok/30 text-ok",
                        )}
                      >
                        {t.detail || t.tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Response */}
              <div className="px-4 py-4 overflow-x-auto">
                {fixState.status === "error" ? (
                  <div className="text-[11px] text-alert whitespace-pre-wrap break-words">
                    {fixState.response}
                  </div>
                ) : fixState.response ? (
                  <FixResponse text={fixState.response} />
                ) : (
                  <div className="text-[11px] text-paper-muted italic">
                    Reading file and generating fix...
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Render fix output with diff highlighting
function FixResponse({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-2.5 text-[12px] leading-relaxed text-paper-dim break-words">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          const isDiff =
            block.lang === "diff" ||
            block.lang === "patch" ||
            block.content.includes("@@");
          return (
            <div key={i} className="overflow-x-auto">
              <div className="flex items-center px-3 py-1 bg-ink/80 border border-border-soft border-b-0 text-[10px] text-paper-muted">
                <span className="font-mono">
                  {block.lang || (isDiff ? "diff" : "code")}
                </span>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 bg-ink/60 border border-border-soft text-[11px] leading-snug font-mono">
                {block.content.split("\n").map((line, li) => {
                  if (isDiff) {
                    let cls = "text-paper-dim";
                    let bg = "";
                    if (line.startsWith("+") && !line.startsWith("+++")) {
                      cls = "text-ok";
                      bg = "bg-ok/10";
                    } else if (
                      line.startsWith("-") &&
                      !line.startsWith("---")
                    ) {
                      cls = "text-alert";
                      bg = "bg-alert/10";
                    } else if (line.startsWith("@@")) {
                      cls = "text-info";
                      bg = "bg-info/10";
                    }
                    return (
                      <div
                        key={li}
                        className={cn("whitespace-pre-wrap", cls, bg)}
                      >
                        {line || "\u00a0"}
                      </div>
                    );
                  }
                  return (
                    <div key={li} className="whitespace-pre-wrap text-paper-dim">
                      {line || "\u00a0"}
                    </div>
                  );
                })}
              </pre>
            </div>
          );
        }
        if (block.type === "heading") {
          return (
            <div
              key={i}
              className="text-[13px] text-paper font-medium mt-3 first:mt-0"
            >
              {block.content}
            </div>
          );
        }
        if (block.type === "bullet") {
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-paper-faint shrink-0">-</span>
              <span className="break-words min-w-0">{block.content}</span>
            </div>
          );
        }
        if (!block.content.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className="break-words">
            {block.content}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "paragraph"; content: string }
  | { type: "heading"; content: string }
  | { type: "bullet"; content: string }
  | { type: "code"; content: string; lang: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: "code", content: code.join("\n"), lang });
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push({
        type: "heading",
        content: line.replace(/^#+\s*/, ""),
      });
      i++;
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      blocks.push({
        type: "bullet",
        content: line.replace(/^\s*[-*]\s+/, ""),
      });
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*]\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: para.join(" ") });
  }
  return blocks;
}
