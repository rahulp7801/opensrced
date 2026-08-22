"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { useToast } from "@/components/toast";
import { recordContribution } from "@/components/contribution-streaks";
import { cn } from "@/lib/utils";
import { parseSplitHunks, parseUnifiedRows, type UnifiedKind } from "@/lib/diff-view";
import { sseEvents } from "@/lib/sse";
import { parseMarkdownBlocks } from "@/lib/graph-view";

// ── Types ──────────────────────────────────────────────────────────────

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
  step: string; // current step description
};

type PushState = "idle" | "pushing" | "pushed" | "error";

type VerifyCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

type VerifyResult = {
  checks: VerifyCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    verdict: "clean" | "review" | "blocked";
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
  };
} | null;

type ReplyState = {
  commentId: number;
  status: "idle" | "sending" | "sent" | "error";
};

// Track per-comment status
type CommentStatus = "pending" | "fixed" | "replied" | "skipped";

// ── Helpers ────────────────────────────────────────────────────────────

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

function costLabel(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)} — minimal`;
  if (cost < 0.05) return `$${cost.toFixed(4)} — typical`;
  if (cost < 0.15) return `$${cost.toFixed(4)} — moderate`;
  return `$${cost.toFixed(4)} — expensive`;
}

function isQuestion(body: string): boolean {
  const b = body.trim().toLowerCase();
  if (b.endsWith("?")) return true;
  if (/^(why|how|what|when|where|which|could|can|is|are|do|does|did|would|should|have|has|will)\b/.test(b)) return true;
  if (/\b(wondering|curious|asking|question|thoughts on|opinion on|reason for|understand why)\b/.test(b)) return true;
  if (/\b(i asked|chatgpt|mentioned that|is it possible|any concern|performance drop|tradeoff)\b/.test(b)) return true;
  return false;
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────

const SHORTCUTS = [
  { key: "j", label: "next comment" },
  { key: "k", label: "prev comment" },
  { key: "f", label: "fix comment" },
  { key: "r", label: "reply" },
  { key: "d", label: "diff toggle" },
  { key: "Esc", label: "close panels" },
  { key: "?", label: "shortcuts" },
];

// ── Main Component ─────────────────────────────────────────────────────

export default function PrDetailPage() {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const repoFull = `${params.owner}/${params.repo}`;
  const prNumber = params.number;
  const { toast } = useToast();

  // Core state
  const [pr, setPr] = useState<PrInfo | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fix state
  const [fixState, setFixState] = useState<FixState | null>(null);
  const [fixMode, setFixMode] = useState<"quick" | "deep">("quick");
  const [fixRetryCount, setFixRetryCount] = useState(0);
  const [lastFixComment, setLastFixComment] = useState<ReviewComment | null>(null);

  // Auto-explainer
  const [autoExplainer, setAutoExplainer] = useState<string>("");
  const [pushState, setPushState] = useState<PushState>("idle");
  const [pushMessage, setPushMessage] = useState("");
  const [commitMsg, setCommitMsg] = useState("address review feedback");

  // Verification
  const [verifyResult, setVerifyResult] = useState<VerifyResult>(null);
  const [verifying, setVerifying] = useState(false);

  // Ask/chat
  const [askOpen, setAskOpen] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askMessages, setAskMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [askLoading, setAskLoading] = useState(false);

  // Follow-up
  const [followUpComment, setFollowUpComment] = useState("");
  const [followUpGenerating, setFollowUpGenerating] = useState(false);
  const [followUpSent, setFollowUpSent] = useState(false);

  // Replies
  const [replyStates, setReplyStates] = useState<Map<number, ReplyState>>(new Map());
  const [replyTexts, setReplyTexts] = useState<Map<number, string>>(new Map());
  const [showReplyFor, setShowReplyFor] = useState<number | null>(null);

  // Diff viewer
  const [prDiff, setPrDiff] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("unified");
  const [diffPopout, setDiffPopout] = useState(false);

  // Comment status tracking
  const [commentStatuses, setCommentStatuses] = useState<Map<number, CommentStatus>>(new Map());

  // Keyboard nav
  const [focusedComment, setFocusedComment] = useState<number>(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Auto-refresh
  const [newCommentsCount, setNewCommentsCount] = useState(0);
  const lastCommentCount = useRef(0);

  // Session cost tracking
  const [sessionCost, setSessionCost] = useState(0);

  // Refs
  const abortRef = useRef<AbortController | null>(null);
  const fixRef = useRef<HTMLDivElement>(null);
  const commentRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Derived
  const actionableComments = useMemo(
    () => comments.filter((c) => !c.isOwnComment && (c.type === "review" || !c.inReplyTo)),
    [comments],
  );
  const isFixing = fixState?.status === "generating";

  // Summary stats
  const stats = useMemo(() => {
    const pending = actionableComments.filter((c) => (commentStatuses.get(c.id) ?? "pending") === "pending").length;
    const fixed = actionableComments.filter((c) => commentStatuses.get(c.id) === "fixed").length;
    const replied = actionableComments.filter((c) => commentStatuses.get(c.id) === "replied").length;
    return { pending, fixed, replied, total: actionableComments.length };
  }, [actionableComments, commentStatuses]);

  // ── Data loading ───────────────────────────────────────────────────

  const fetchComments = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      const r = await fetch(`/api/prs/review?repo=${encodeURIComponent(repoFull)}&pr=${prNumber}`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      const data: { pr: PrInfo; comments: ReviewComment[] } = await r.json();
      setPr(data.pr);

      if (silent && data.comments.length > lastCommentCount.current) {
        const newCount = data.comments.length - lastCommentCount.current;
        setNewCommentsCount(newCount);
        toast(`${newCount} new comment${newCount > 1 ? "s" : ""} on this PR`, "info");
      }

      setComments(data.comments);
      lastCommentCount.current = data.comments.length;
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [repoFull, prNumber, toast]);

  // Initial load
  useEffect(() => { fetchComments(); }, [fetchComments]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchComments(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  // Scroll to fix output
  useEffect(() => {
    if (fixRef.current && fixState?.response) {
      fixRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [fixState?.response]);

  // Track cost
  useEffect(() => {
    if (fixState?.cost && fixState.status === "done") {
      setSessionCost((prev) => prev + fixState.cost!);
    }
  }, [fixState?.status, fixState?.cost]);

  // Auto-run verification when fix is done
  useEffect(() => {
    if (fixState?.status !== "done") return;
    const diff = extractDiff(fixState.response);
    if (!diff) return;

    setVerifying(true);
    setVerifyResult(null);

    const comment = typeof fixState.commentId === "number"
      ? comments.find((c) => c.id === fixState.commentId)
      : null;

    fetch("/api/prs/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        diff,
        comment_body: comment?.body ?? null,
        file_path: comment?.path ?? null,
        repo: repoFull,
      }),
    })
      .then((r) => r.json())
      .then((data: VerifyResult) => setVerifyResult(data))
      .catch(() => {})
      .finally(() => setVerifying(false));

    // Auto-generate explainer in background
    if (diff && fixState.response.length > 50) {
      generateExplainer(fixState.response);
    }
  }, [fixState?.status, fixState?.response, fixState?.commentId, comments, repoFull]);

  // Generate a "why this fix" explainer
  async function generateExplainer(fixResponse: string) {
    try {
      const res = await fetch("/api/prs/draft-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: `I generated this fix for a PR review comment. Summarize what was changed and why in 2-3 sentences, written as if I'm explaining my own commit to the reviewer. First person, no AI mentions.\n\nFix output:\n${fixResponse.slice(0, 3000)}`,
          comment_author: "me",
        }),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { result?: string };
        if (data.result) setAutoExplainer(data.result);
      } else {
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buf = "", text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const p = JSON.parse(line.slice(6)) as { text?: string };
              if (p.text) { text += p.text; setAutoExplainer(text); }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* non-critical */ }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedComment((prev) => {
            const next = Math.min(prev + 1, actionableComments.length - 1);
            const comment = actionableComments[next];
            if (comment) commentRefs.current.get(comment.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
            return next;
          });
          break;
        case "k":
          e.preventDefault();
          setFocusedComment((prev) => {
            const next = Math.max(prev - 1, 0);
            const comment = actionableComments[next];
            if (comment) commentRefs.current.get(comment.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
            return next;
          });
          break;
        case "f":
          e.preventDefault();
          if (focusedComment >= 0 && focusedComment < actionableComments.length) {
            const c = actionableComments[focusedComment];
            if (!isFixing) handleFix(c);
          }
          break;
        case "r":
          e.preventDefault();
          if (focusedComment >= 0 && focusedComment < actionableComments.length) {
            const c = actionableComments[focusedComment];
            setShowReplyFor(showReplyFor === c.id ? null : c.id);
          }
          break;
        case "d":
          e.preventDefault();
          setShowDiff(!showDiff);
          if (!prDiff) loadDiff();
          break;
        case "Escape":
          setShowReplyFor(null);
          setAskOpen(false);
          setShowShortcuts(false);
          break;
        case "?":
          e.preventDefault();
          setShowShortcuts((prev) => !prev);
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actionableComments, focusedComment, isFixing, showReplyFor, showDiff, prDiff]);

  // ── Lazy-load diff ─────────────────────────────────────────────────

  const loadDiff = useCallback(() => {
    if (prDiff !== null || diffLoading) return;
    setDiffLoading(true);
    fetch(`/api/prs/diff?repo=${encodeURIComponent(repoFull)}&pr=${prNumber}`)
      .then((r) => r.json())
      .then((data: { diff?: string; error?: string }) => setPrDiff(data.diff ?? data.error ?? ""))
      .catch(() => setPrDiff("Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }, [repoFull, prNumber, prDiff, diffLoading]);

  // ── Fix ────────────────────────────────────────────────────────────

  async function handleFix(comment: ReviewComment) {
    setVerifyResult(null);
    setPushState("idle");
    setPushMessage("");
    setFixRetryCount(0);
    setLastFixComment(comment);
    setAutoExplainer("");
    setFixState({
      commentId: comment.id,
      status: "generating",
      response: "",
      tools: [],
      cost: null,
      step: "Connecting to repository...",
    });
    await streamFix(comment.body, comment.path, comment.line, comment.diffHunk);
  }

  // Self-healing retry: re-generate with error context
  async function handleRetryWithContext() {
    if (!lastFixComment || fixRetryCount >= 3) return;
    const prevError = pushMessage || fixState?.response || "Unknown error";
    const verifyErrors = verifyResult?.checks
      ?.filter((c) => c.status === "fail" || c.status === "warn")
      .map((c) => `${c.name}: ${c.detail}`)
      .join("\n") ?? "";

    const retryContext = `\n\nPREVIOUS ATTEMPT FAILED (attempt ${fixRetryCount + 1}/3):\n${prevError.slice(0, 500)}${verifyErrors ? `\n\nVerification issues:\n${verifyErrors}` : ""}\n\nPlease fix the issues above and try a different approach.`;

    setVerifyResult(null);
    setPushState("idle");
    setPushMessage("");
    setFixRetryCount((c) => c + 1);
    setAutoExplainer("");
    setFixState({
      commentId: lastFixComment.id,
      status: "generating",
      response: "",
      tools: [],
      cost: null,
      step: `Retrying (attempt ${fixRetryCount + 2}/3) — analyzing previous failure...`,
    });

    toast(`Retrying fix — attempt ${fixRetryCount + 2}/3`, "signal");
    await streamFix(
      lastFixComment.body + retryContext,
      lastFixComment.path,
      lastFixComment.line,
      lastFixComment.diffHunk,
    );
  }

  async function handleFixAll() {
    if (actionableComments.length === 0) return;

    const combinedComment = actionableComments
      .map((c) => {
        const loc = c.path ? `[${c.path}${c.line ? `:${c.line}` : ""}]` : "";
        return `${loc} ${c.author}: "${c.body}"`;
      })
      .join("\n\n");

    setVerifyResult(null);
    setPushState("idle");
    setPushMessage("");
    setFixState({
      commentId: "all",
      status: "generating",
      response: "",
      tools: [],
      cost: null,
      step: "Analyzing all review comments...",
    });

    await streamFix(
      `Multiple review comments to address:\n\n${combinedComment}`,
      null, null, null,
    );
  }

  function cancelGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setFixState((prev) => prev && prev.status === "generating" ? { ...prev, status: "done", step: "Cancelled" } : prev);
    setAskLoading(false);
    setFollowUpGenerating(false);
    toast("Generation cancelled", "signal");
  }

  async function streamFix(
    commentBody: string,
    filePath: string | null,
    line: number | null,
    diffHunk: string | null,
  ) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/prs/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          repo: repoFull,
          pr_number: parseInt(prNumber),
          branch: pr?.branch,
          comment_body: commentBody,
          file_path: filePath,
          line,
          diff_hunk: diffHunk,
          mode: fixMode,
        }),
      });

      for await (const p of sseEvents<{
        text?: string;
        tool?: string;
        detail?: string;
        cost?: number;
        done?: boolean;
        error?: string;
      }>(res)) {
        if (p.tool) {
          // Update step based on tool being used
          const stepMap: Record<string, string> = {
            read_file: `Reading ${p.detail || "file"}`,
            grep: `Searching for ${p.detail || "pattern"}`,
            find_definition: `Finding definition of ${p.detail || "symbol"}`,
            find_references: `Finding references to ${p.detail || "symbol"}`,
            list_files: `Listing files ${p.detail || ""}`,
            repo_info: "Fetching repository info",
          };
          const step = stepMap[p.tool] || `Running ${p.tool}`;
          setFixState((prev) =>
            prev ? { ...prev, tools: [...prev.tools, { tool: p.tool!, detail: p.detail ?? "" }], step } : prev,
          );
        }
        if (p.text) {
          setFixState((prev) => (prev ? { ...prev, response: prev.response + p.text, step: "Generating fix..." } : prev));
        }
        if (p.cost !== undefined) {
          setFixState((prev) => (prev ? { ...prev, cost: p.cost as number } : prev));
        }
        if (p.done) {
          setFixState((prev) => (prev ? { ...prev, status: "done", step: "Complete" } : prev));
          toast("Fix generated successfully", "ok");
        }
        if (p.error) {
          setFixState((prev) => (prev ? { ...prev, response: p.error!, status: "error", step: "Failed" } : prev));
          toast("Fix generation failed", "alert");
        }
      }

      // A stream that ended while still generating produced nothing. Reporting
      // that as "Complete" was how a 429 or a 500 surfaced: a finished-looking
      // fix with an empty body and no hint that anything went wrong.
      setFixState((prev) => {
        if (!prev || prev.status !== "generating") return prev;
        return prev.response
          ? { ...prev, status: "done", step: "Complete" }
          : { ...prev, status: "error", step: "Failed", response: "The fix stream ended without producing anything." };
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setFixState((prev) =>
        prev ? { ...prev, response: err instanceof Error ? err.message : "Network error", status: "error", step: "Failed" } : prev,
      );
      toast("Fix generation failed — check your connection", "alert");
    }
  }

  // ── Push fix with retry ────────────────────────────────────────────

  async function handlePush(retryCount = 0) {
    if (!fixState?.response || !pr) return;
    const diff = extractDiff(fixState.response);
    if (!diff) {
      setPushState("error");
      setPushMessage("No diff block found in the generated response. Try regenerating the fix.");
      toast("No diff found to push", "alert");
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
      const data = (await res.json()) as { ok?: boolean; commit?: string; message?: string; error?: string; debug?: { diffPreview?: string; strategyErrors?: string[] } };
      if (data.ok) {
        setPushState("pushed");
        setPushMessage(data.message ?? `Pushed commit ${data.commit}`);
        toast(`Pushed commit ${data.commit} to ${pr.branch}`, "ok");
        recordContribution();

        // Mark addressed comments
        if (fixState.commentId === "all") {
          setCommentStatuses((prev) => {
            const next = new Map(prev);
            actionableComments.forEach((c) => next.set(c.id, "fixed"));
            return next;
          });
        } else if (typeof fixState.commentId === "number") {
          setCommentStatuses((prev) => new Map(prev).set(fixState.commentId as number, "fixed"));
        }
      } else {
        // Retry on transient errors
        const isTransient = data.error?.includes("network") || data.error?.includes("timeout") || data.error?.includes("ECONNRESET");
        if (isTransient && retryCount < 2) {
          toast(`Push failed, retrying... (${retryCount + 1}/2)`, "signal");
          await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)));
          return handlePush(retryCount + 1);
        }

        setPushState("error");
        let msg = data.error ?? "Push failed";
        // Friendly error messages
        if (msg.includes("Could not apply")) {
          msg = "Could not apply the diff. The file may have changed since the fix was generated. Try regenerating.";
        } else if (msg.includes("No GitHub token")) {
          msg = "Not authenticated. Please log in and try again.";
        }
        setPushMessage(msg);
        toast("Push failed — see details below", "alert");
      }
    } catch (err) {
      // Network retry
      if (retryCount < 2) {
        toast(`Network error, retrying... (${retryCount + 1}/2)`, "signal");
        await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)));
        return handlePush(retryCount + 1);
      }
      setPushState("error");
      setPushMessage("Network error — check your connection and try again.");
      toast("Push failed — network error", "alert");
    }
  }

  // ── Reply ──────────────────────────────────────────────────────────

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
        setCommentStatuses((prev) => new Map(prev).set(comment.id, "replied"));
        toast("Reply posted successfully", "ok");
      } else {
        setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "error" }));
        toast("Failed to post reply", "alert");
      }
    } catch {
      setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "error" }));
      toast("Network error — reply not sent", "alert");
    }
  }

  // ── Draft reply ────────────────────────────────────────────────────

  async function handleDraftReply(comment: ReviewComment) {
    setFixState({
      commentId: comment.id,
      status: "generating",
      response: "",
      tools: [],
      cost: null,
      step: "Drafting reply...",
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

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { result?: string; error?: string };
        setFixState((prev) => prev ? {
          ...prev,
          response: data.result ?? data.error ?? "",
          status: data.error ? "error" : "done",
          step: data.error ? "Failed" : "Complete",
        } : prev);
      } else {
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
              if (p.done) setFixState((prev) => prev ? { ...prev, status: "done", step: "Complete" } : prev);
              if (p.error) setFixState((prev) => prev ? { ...prev, response: p.error!, status: "error", step: "Failed" } : prev);
            } catch { /* skip */ }
          }
        }
      }

      setFixState((prev) => {
        if (prev && prev.status !== "error") {
          setReplyTexts((rt) => new Map(rt).set(comment.id, prev.response));
          setShowReplyFor(comment.id);
        }
        return prev ? { ...prev, status: "done", step: "Complete" } : prev;
      });
    } catch (err) {
      setFixState((prev) =>
        prev ? { ...prev, response: err instanceof Error ? err.message : "Error", status: "error", step: "Failed" } : prev,
      );
    }
  }

  // ── Follow-up comment ──────────────────────────────────────────────

  async function handleGenerateFollowUp() {
    if (!fixState?.response || followUpGenerating) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFollowUpGenerating(true);
    setFollowUpComment("");

    try {
      const res = await fetch("/api/prs/draft-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: `I just pushed a follow-up commit to this PR. Here is the diff and explanation:\n\n${fixState.response.slice(0, 4000)}\n\nPlease write a detailed but concise PR comment I can post explaining:\n1. What this commit changes and why\n2. The technical reasoning behind the approach\n3. Any caveats or things the reviewer should know\n\nWrite it as if I'm the author explaining my own commit to the reviewer. Use first person. Do not mention AI or automation.`,
          comment_author: "me",
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { result?: string };
        setFollowUpComment(data.result ?? "");
      } else {
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const p = JSON.parse(line.slice(6)) as { text?: string };
              if (p.text) { text += p.text; setFollowUpComment(text); }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setFollowUpComment("Failed to generate comment.");
    } finally {
      setFollowUpGenerating(false);
    }
  }

  async function handleSendFollowUp() {
    if (!followUpComment.trim()) return;
    setFollowUpSent(false);

    try {
      const res = await fetch("/api/prs/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_number: parseInt(prNumber),
          body: followUpComment.trim(),
          type: "issue",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setFollowUpSent(true);
        toast("Follow-up comment posted to PR", "ok");
      } else {
        toast("Failed to post follow-up comment", "alert");
      }
    } catch {
      toast("Network error — comment not sent", "alert");
    }
  }

  // ── Ask about change ───────────────────────────────────────────────

  async function handleAsk() {
    if (!askInput.trim() || !fixState?.response || askLoading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const question = askInput.trim();
    setAskInput("");
    setAskMessages((prev) => [...prev, { role: "user", text: question }]);
    setAskLoading(true);

    try {
      const res = await fetch("/api/prs/draft-reply", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: `Context — I generated this fix:\n\n${fixState.response.slice(0, 3000)}\n\nMy question: ${question}`,
          comment_author: "me",
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { result?: string; error?: string };
        setAskMessages((prev) => [...prev, { role: "ai", text: data.result ?? data.error ?? "No response" }]);
      } else {
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        let aiText = "";
        setAskMessages((prev) => [...prev, { role: "ai", text: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const p = JSON.parse(line.slice(6)) as { text?: string };
              if (p.text) {
                aiText += p.text;
                setAskMessages((prev) => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { role: "ai", text: aiText };
                  return copy;
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      setAskMessages((prev) => [...prev, { role: "ai", text: `Error: ${err instanceof Error ? err.message : "failed"}` }]);
    } finally {
      setAskLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[11px] text-paper-muted mb-3">
        <Link href="/prs" className="hover:text-signal transition-colors">PRs</Link>
        <span className="text-paper-faint">/</span>
        <span className="text-paper-dim">{params.owner}/{params.repo}</span>
        <span className="text-paper-faint">/</span>
        <span className="text-paper">#{prNumber}</span>
      </nav>

      <PageHeading
        title={<>PR #{prNumber}</>}
        description={`Review and respond to feedback on ${repoFull}#${prNumber}`}
      />

      {/* Session cost + keyboard shortcut hint */}
      <div className="flex items-center justify-between mt-1 mb-2">
        {sessionCost > 0 && (
          <span className="text-[10px] text-paper-faint tabular-nums">
            Session total: ${sessionCost.toFixed(4)}
          </span>
        )}
        <button
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="text-[10px] text-paper-faint hover:text-paper-muted transition-colors ml-auto"
        >
          ? shortcuts
        </button>
      </div>

      {/* Shortcuts overlay */}
      {showShortcuts && (
        <div className="mb-3 border border-border bg-ink/80 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-paper-muted">Keyboard shortcuts</span>
            <button onClick={() => setShowShortcuts(false)} className="text-[10px] text-paper-faint hover:text-paper-muted">close</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
            {SHORTCUTS.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-[11px]">
                <kbd className="bg-surface border border-border px-1.5 py-0.5 text-[10px] text-paper font-mono min-w-[24px] text-center">{s.key}</kbd>
                <span className="text-paper-dim">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <PrSkeleton />}
      {error && (
        <div className="mt-8 border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchComments()} className="text-[10px] border border-alert/30 px-2 py-0.5 hover:bg-alert/10 transition">
            retry
          </button>
        </div>
      )}

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
              {showDiff && prDiff && (
                <button
                  onClick={() => setDiffViewMode(diffViewMode === "unified" ? "split" : "unified")}
                  className="text-paper-faint hover:text-paper-dim transition-colors text-[10px]"
                >
                  {diffViewMode === "unified" ? "split view" : "unified view"}
                </button>
              )}
              <button
                onClick={() => { fetchComments(true); toast("Refreshing comments...", "info"); }}
                className="text-paper-dim hover:text-signal transition-colors"
              >
                refresh
              </button>
              {newCommentsCount > 0 && (
                <span className="text-[10px] text-signal animate-pulse-signal">
                  {newCommentsCount} new
                </span>
              )}
            </div>
          </div>

          {/* Collapsible PR diff */}
          {showDiff && (
            <div className="border border-border border-t-0 bg-ink/30 max-h-[500px] overflow-auto">
              {diffLoading ? (
                <div className="px-4 py-3 text-[11px] text-paper-muted animate-pulse-signal">Loading diff...</div>
              ) : prDiff ? (
                diffViewMode === "split" ? (
                  <SplitDiffView diff={prDiff} />
                ) : (
                  <pre className="px-4 py-3 text-[10.5px] font-mono leading-snug">
                    <DiffLines diff={prDiff} />
                  </pre>
                )
              ) : (
                <div className="px-4 py-3 text-[11px] text-paper-muted">No diff available</div>
              )}
            </div>
          )}

          {/* Comment status bar */}
          {stats.total > 0 && (
            <div className="mt-4 flex items-center gap-4 text-[11px] flex-wrap">
              <span className="text-paper-muted">
                <span className="tabular-nums text-paper">{stats.total}</span> review comment{stats.total !== 1 ? "s" : ""}
              </span>
              {stats.pending > 0 && (
                <span className="text-signal">
                  <span className="tabular-nums">{stats.pending}</span> pending
                </span>
              )}
              {stats.fixed > 0 && (
                <span className="text-ok">
                  <span className="tabular-nums">{stats.fixed}</span> fixed
                </span>
              )}
              {stats.replied > 0 && (
                <span className="text-info">
                  <span className="tabular-nums">{stats.replied}</span> replied
                </span>
              )}
              {stats.pending === 0 && stats.total > 0 && (
                <span className="text-ok text-[10px] border border-ok/30 px-1.5 py-0.5">all addressed</span>
              )}
            </div>
          )}

          {/* Action bar */}
          {actionableComments.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                {actionableComments.length > 1 && (
                  <button
                    onClick={handleFixAll}
                    disabled={isFixing}
                    className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {isFixing && fixState?.commentId === "all" ? "generating fixes..." : `fix all ${actionableComments.length} comments`}
                  </button>
                )}
              </div>
              {/* Fix mode selector */}
              <div className="flex items-start gap-3 border border-border bg-ink/20 px-3 py-2">
                <div className="flex items-center gap-0.5 border border-border shrink-0">
                  <button
                    onClick={() => setFixMode("quick")}
                    className={cn(
                      "px-2.5 py-1 text-[10px] transition",
                      fixMode === "quick" ? "bg-ok/15 text-ok" : "text-paper-faint hover:text-paper-muted",
                    )}
                  >
                    quick
                  </button>
                  <button
                    onClick={() => setFixMode("deep")}
                    className={cn(
                      "px-2.5 py-1 text-[10px] transition",
                      fixMode === "deep" ? "bg-signal/15 text-signal" : "text-paper-faint hover:text-paper-muted",
                    )}
                  >
                    deep
                  </button>
                </div>
                <div className="text-[10px] leading-relaxed">
                  {fixMode === "quick" ? (
                    <div>
                      <span className="text-ok font-medium">Quick fix</span>
                      <span className="text-paper-faint"> — reads the file from repo cache + greps for related symbols, sends to Haiku. </span>
                      <span className="text-ok tabular-nums">~$0.001</span>
                      <span className="text-paper-faint"> per fix. </span>
                      <span className="text-paper-dim">Recommended for single-file, straightforward comments.</span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-signal font-medium">Deep fix</span>
                      <span className="text-paper-faint"> — spawns Sonnet with full MCP tool access (read_file, grep, find_definition, find_references). Explores the codebase autonomously. </span>
                      <span className="text-signal tabular-nums">~$0.05–0.15</span>
                      <span className="text-paper-faint"> per fix. </span>
                      <span className="text-paper-dim">Use for multi-file changes, complex logic, or when quick fix misses context.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Review comments */}
          <div className="mt-4 space-y-3">
            {comments.length === 0 && (
              <div className="border border-border bg-surface/40 px-4 py-6 text-center text-[12px] text-paper-muted">
                No review comments from maintainers yet.
              </div>
            )}

            {comments.map((c, idx) => {
              const replySt = replyStates.get(c.id);
              const status = commentStatuses.get(c.id) ?? "pending";
              const isFocused = actionableComments[focusedComment]?.id === c.id;

              return (
                <div
                  key={c.id}
                  ref={(el) => { if (el) commentRefs.current.set(c.id, el); }}
                  className={cn(
                    "border bg-surface/40 transition-all",
                    c.isOwnComment ? "border-border-soft opacity-60" : "border-border",
                    isFocused && "ring-1 ring-signal/50 border-signal/30",
                    status === "fixed" && "border-l-2 border-l-ok",
                    status === "replied" && "border-l-2 border-l-info",
                  )}
                >
                  {/* Comment header */}
                  <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-paper font-medium">{c.author}</span>
                    {c.isOwnComment && <span className="text-[9px] text-paper-faint border border-border px-1 py-0.5">you</span>}
                    <span className="text-[10px] text-paper-faint">
                      {new Date(c.createdAt).toLocaleDateString()} {new Date(c.createdAt).toLocaleTimeString()}
                    </span>
                    {/* Status indicator */}
                    {!c.isOwnComment && status !== "pending" && (
                      <span className={cn(
                        "text-[9px] uppercase tracking-[0.1em] px-1 py-0.5 border",
                        status === "fixed" ? "text-ok border-ok/30" : "text-info border-info/30",
                      )}>
                        {status}
                      </span>
                    )}
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

                  {/* Action buttons */}
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
                          <span className="text-[10px] text-paper-faint">question — AI will draft a reply</span>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleFix(c)}
                            disabled={isFixing}
                            className={cn(
                              "text-[11px] px-3 py-1 transition disabled:opacity-50 border",
                              fixMode === "quick"
                                ? "text-ok border-ok/40 hover:bg-ok/10"
                                : "text-signal border-signal/40 hover:bg-signal/10",
                            )}
                          >
                            {fixState?.commentId === c.id && isFixing ? "generating..." : fixMode === "quick" ? "quick fix" : "deep fix"}
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
                      {replySt?.status === "error" && (
                        <span className="text-[10px] text-alert">failed to reply</span>
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
                        <div className="flex flex-col gap-1 self-end">
                          <button
                            onClick={() => handleReply(c)}
                            disabled={!replyTexts.get(c.id)?.trim() || replySt?.status === "sending"}
                            className="border border-info/50 bg-info/10 text-info hover:bg-info/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] disabled:opacity-50 shrink-0 transition"
                          >
                            {replySt?.status === "sending" ? "..." : "send"}
                          </button>
                          <button
                            onClick={() => setShowReplyFor(null)}
                            className="text-[10px] text-paper-faint hover:text-paper-muted transition"
                          >
                            cancel
                          </button>
                        </div>
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
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-paper-dim">{fixState.step}</span>
                    <span className="text-[10px] text-signal animate-pulse-signal">
                      <LoadingDots />
                    </span>
                    <button onClick={cancelGeneration} className="text-[10px] text-paper-muted hover:text-alert transition border border-border px-1.5 py-0.5">cancel</button>
                  </span>
                )}
                {fixState.status === "done" && fixState.cost !== null && (
                  <span className="ml-auto text-[10px] text-paper-muted tabular-nums">{costLabel(fixState.cost)}</span>
                )}
                {fixState.status === "error" && (
                  <span className="ml-auto text-[10px] text-alert">failed</span>
                )}
              </div>

              {/* Live agent activity timeline */}
              {fixState.tools.length > 0 && (
                <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-[9px] uppercase tracking-[0.15em] text-paper-faint">Agent activity</span>
                    <span className="text-[9px] text-paper-faint tabular-nums">{fixState.tools.length} tool calls</span>
                    {fixState.status === "generating" && <span className="text-[9px] text-signal animate-pulse-signal ml-1">live</span>}
                  </div>
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border-soft" />
                    <div className="space-y-0.5">
                      {fixState.tools.map((t, i) => {
                        const iconMap: Record<string, string> = {
                          grep: "/", read_file: "#", find_definition: "@",
                          find_references: "&", list_files: "~", repo_info: "i",
                        };
                        const colorMap: Record<string, string> = {
                          grep: "text-signal", read_file: "text-info",
                          find_definition: "text-ok", find_references: "text-ok",
                          list_files: "text-paper-muted", repo_info: "text-paper-muted",
                        };
                        const isLast = i === fixState.tools.length - 1 && fixState.status === "generating";
                        return (
                          <div key={i} className={cn(
                            "flex items-center gap-2 pl-3 text-[10px]",
                            isLast && "font-medium",
                          )}>
                            <span className={cn(
                              "relative z-10 shrink-0 w-3 h-3 flex items-center justify-center text-[8px] font-mono rounded-full border",
                              isLast ? "bg-signal/20 border-signal/50 text-signal" : "bg-ink border-border-soft",
                              colorMap[t.tool] ?? "text-paper-faint",
                            )}>
                              {iconMap[t.tool] ?? "."}
                            </span>
                            <span className={cn(colorMap[t.tool] ?? "text-paper-faint", isLast && "text-paper")}>
                              {t.tool.replace(/_/g, " ")}
                            </span>
                            {t.detail && (
                              <span className="text-paper-dim font-mono truncate max-w-[300px]">{t.detail}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Response */}
              <div className="px-4 py-4 overflow-x-auto">
                {fixState.status === "error" ? (
                  <div className="text-[11px] text-alert whitespace-pre-wrap break-words">
                    <p className="font-medium mb-1">Generation failed {fixRetryCount > 0 ? `(attempt ${fixRetryCount + 1}/3)` : ""}</p>
                    <p className="text-paper-muted">{fixState.response}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (fixState.commentId === "all") handleFixAll();
                          else {
                            const c = comments.find((c) => c.id === fixState.commentId);
                            if (c) handleFix(c);
                          }
                        }}
                        className="text-[10px] text-signal border border-signal/30 px-2 py-0.5 hover:bg-signal/10 transition"
                      >
                        retry from scratch
                      </button>
                      {fixRetryCount < 3 && lastFixComment && (
                        <button
                          onClick={handleRetryWithContext}
                          className="text-[10px] text-ok border border-ok/30 px-2 py-0.5 hover:bg-ok/10 transition"
                        >
                          self-heal (retry with error context)
                        </button>
                      )}
                      {fixRetryCount >= 3 && (
                        <span className="text-[10px] text-paper-faint">Max retries reached — try deep fix mode or fix manually</span>
                      )}
                    </div>
                  </div>
                ) : fixState.response ? (
                  <FixResponse text={fixState.response} />
                ) : (
                  <div className="flex items-center gap-2 text-[11px] text-paper-muted">
                    <LoadingDots />
                    <span>{fixState.step}</span>
                  </div>
                )}
              </div>

              {/* Diff preview before push */}
              {fixState.status === "done" && extractDiff(fixState.response) && (
                <DiffPreview diff={extractDiff(fixState.response)!} />
              )}

              {/* Export buttons */}
              {fixState.status === "done" && extractDiff(fixState.response) && (
                <div className="px-4 py-2 border-t border-border-soft flex items-center gap-2">
                  <span className="text-[10px] text-paper-faint uppercase tracking-[0.15em]">export</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(extractDiff(fixState.response)!);
                      toast("Diff copied to clipboard", "ok");
                    }}
                    className="text-[10px] text-paper-dim border border-border hover:border-paper-muted hover:text-paper px-2 py-0.5 transition"
                  >
                    copy diff
                  </button>
                  <button
                    onClick={() => {
                      const diff = extractDiff(fixState.response)!;
                      const blob = new Blob([diff], { type: "text/x-patch" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `fix-${repoFull.replace("/", "-")}-${prNumber}.patch`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast("Patch file downloaded", "ok");
                    }}
                    className="text-[10px] text-paper-dim border border-border hover:border-paper-muted hover:text-paper px-2 py-0.5 transition"
                  >
                    download .patch
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(fixState.response);
                      toast("Full response copied", "ok");
                    }}
                    className="text-[10px] text-paper-faint border border-border hover:border-paper-muted hover:text-paper-dim px-2 py-0.5 transition"
                  >
                    copy full response
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const diff = extractDiff(fixState.response);
                        const comment = typeof fixState.commentId === "number"
                          ? comments.find((c) => c.id === fixState.commentId) : null;
                        const res = await fetch("/api/fixes", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            repo: repoFull,
                            pr_number: parseInt(prNumber),
                            comment_body: comment?.body,
                            fix_response: fixState.response,
                            diff,
                            explainer: autoExplainer || null,
                          }),
                        });
                        const data = await res.json();
                        if (data.url) {
                          navigator.clipboard.writeText(window.location.origin + data.url);
                          toast("Share link copied to clipboard", "ok");
                        }
                      } catch { toast("Failed to create share link", "alert"); }
                    }}
                    className="text-[10px] text-signal border border-signal/30 hover:bg-signal/10 px-2 py-0.5 transition"
                  >
                    share fix
                  </button>
                </div>
              )}

              {/* Verification results */}
              {fixState.status === "done" && extractDiff(fixState.response) && (
                <div className="px-4 py-3 border-t border-border-soft">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-paper-muted">
                      verification checks
                    </span>
                    {verifying && (
                      <span className="text-[10px] text-signal animate-pulse-signal flex items-center gap-1">
                        <LoadingDots /> running checks...
                      </span>
                    )}
                    {verifyResult && (
                      <span className={cn(
                        "text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 border",
                        verifyResult.summary.verdict === "clean" ? "text-ok border-ok/30" :
                        verifyResult.summary.verdict === "review" ? "text-signal border-signal/30" :
                        "text-alert border-alert/30",
                      )}>
                        {verifyResult.summary.verdict === "clean" ? "all clear" :
                         verifyResult.summary.verdict === "review" ? "review needed" : "blocked"}
                      </span>
                    )}
                  </div>

                  {verifyResult && (
                    <div className="space-y-1">
                      {verifyResult.checks.map((check, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <span className={cn(
                            "shrink-0 w-4 text-center font-mono",
                            check.status === "pass" ? "text-ok" :
                            check.status === "warn" ? "text-signal" : "text-alert",
                          )}>
                            {check.status === "pass" ? "+" : check.status === "warn" ? "!" : "x"}
                          </span>
                          <span className={cn(
                            "font-medium w-28 shrink-0",
                            check.status === "pass" ? "text-paper-dim" :
                            check.status === "warn" ? "text-signal" : "text-alert",
                          )}>
                            {check.name}
                          </span>
                          <span className="text-paper-muted break-words min-w-0">
                            {check.detail}
                          </span>
                        </div>
                      ))}
                      <div className="mt-2 pt-2 border-t border-border-soft text-[10px] text-paper-faint">
                        +{verifyResult.summary.linesAdded} / -{verifyResult.summary.linesRemoved} lines | {verifyResult.summary.filesChanged} file(s) | {verifyResult.summary.pass} passed, {verifyResult.summary.warn} warnings, {verifyResult.summary.fail} failed
                      </div>
                      {verifyResult.summary.fail > 0 && fixRetryCount < 3 && lastFixComment && (
                        <div className="mt-2 pt-2 border-t border-border-soft">
                          <button
                            onClick={handleRetryWithContext}
                            className="text-[10px] text-ok border border-ok/30 px-2.5 py-1 hover:bg-ok/10 transition"
                          >
                            Self-heal: retry fix using these verification results as context
                          </button>
                          <span className="ml-2 text-[10px] text-paper-faint">Attempt {fixRetryCount + 1}/3</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Ask about this change */}
              {fixState.status === "done" && fixState.response && (
                <div className="px-4 py-2 border-t border-border-soft">
                  <button
                    onClick={() => { setAskOpen(!askOpen); if (!askOpen && askMessages.length === 0) setAskMessages([]); }}
                    className="text-[11px] text-info border border-info/30 hover:bg-info/10 px-3 py-1 transition"
                  >
                    {askOpen ? "close chat" : "ask about this change"}
                  </button>
                  <span className="ml-2 text-[10px] text-paper-faint">
                    Ask Claude to explain the reasoning, potential risks, or alternatives
                  </span>

                  {askOpen && (
                    <div className="mt-3 border border-border bg-ink/30 max-h-[300px] flex flex-col">
                      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[80px]">
                        {askMessages.length === 0 && (
                          <div className="text-[10px] text-paper-faint italic">
                            Ask anything about the generated fix — why it chose this approach, what could go wrong, alternative approaches, etc.
                          </div>
                        )}
                        {askMessages.map((msg, i) => (
                          <div key={i} className={cn("text-[11px]", msg.role === "user" ? "text-paper" : "text-paper-dim")}>
                            <span className={cn(
                              "text-[9px] uppercase tracking-[0.1em] mr-1.5",
                              msg.role === "user" ? "text-signal" : "text-info",
                            )}>
                              {msg.role === "user" ? "you" : "ai"}
                            </span>
                            <span className="whitespace-pre-wrap break-words">{msg.text}</span>
                          </div>
                        ))}
                        {askLoading && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-info animate-pulse-signal">thinking...</span>
                            <button onClick={cancelGeneration} className="text-[10px] text-paper-muted hover:text-alert transition">cancel</button>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-border-soft p-2 flex gap-2">
                        <input
                          type="text"
                          value={askInput}
                          onChange={(e) => setAskInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                          placeholder="Why did you make this change?"
                          disabled={askLoading}
                          className="flex-1 bg-surface border border-border px-2.5 py-1.5 text-[11px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-info/50 disabled:opacity-50"
                        />
                        <button
                          onClick={handleAsk}
                          disabled={!askInput.trim() || askLoading}
                          className="border border-info/50 bg-info/10 text-info hover:bg-info/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] disabled:opacity-50 shrink-0 transition"
                        >
                          ask
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                      onClick={() => handlePush()}
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
                    <div className={cn(
                      "mt-2 text-[11px] p-2 border",
                      pushState === "error" ? "text-alert bg-alert/5 border-alert/20" : "text-ok bg-ok/5 border-ok/20",
                    )}>
                      {pushState === "error" && (
                        <div className="flex items-start justify-between gap-2">
                          <span className="whitespace-pre-wrap break-words">{pushMessage}</span>
                          <button
                            onClick={() => handlePush()}
                            className="shrink-0 text-[10px] text-signal border border-signal/30 px-2 py-0.5 hover:bg-signal/10 transition"
                          >
                            retry
                          </button>
                        </div>
                      )}
                      {pushState !== "error" && pushMessage}
                    </div>
                  )}

                  {/* Follow-up comment — auto-populated with explainer */}
                  <div className="mt-3 pt-3 border-t border-border-soft">
                    {autoExplainer && !followUpComment && (
                      <div className="mb-2 px-3 py-2 border border-ok/20 bg-ok/5 text-[11px] text-paper-dim">
                        <span className="text-[9px] text-ok uppercase tracking-[0.1em] block mb-1">auto-generated explanation</span>
                        <p className="whitespace-pre-wrap">{autoExplainer}</p>
                        <button
                          onClick={() => { setFollowUpComment(autoExplainer); }}
                          className="mt-1.5 text-[10px] text-ok border border-ok/30 px-2 py-0.5 hover:bg-ok/10 transition"
                        >
                          use as follow-up comment
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">
                        follow-up comment
                      </span>
                      <button
                        onClick={handleGenerateFollowUp}
                        disabled={followUpGenerating || followUpSent}
                        className="text-[10px] text-info border border-info/30 hover:bg-info/10 px-2 py-0.5 transition disabled:opacity-50"
                      >
                        {followUpGenerating ? "drafting..." : followUpComment ? "regenerate" : "draft detailed version"}
                      </button>
                      {followUpGenerating && (
                        <button onClick={cancelGeneration} className="text-[10px] text-paper-muted hover:text-alert transition">cancel</button>
                      )}
                      <span className="text-[9px] text-paper-faint">
                        Explains the commit reasoning to the reviewer
                      </span>
                    </div>

                    {(followUpComment || followUpGenerating) && (
                      <>
                        <textarea
                          value={followUpComment}
                          onChange={(e) => setFollowUpComment(e.target.value)}
                          disabled={followUpGenerating || followUpSent}
                          rows={5}
                          className="w-full bg-surface border border-border px-3 py-2 text-[12px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-info/50 disabled:opacity-50 resize-y"
                          placeholder="Generating comment..."
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={handleSendFollowUp}
                            disabled={!followUpComment.trim() || followUpGenerating || followUpSent}
                            className={cn(
                              "px-3 py-1 text-[10px] uppercase tracking-[0.12em] transition",
                              followUpSent
                                ? "border border-ok/50 bg-ok/10 text-ok"
                                : "border border-info/50 bg-info/10 text-info hover:bg-info/20",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                            )}
                          >
                            {followUpSent ? "sent" : "post comment to PR"}
                          </button>
                          <span className="text-[9px] text-paper-faint">
                            {followUpSent ? "Comment posted on GitHub" : "Posts as a comment on the PR thread"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Split diff view ──────────────────────────────────────────────────

// Colours for one line of an inline diff. Shared by the three places that
// render one, each of which used to classify by prefix and so greyed out a
// real deletion whose text began with "--" as though it were a file header.
const DIFF_LINE_CLASS: Record<UnifiedKind, string> = {
  add: "text-ok bg-ok/5",
  del: "text-alert bg-alert/5",
  hunk: "text-info bg-info/5",
  meta: "text-paper-faint",
  context: "text-paper-dim",
};

// A fix response renders its diff on a darker ground, so the tints are heavier.
const DIFF_LINE_CLASS_STRONG: Record<UnifiedKind, string> = {
  ...DIFF_LINE_CLASS,
  add: "text-ok bg-ok/10",
  del: "text-alert bg-alert/10",
  hunk: "text-info bg-info/10",
};

function DiffLines({ diff, strong }: { diff: string; strong?: boolean }) {
  const rows = useMemo(() => parseUnifiedRows(diff), [diff]);
  const map = strong ? DIFF_LINE_CLASS_STRONG : DIFF_LINE_CLASS;
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className={cn("whitespace-pre-wrap", map[row.kind])}>
          {row.text || "\u00a0"}
        </div>
      ))}
    </>
  );
}

function SplitDiffView({ diff }: { diff: string }) {
  // Parsing lives in lib/diff-view.ts, shared with the runs view. It is the
  // part that can be silently wrong — two panes drifting out of step still
  // render perfectly while describing a change that did not happen — so it is
  // tested there rather than reimplemented here. This copy used to treat any
  // line starting with "---" or "+++" as a file header, which swallowed the
  // deletion of a line like `-- note` and the addition of `++i;`.
  const hunks = useMemo(() => parseSplitHunks(diff), [diff]);

  return (
    <div className="grid grid-cols-2 text-[10.5px] font-mono leading-snug">
      {hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>
          <div className="col-span-2 px-3 py-px text-paper-faint bg-ink/50">
            {hunk.file === hunks[hi - 1]?.file ? "\u22ef" : hunk.file}
          </div>
          {hunk.before.map((left, i) => {
            const right = hunk.after[i];
            const changed = left !== right;
            return (
              <React.Fragment key={i}>
                <div
                  className={cn(
                    "px-3 py-px whitespace-pre-wrap border-r border-border-soft",
                    left === null
                      ? "bg-ink/40"
                      : changed
                        ? "text-alert bg-alert/5"
                        : "text-paper-dim",
                  )}
                >
                  {left ?? "\u00a0"}
                </div>
                <div
                  className={cn(
                    "px-3 py-px whitespace-pre-wrap",
                    right === null
                      ? "bg-ink/40"
                      : changed
                        ? "text-ok bg-ok/5"
                        : "text-paper-dim",
                  )}
                >
                  {right ?? "\u00a0"}
                </div>
              </React.Fragment>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Diff preview component ───────────────────────────────────────────

function DiffPreview({ diff }: { diff: string }) {
  const [expanded, setExpanded] = useState(false);
  const [poppedOut, setPoppedOut] = useState(false);

  // Parse files from the diff
  const files = diff.match(/^\+\+\+ (?:b\/)?(\S+)/gm)?.map((l) => l.replace(/^\+\+\+ (?:b\/)?/, "")) ?? [];
  const added = (diff.match(/^\+[^+]/gm) || []).length;
  const removed = (diff.match(/^-[^-]/gm) || []).length;

  const diffContent = (
    <>
      <div className="px-3 py-1.5 border-b border-border-soft bg-ink/50 text-[10px] text-paper-faint flex items-center justify-between">
        <div>
          {files.map((f, i) => (
            <span key={i} className="mr-3 font-mono">{f}</span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ok tabular-nums">+{added}</span>
          <span className="text-alert tabular-nums">-{removed}</span>
        </div>
      </div>
      <pre className="px-3 py-2 text-[10.5px] font-mono leading-snug">
        <DiffLines diff={diff} />
      </pre>
    </>
  );

  return (
    <>
      <div className="px-4 py-2 border-t border-border-soft">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-[10px] text-paper-muted hover:text-paper-dim transition"
          >
            <span className="uppercase tracking-[0.15em]">diff preview</span>
            <span className="text-ok tabular-nums">+{added}</span>
            <span className="text-alert tabular-nums">-{removed}</span>
            <span className="text-paper-faint">{files.length} file{files.length !== 1 ? "s" : ""}</span>
            <span className="text-paper-faint">{expanded ? "collapse" : "expand"}</span>
          </button>
          <button
            onClick={() => setPoppedOut(true)}
            className="text-[10px] text-paper-faint hover:text-info transition ml-2"
            title="Open in floating panel"
          >
            pop out
          </button>
        </div>

        {expanded && !poppedOut && (
          <div className="mt-2 border border-border bg-ink/30 max-h-[400px] overflow-auto">
            {diffContent}
          </div>
        )}
      </div>

      {/* Pop-out floating panel */}
      {poppedOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm" onClick={() => setPoppedOut(false)}>
          <div
            className="bg-ink border border-border shadow-2xl w-[90vw] max-w-[900px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 border-b border-border-soft flex items-center justify-between shrink-0">
              <span className="text-[11px] text-paper-muted uppercase tracking-[0.15em]">diff preview</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(diff);
                  }}
                  className="text-[10px] text-paper-faint hover:text-paper-muted transition"
                >
                  copy
                </button>
                <button
                  onClick={() => setPoppedOut(false)}
                  className="text-[10px] text-paper-faint hover:text-alert transition"
                >
                  close (esc)
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1">
              {diffContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Loading dots animation ───────────────────────────────────────────

function LoadingDots() {
  return (
    <span className="inline-flex gap-px">
      <span className="animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }}>.</span>
      <span className="animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1s" }}>.</span>
      <span className="animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1s" }}>.</span>
    </span>
  );
}

// ── Fix response renderer ────────────────────────────────────────────

function FixResponse({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
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
                {isDiff ? (
                  <DiffLines diff={block.content} strong />
                ) : (
                  block.content.split("\n").map((line, li) => (
                    <div key={li} className="whitespace-pre-wrap text-paper-dim">
                      {line || "\u00a0"}
                    </div>
                  ))
                )}
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


// ── Skeleton ─────────────────────────────────────────────────────────

function PrSkeleton() {
  return (
    <div className="mt-4 space-y-4 animate-pulse">
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
