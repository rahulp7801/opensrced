"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  isOwnComment?: boolean;
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
  commentId: number | "all";
  status: "generating" | "done" | "error";
  response: string;
  tools: { tool: string; detail: string }[];
  cost: number | null;
};

type PushState = "idle" | "pushing" | "pushed" | "error";

type ReplyState = {
  commentId: number;
  status: "idle" | "sending" | "sent" | "error";
};

function extractDiff(text: string): string | null {
  const patterns = [
    /```(?:diff|patch)\n([\s\S]*?)```/,
    /```\n(---[\s\S]*?)```/,
    /```\n(\+\+\+[\s\S]*?)```/,
    /```(?:python|py|javascript|js|typescript|ts|rust|go|java|c|cpp)?\n([\s\S]*?)```/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1].trim()) {
      const block = m[1].trim();
      if (/^[-+@]|^---\s|^\+\+\+\s/m.test(block)) return block;
    }
  }
  const anyFenced = /```\w*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = anyFenced.exec(text)) !== null) {
    const block = m[1].trim();
    if (/^[-+].*\n[-+]/m.test(block)) return block;
  }
  return null;
}

export default function PrDetailPage() {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const repoFull = `${params.owner}/${params.repo}`;
  const prNumber = params.number;

  const [pr, setPr] = useState<PrInfo | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixState, setFixState] = useState<FixState | null>(null);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [pushMessage, setPushMessage] = useState("");
  const [commitMsg, setCommitMsg] = useState("address review feedback");
  const [replyStates, setReplyStates] = useState<Map<number, ReplyState>>(new Map());
  const [replyTexts, setReplyTexts] = useState<Map<number, string>>(new Map());
  const [showReplyFor, setShowReplyFor] = useState<number | null>(null);
  const [prDiff, setPrDiff] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const fixRef = useRef<HTMLDivElement>(null);

  // Load PR data
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

  // Scroll to fix output
  useEffect(() => {
    if (fixRef.current && fixState?.response) {
      fixRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [fixState?.response]);

  // Lazy-load diff
  const loadDiff = useCallback(() => {
    if (prDiff !== null || diffLoading) return;
    setDiffLoading(true);
    fetch(`/api/prs/diff?repo=${encodeURIComponent(repoFull)}&pr=${prNumber}`)
      .then((r) => r.json())
      .then((data: { diff?: string; error?: string }) => {
        setPrDiff(data.diff ?? data.error ?? "");
      })
      .catch(() => setPrDiff("Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }, [repoFull, prNumber, prDiff, diffLoading]);

  // ── Fix single comment ────────────────────────────────────────────

  async function handleFix(comment: ReviewComment) {
    setFixState({
      commentId: comment.id,
      status: "generating",
      response: "",
      tools: [],
      cost: null,
    });
    await streamFix(comment.body, comment.path, comment.line, comment.diffHunk);
  }

  // ── Fix all comments ──────────────────────────────────────────────

  async function handleFixAll() {
    const actionable = comments.filter((c) => c.type === "review" || !c.inReplyTo);
    if (actionable.length === 0) return;

    const combinedComment = actionable
      .map((c) => {
        const loc = c.path ? `[${c.path}${c.line ? `:${c.line}` : ""}]` : "";
        return `${loc} ${c.author}: "${c.body}"`;
      })
      .join("\n\n");

    setFixState({
      commentId: "all",
      status: "generating",
      response: "",
      tools: [],
      cost: null,
    });

    await streamFix(
      `Multiple review comments to address:\n\n${combinedComment}`,
      null,
      null,
      null,
    );
  }

  async function streamFix(
    commentBody: string,
    filePath: string | null,
    line: number | null,
    diffHunk: string | null,
  ) {
    try {
      const res = await fetch("/api/prs/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_number: parseInt(prNumber),
          branch: pr?.branch,
          comment_body: commentBody,
          file_path: filePath,
          line,
          diff_hunk: diffHunk,
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
                prev ? { ...prev, tools: [...prev.tools, { tool: p.tool!, detail: p.detail ?? "" }] } : prev,
              );
            }
            if (p.text) {
              setFixState((prev) => (prev ? { ...prev, response: prev.response + p.text } : prev));
            }
            if (p.cost !== undefined) {
              setFixState((prev) => (prev ? { ...prev, cost: p.cost as number } : prev));
            }
            if (p.done) {
              setFixState((prev) => (prev ? { ...prev, status: "done" } : prev));
            }
            if (p.error) {
              setFixState((prev) => (prev ? { ...prev, response: p.error!, status: "error" } : prev));
            }
          } catch { /* skip */ }
        }
      }

      setFixState((prev) =>
        prev && prev.status === "generating" ? { ...prev, status: "done" } : prev,
      );
    } catch (err) {
      setFixState((prev) =>
        prev ? { ...prev, response: err instanceof Error ? err.message : "Network error", status: "error" } : prev,
      );
    }
  }

  // ── Push fix ──────────────────────────────────────────────────────

  async function handlePush() {
    if (!fixState?.response || !pr) return;
    const diff = extractDiff(fixState.response);
    if (!diff) {
      setPushState("error");
      setPushMessage("No diff block found in the generated response.");
      return;
    }

    setPushState("pushing");
    setPushMessage("");

    const forkRepo = `${pr.author}/${params.repo}`;

    try {
      const res = await fetch("/api/prs/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: forkRepo,
          upstream: repoFull,
          branch: pr.branch,
          diff,
          commit_message: commitMsg.trim() || "address review feedback",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; commit?: string; message?: string; error?: string };
      if (data.ok) {
        setPushState("pushed");
        setPushMessage(data.message ?? `Pushed commit ${data.commit}`);
      } else {
        setPushState("error");
        setPushMessage(data.error ?? "Push failed");
      }
    } catch (err) {
      setPushState("error");
      setPushMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  // ── Reply to comment ──────────────────────────────────────────────

  async function handleReply(comment: ReviewComment) {
    const text = replyTexts.get(comment.id)?.trim();
    if (!text) return;

    setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "sending" }));

    try {
      const res = await fetch("/api/prs/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_number: parseInt(prNumber),
          comment_id: comment.id,
          body: text,
          type: comment.type,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "sent" }));
        setShowReplyFor(null);
        setReplyTexts((prev) => { const m = new Map(prev); m.delete(comment.id); return m; });
      } else {
        setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "error" }));
      }
    } catch {
      setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "error" }));
    }
  }

  // ── Draft reply (AI, no code exploration) ──────────────────────────

  async function handleDraftReply(comment: ReviewComment) {
    setFixState({
      commentId: comment.id,
      status: "generating",
      response: "",
      tools: [],
      cost: null,
    });

    try {
      const res = await fetch("/api/prs/draft-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: comment.body,
          comment_author: comment.author,
          file_path: comment.path,
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
            const p = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; error?: string };
            if (p.text) setFixState((prev) => prev ? { ...prev, response: prev.response + p.text } : prev);
            if (p.done) setFixState((prev) => prev ? { ...prev, status: "done" } : prev);
            if (p.error) setFixState((prev) => prev ? { ...prev, response: p.error!, status: "error" } : prev);
          } catch { /* skip */ }
        }
      }

      // Auto-populate the reply input with the drafted text
      setFixState((prev) => {
        if (prev && prev.status !== "error") {
          setReplyTexts((rt) => new Map(rt).set(comment.id, prev.response));
          setShowReplyFor(comment.id);
        }
        return prev ? { ...prev, status: "done" } : prev;
      });
    } catch (err) {
      setFixState((prev) =>
        prev ? { ...prev, response: err instanceof Error ? err.message : "Error", status: "error" } : prev,
      );
    }
  }

  const isFixing = fixState?.status === "generating";
  const actionableComments = comments.filter((c) => c.type === "review" || !c.inReplyTo);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-6" style={{ minHeight: "calc(100vh - 56px)" }}>
      <PageHeading
        title={<>PR #{prNumber}</>}
        description={`Review and respond to feedback on ${repoFull}#${prNumber}`}
      />

      {loading && <PrSkeleton />}
      {error && <div className="mt-8 border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">{error}</div>}

      {pr && (
        <>
          {/* PR header */}
          <div className="mt-4 border border-border bg-surface/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={cn(
                "text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border",
                pr.state === "OPEN" ? "text-signal border-signal/30" : pr.state === "MERGED" ? "text-ok border-ok/30" : "text-paper-muted border-border",
              )}>
                {pr.state}
              </span>
              <span className="text-[14px] text-paper font-medium">{pr.title}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-4 text-[11px] text-paper-muted flex-wrap">
              <span>
                {pr.author} wants to merge <span className="text-info">{pr.branch}</span> into <span className="text-info">{pr.base}</span>
              </span>
              <a href={pr.url} target="_blank" rel="noopener" className="text-signal hover:underline">view on GitHub</a>
              <button
                onClick={() => { setShowDiff(!showDiff); if (!prDiff) loadDiff(); }}
                className="text-paper-dim hover:text-signal transition-colors"
              >
                {showDiff ? "hide diff" : "show diff"}
              </button>
            </div>
          </div>

          {/* Collapsible PR diff */}
          {showDiff && (
            <div className="border border-border border-t-0 bg-ink/30 max-h-[400px] overflow-auto">
              {diffLoading ? (
                <div className="px-4 py-3 text-[11px] text-paper-muted animate-pulse-signal">Loading diff...</div>
              ) : prDiff ? (
                <pre className="px-4 py-3 text-[10.5px] font-mono leading-snug">
                  {prDiff.split("\n").map((line, i) => {
                    let cls = "text-paper-dim";
                    let bg = "";
                    if (line.startsWith("+") && !line.startsWith("+++")) { cls = "text-ok"; bg = "bg-ok/5"; }
                    else if (line.startsWith("-") && !line.startsWith("---")) { cls = "text-alert"; bg = "bg-alert/5"; }
                    else if (line.startsWith("@@")) { cls = "text-info"; bg = "bg-info/5"; }
                    else if (line.startsWith("diff ") || line.startsWith("index ")) { cls = "text-paper-faint"; }
                    return <div key={i} className={cn("whitespace-pre-wrap", cls, bg)}>{line || "\u00a0"}</div>;
                  })}
                </pre>
              ) : (
                <div className="px-4 py-3 text-[11px] text-paper-muted">No diff available</div>
              )}
            </div>
          )}

          {/* Action bar */}
          {actionableComments.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleFixAll}
                disabled={isFixing}
                className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isFixing && fixState?.commentId === "all" ? "generating fixes..." : `fix all ${actionableComments.length} comments`}
              </button>
              <span className="text-[10px] text-paper-faint">
                Generates a single commit addressing all review feedback
              </span>
            </div>
          )}

          {/* Review comments */}
          <div className="mt-4 space-y-3">
            {comments.length === 0 && (
              <div className="border border-border bg-surface/40 px-4 py-6 text-center text-[12px] text-paper-muted">
                No review comments from maintainers yet.
              </div>
            )}

            {comments.map((c) => {
              const replySt = replyStates.get(c.id);
              return (
                <div key={c.id} className={cn("border bg-surface/40", c.isOwnComment ? "border-border-soft opacity-60" : "border-border")}>
                  {/* Comment header */}
                  <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-paper font-medium">{c.author}</span>
                    {c.isOwnComment && <span className="text-[9px] text-paper-faint border border-border px-1 py-0.5">you</span>}
                    <span className="text-[10px] text-paper-faint">
                      {new Date(c.createdAt).toLocaleDateString()} {new Date(c.createdAt).toLocaleTimeString()}
                    </span>
                    {c.path && (
                      <span className="ml-auto text-[10px] text-info font-mono">{c.path}{c.line ? `:${c.line}` : ""}</span>
                    )}
                    {c.type === "review" && (
                      <span className="text-[9px] text-signal border border-signal/30 px-1 py-0.5">inline</span>
                    )}
                  </div>

                  {/* Diff hunk */}
                  {c.diffHunk && (
                    <div className="px-4 py-2 border-b border-border-soft bg-ink/30 overflow-x-auto">
                      <pre className="text-[10px] text-paper-faint font-mono whitespace-pre-wrap">{c.diffHunk}</pre>
                    </div>
                  )}

                  {/* Comment body */}
                  <div className="px-4 py-3">
                    <p className="text-[12px] text-paper-dim whitespace-pre-wrap break-words">{c.body}</p>
                  </div>

                  {/* Action buttons — smart: show "draft reply" for questions, "fix this" for code requests */}
                  {!c.isOwnComment && (
                  <div className="px-4 py-2 border-t border-border-soft flex items-center gap-2 flex-wrap">
                    {isQuestion(c.body) ? (
                      <>
                        <button
                          onClick={() => handleDraftReply(c)}
                          disabled={isFixing}
                          className="text-[11px] text-info border border-info/40 hover:bg-info/10 px-3 py-1 transition disabled:opacity-50"
                        >
                          {fixState?.commentId === c.id && isFixing ? "drafting..." : "draft reply"}
                        </button>
                        <button
                          onClick={() => setShowReplyFor(showReplyFor === c.id ? null : c.id)}
                          className="text-[11px] text-paper-dim border border-border-soft hover:border-paper-muted hover:text-paper-dim px-3 py-1 transition"
                        >
                          reply manually
                        </button>
                        <span className="text-[10px] text-paper-faint">question detected — AI will draft a reply, no code exploration</span>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleFix(c)}
                          disabled={isFixing}
                          className="text-[11px] text-signal border border-signal/40 hover:bg-signal/10 px-3 py-1 transition disabled:opacity-50"
                        >
                          {fixState?.commentId === c.id && isFixing ? "generating..." : "fix this"}
                        </button>
                        <button
                          onClick={() => handleDraftReply(c)}
                          disabled={isFixing}
                          className="text-[11px] text-info border border-info/40 hover:bg-info/10 px-3 py-1 transition disabled:opacity-50"
                        >
                          draft reply
                        </button>
                        <button
                          onClick={() => setShowReplyFor(showReplyFor === c.id ? null : c.id)}
                          className="text-[11px] text-paper-dim border border-border-soft hover:border-paper-muted hover:text-paper-dim px-3 py-1 transition"
                        >
                          reply manually
                        </button>
                      </>
                    )}
                    {replySt?.status === "sent" && (
                      <span className="text-[10px] text-ok">replied</span>
                    )}
                  </div>
                  )}

                  {/* Reply input */}
                  {showReplyFor === c.id && (
                    <div className="px-4 py-2.5 border-t border-border-soft bg-ink/20">
                      <div className="flex gap-2">
                        <textarea
                          value={replyTexts.get(c.id) ?? ""}
                          onChange={(e) => setReplyTexts((prev) => new Map(prev).set(c.id, e.target.value))}
                          placeholder="Write a reply..."
                          rows={2}
                          className="flex-1 bg-surface border border-border px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50 resize-y min-h-[40px]"
                        />
                        <button
                          onClick={() => handleReply(c)}
                          disabled={!replyTexts.get(c.id)?.trim() || replySt?.status === "sending"}
                          className="self-end border border-info/50 bg-info/10 text-info hover:bg-info/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] disabled:opacity-50 shrink-0 transition"
                        >
                          {replySt?.status === "sending" ? "..." : "send"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Fix output */}
          {fixState && (
            <div ref={fixRef} className="mt-4 border border-border bg-surface/40">
              <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.15em] text-signal">
                  {fixState.commentId === "all" ? "fix all comments" : "fix generation"}
                </span>
                {fixState.status === "generating" && (
                  <span className="ml-auto text-[10px] text-signal animate-pulse-signal">generating...</span>
                )}
                {fixState.status === "done" && fixState.cost !== null && (
                  <span className="ml-auto text-[10px] text-paper-muted tabular-nums">${fixState.cost.toFixed(4)}</span>
                )}
              </div>

              {/* Tool activity */}
              {fixState.tools.length > 0 && (
                <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
                  <div className="flex flex-wrap gap-1.5">
                    {fixState.tools.map((t, i) => (
                      <span key={i} className={cn(
                        "inline-flex items-center gap-1 text-[9.5px] tracking-[0.05em] px-1.5 py-0.5 border leading-none",
                        t.tool === "grep" && "border-signal/30 text-signal",
                        t.tool === "read_file" && "border-info/30 text-info",
                        t.tool === "find_definition" && "border-ok/30 text-ok",
                      )}>
                        {t.detail || t.tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Response */}
              <div className="px-4 py-4 overflow-x-auto">
                {fixState.status === "error" ? (
                  <div className="text-[11px] text-alert whitespace-pre-wrap break-words">{fixState.response}</div>
                ) : fixState.response ? (
                  <FixResponse text={fixState.response} />
                ) : (
                  <div className="text-[11px] text-paper-muted italic">Reading file and generating fix...</div>
                )}
              </div>

              {/* Push controls */}
              {fixState.status === "done" && extractDiff(fixState.response) && (
                <div className="px-4 py-3 border-t border-border-soft bg-ink/20">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">commit:</span>
                    <input
                      type="text"
                      value={commitMsg}
                      onChange={(e) => setCommitMsg(e.target.value)}
                      disabled={pushState === "pushing" || pushState === "pushed"}
                      className="flex-1 min-w-[200px] max-w-md bg-surface border border-border px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/50 disabled:opacity-50"
                      placeholder="address review feedback"
                    />
                    <button
                      onClick={handlePush}
                      disabled={pushState === "pushing" || pushState === "pushed"}
                      className={cn(
                        "px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] transition shrink-0",
                        pushState === "pushed" ? "border border-ok/50 bg-ok/10 text-ok" : "border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      {pushState === "pushing" ? "pushing..." : pushState === "pushed" ? "pushed" : "push fix"}
                    </button>
                  </div>
                  {pushMessage && (
                    <div className={cn("mt-2 text-[11px]", pushState === "error" ? "text-alert" : "text-ok")}>{pushMessage}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Fix response renderer ─────────────────────────────────────────────

function FixResponse({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2.5 text-[12px] leading-relaxed text-paper-dim break-words">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          const isDiff = block.lang === "diff" || block.lang === "patch" || block.content.includes("@@");
          return (
            <div key={i} className="overflow-x-auto">
              <div className="flex items-center px-3 py-1 bg-ink/80 border border-border-soft border-b-0 text-[10px] text-paper-muted">
                <span className="font-mono">{block.lang || (isDiff ? "diff" : "code")}</span>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 bg-ink/60 border border-border-soft text-[11px] leading-snug font-mono">
                {block.content.split("\n").map((line, li) => {
                  if (isDiff) {
                    let cls = "text-paper-dim";
                    let bg = "";
                    if (line.startsWith("+") && !line.startsWith("+++")) { cls = "text-ok"; bg = "bg-ok/10"; }
                    else if (line.startsWith("-") && !line.startsWith("---")) { cls = "text-alert"; bg = "bg-alert/10"; }
                    else if (line.startsWith("@@")) { cls = "text-info"; bg = "bg-info/10"; }
                    return <div key={li} className={cn("whitespace-pre-wrap", cls, bg)}>{line || "\u00a0"}</div>;
                  }
                  return <div key={li} className="whitespace-pre-wrap text-paper-dim">{line || "\u00a0"}</div>;
                })}
              </pre>
            </div>
          );
        }
        if (block.type === "heading") return <div key={i} className="text-[13px] text-paper font-medium mt-3 first:mt-0">{block.content}</div>;
        if (block.type === "bullet") return <div key={i} className="flex gap-2 ml-1"><span className="text-paper-faint shrink-0">-</span><span className="break-words min-w-0">{block.content}</span></div>;
        if (!block.content.trim()) return <div key={i} className="h-1" />;
        return <p key={i} className="break-words">{block.content}</p>;
      })}
    </div>
  );
}

type Block = { type: "paragraph" | "heading" | "bullet"; content: string } | { type: "code"; content: string; lang: string };

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
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push({ type: "code", content: code.join("\n"), lang });
      continue;
    }
    if (/^#{1,4}\s/.test(line)) { blocks.push({ type: "heading", content: line.replace(/^#+\s*/, "") }); i++; continue; }
    if (/^\s*[-*]\s/.test(line)) { blocks.push({ type: "bullet", content: line.replace(/^\s*[-*]\s+/, "") }); i++; continue; }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^#{1,4}\s/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push({ type: "paragraph", content: para.join(" ") });
  }
  return blocks;
}

// ── Helpers ───────────────────────────────────────────────────────────

function isQuestion(body: string): boolean {
  const b = body.trim().toLowerCase();
  // Ends with question mark
  if (b.endsWith("?")) return true;
  // Starts with question words
  if (/^(why|how|what|when|where|which|could|can|is|are|do|does|did|would|should|have|has|will)\b/.test(b)) return true;
  // Contains question patterns
  if (/\b(wondering|curious|asking|question|thoughts on|opinion on|reason for|understand why)\b/.test(b)) return true;
  // Mentions asking AI or performance concerns (like the auto-round comment)
  if (/\b(i asked|chatgpt|mentioned that|is it possible|any concern|performance drop|tradeoff)\b/.test(b)) return true;
  return false;
}

function PrSkeleton() {
  return (
    <div className="mt-4 space-y-4 animate-pulse">
      {/* PR header skeleton */}
      <div className="border border-border bg-surface/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-5 w-14 bg-surface-2 rounded" />
          <div className="h-5 w-96 bg-surface-2 rounded" />
        </div>
        <div className="mt-2 flex items-center gap-4">
          <div className="h-3.5 w-64 bg-surface-2 rounded" />
          <div className="h-3.5 w-24 bg-surface-2 rounded" />
        </div>
      </div>

      {/* Comment skeletons */}
      {[1, 2].map((i) => (
        <div key={i} className="border border-border bg-surface/40">
          <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2">
            <div className="h-4 w-20 bg-surface-2 rounded" />
            <div className="h-3 w-32 bg-surface-2 rounded" />
            <div className="ml-auto h-3 w-40 bg-surface-2 rounded" />
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="h-3.5 w-full bg-surface-2 rounded" />
            <div className="h-3.5 w-3/4 bg-surface-2 rounded" />
          </div>
          <div className="px-4 py-2 border-t border-border-soft flex gap-2">
            <div className="h-6 w-20 bg-surface-2 rounded" />
            <div className="h-6 w-20 bg-surface-2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
