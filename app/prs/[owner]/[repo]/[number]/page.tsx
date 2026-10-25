"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PrFollowups } from "@/components/pr-followups";
import { NextSteps } from "@/components/next-steps";
import { ChangeChat, STARTER_QUESTIONS } from "@/components/change-chat";
import { Term } from "@/components/term";
import { readJson, requestErrorMessage } from "@/lib/fetch-json";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { parseSplitHunks, parseUnifiedRows, type UnifiedKind } from "@/lib/diff-view";
import { sseEvents, readTextResponse } from "@/lib/sse";
import { parseMarkdownBlocks } from "@/lib/graph-view";
import { copyText } from "@/lib/clipboard";
import { commentDisclosure } from "@/lib/disclosure";
import { CLAUDE_FAST_MODEL } from "@/lib/models";

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
  headRepo: string | null;
  base: string;
  author: string;
  /** The PR description (capped by the server); absent from older responses. */
  body?: string;
};

type FixState = {
  commentId: number | "all";
  status: "generating" | "done" | "error" | "cancelled";
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
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Follow-up
  const [followUpComment, setFollowUpComment] = useState("");
  const [followUpGenerating, setFollowUpGenerating] = useState(false);
  const [followUpSent, setFollowUpSent] = useState(false);
  const [followUpSending, setFollowUpSending] = useState(false);
  const pendingReplies = useRef(new Set<number | "follow-up">());

  // Replies
  const [replyStates, setReplyStates] = useState<Map<number, ReplyState>>(new Map());
  const [replyTexts, setReplyTexts] = useState<Map<number, string>>(new Map());
  const [showReplyFor, setShowReplyFor] = useState<number | null>(null);

  // Diff viewer
  const [prDiff, setPrDiff] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const diffRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setPrDiff(null);
    setDiffError("");
    setDiffLoading(false);
    setShowDiff(false);
    return () => { diffRequest.current?.abort(); diffRequest.current = null; };
  }, [repoFull, prNumber]);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("unified");

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
  const commentsAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); commentsAbort.current?.abort(); }, [repoFull, prNumber]);
  const fixRef = useRef<HTMLDivElement>(null);
  // One share request at a time: each click would otherwise create another share record.
  const sharing = useRef(false);
  const commentRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Derived
  const actionableComments = useMemo(
    () => comments.filter((c) => !c.isOwnComment && (c.type === "review" || !c.inReplyTo)),
    [comments],
  );
  const isFixing = fixState?.status === "generating";
  const writesPending = pushState === "pushing" || followUpSending;

  // Summary stats
  const stats = useMemo(() => {
    const pending = actionableComments.filter((c) => (commentStatuses.get(c.id) ?? "pending") === "pending").length;
    const fixed = actionableComments.filter((c) => commentStatuses.get(c.id) === "fixed").length;
    const replied = actionableComments.filter((c) => commentStatuses.get(c.id) === "replied").length;
    return { pending, fixed, replied, total: actionableComments.length };
  }, [actionableComments, commentStatuses]);

  // ── Data loading ───────────────────────────────────────────────────

  const fetchComments = useCallback(async (silent = false) => {
    commentsAbort.current?.abort();
    const controller = new AbortController();
    commentsAbort.current = controller;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const r = await fetch(`/api/prs/review?repo=${encodeURIComponent(repoFull)}&pr=${prNumber}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      const data = await readJson<{ pr: PrInfo; comments: ReviewComment[] }>(r);
      // A wrong shape is a server fault to report, not something to render blank.
      if (!data || typeof data.pr !== "object" || data.pr === null || !Array.isArray(data.comments)) {
        throw new Error("The server returned an invalid response. Please try again.");
      }
      if (controller.signal.aborted) return;
      setPr(data.pr);

      if (silent && data.comments.length > lastCommentCount.current) {
        const newCount = data.comments.length - lastCommentCount.current;
        setNewCommentsCount(newCount);
        toast(`${newCount} new comment${newCount > 1 ? "s" : ""} on this PR`, "info");
      }

      setComments(data.comments);
      lastCommentCount.current = data.comments.length;
    } catch (err) {
      if (!silent && !controller.signal.aborted) setError(requestErrorMessage(err));
    } finally {
      if (!silent && !controller.signal.aborted) setLoading(false);
    }
  }, [repoFull, prNumber, toast]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick(silent = false) {
      await fetchComments(silent);
      if (!stopped) timer = setTimeout(() => tick(true), 30_000);
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); commentsAbort.current?.abort(); };
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

  const fixComment = typeof fixState?.commentId === "number" ? comments.find(c => c.id === fixState.commentId) : null;
  const fixCommentBody = fixComment?.body ?? null;
  const fixCommentPath = fixComment?.path ?? null;

  useEffect(() => {
    if (fixState?.status !== "done") return;
    const diff = extractDiff(fixState.response);
    if (!diff) return;
    const controller = new AbortController();
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);
    fetch("/api/prs/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      body: JSON.stringify({ diff, comment_body: fixCommentBody, file_path: fixCommentPath, repo: repoFull }),
    }).then(async response => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.checks) || !data.summary) throw new Error(data.error ?? "Verification unavailable.");
      if (!controller.signal.aborted) setVerifyResult(data);
    }).catch(error => {
      if (!controller.signal.aborted) setVerifyError(error instanceof Error ? error.message : "Verification unavailable.");
    }).finally(() => { if (!controller.signal.aborted) setVerifying(false); });
    return () => controller.abort();
  }, [fixState?.status, fixState?.response, fixCommentBody, fixCommentPath, repoFull]);

  // Comment polling must never buy another explanation of the same patch.
  useEffect(() => {
    if (fixState?.status !== "done" || fixState.response.length <= 50 || !extractDiff(fixState.response)) return;
    const controller = new AbortController();
    setAutoExplainer("");
    void generateExplainer(fixState.response, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixState?.status, fixState?.response, repoFull]);

  // Generate a "why this fix" explainer
  async function generateExplainer(fixResponse: string, signal: AbortSignal) {
    try {
      const res = await fetch("/api/prs/draft-reply", {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: `I made this fix for a PR review comment with an AI coding tool and reviewed it. Summarize what was changed and why in 2-3 sentences, in the first person as the PR author (I am accountable for the change). Be accurate; do not claim I wrote it unaided.\n\nFix output:\n${fixResponse.slice(0, 3000)}`,
          comment_author: "me",
        }),
      });
      const text = await readTextResponse(res, () => {});
      if (!signal.aborted) setAutoExplainer(text);
    } catch { /* non-critical; incomplete explanations stay hidden */ }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Nor behind an open modal: its content is all the user can act on.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

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
            if (!isFixing && !writesPending) handleFix(c);
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
  });

  // ── Lazy-load diff ─────────────────────────────────────────────────

  const loadDiff = useCallback(async () => {
    if (prDiff !== null || diffRequest.current) return;
    const controller = new AbortController();
    diffRequest.current = controller;
    setDiffLoading(true);
    setDiffError("");
    try {
      const response = await fetch(`/api/prs/diff?repo=${encodeURIComponent(repoFull)}&pr=${prNumber}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      const data = await readJson<{ diff?: unknown }>(response);
      if (!data || typeof data.diff !== "string") throw new Error("The server returned an invalid response. Please try again.");
      if (diffRequest.current === controller) setPrDiff(data.diff);
    } catch (error) {
      if (diffRequest.current === controller) setDiffError(requestErrorMessage(error));
    } finally {
      if (diffRequest.current === controller) {
        diffRequest.current = null;
        setDiffLoading(false);
      }
    }
  }, [repoFull, prNumber, prDiff]);

  // ── Fix ────────────────────────────────────────────────────────────

  async function handleFix(comment: ReviewComment) {
    if (writesPending) return;
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
    if (writesPending) return;
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
    if (writesPending) return;
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
    setFixState((prev) => prev && prev.status === "generating" ? { ...prev, status: "cancelled", step: "Cancelled" } : prev);
    setFollowUpGenerating(false);
    toast("Generation cancelled", "signal");
  }

  async function streamFix(
    commentBody: string,
    filePath: string | null,
    line: number | null,
    diffHunk: string | null,
  ) {
    setFollowUpComment("");
    setFollowUpSent(false);
    setFollowUpGenerating(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/prs/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]),
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
        if (controller.signal.aborted) return;
        if (p.error) throw new Error(p.error);
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
          return;
        }
      }

      // A stream that ended while still generating produced nothing. Reporting
      // that as "Complete" was how a 429 or a 500 surfaced: a finished-looking
      // fix with an empty body and no hint that anything went wrong.
      setFixState((prev) => {
        if (!prev || prev.status !== "generating") return prev;
        return { ...prev, status: "error", step: "Interrupted", response: prev.response + "\n\nThe fix stream ended before completion. Retry before using this patch." };
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setFixState((prev) =>
        prev ? { ...prev, response: err instanceof Error ? err.message : "Network error", status: "error", step: "Failed" } : prev,
      );
      toast("Fix generation failed — check your connection", "alert");
    }
  }

  // ── Push fix with retry ────────────────────────────────────────────

  async function handlePush() {
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

    if (!pr.headRepo) {
      setPushState("error");
      setPushMessage("The PR source repository is unavailable. Refresh the PR before pushing.");
      return;
    }

    try {
      const res = await fetch("/api/prs/push", {
        method: "POST",
        signal: AbortSignal.timeout(310_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: pr.headRepo,
          upstream: repoFull,
          branch: pr.branch,
          diff,
          commit_message: commitMsg.trim() || "address review feedback",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; commit?: string; message?: string; error?: string; debug?: { diffPreview?: string; strategyErrors?: string[] } };
      if (res.ok && data.ok) {
        setPushState("pushed");
        setPushMessage(data.message ?? `Pushed commit ${data.commit}`);
        toast(`Pushed commit ${data.commit} to ${pr.branch}`, "ok");
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
    } catch {
      setPushState("error");
      setPushMessage("The push result could not be confirmed. Check the branch on GitHub before retrying.");
      toast("Push failed — network error", "alert");
    }
  }

  // ── Reply ──────────────────────────────────────────────────────────

  async function handleReply(comment: ReviewComment) {
    const text = replyTexts.get(comment.id)?.trim();
    if (!text || pendingReplies.current.has(comment.id)) return;
    pendingReplies.current.add(comment.id);

    setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "sending" }));

    try {
      const res = await fetch("/api/prs/reply", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_number: parseInt(prNumber),
          comment_id: comment.id,
          body: text,
          type: comment.type,
        }),
      });
      // readJson turns 401, server errors and unreadable bodies into a message worth showing.
      const data = await readJson<{ ok?: boolean }>(res).catch((error: unknown) => ({ ok: false, message: requestErrorMessage(error) }));
      if (data.ok) {
        setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "sent" }));
        setShowReplyFor(null);
        setReplyTexts((prev) => { const m = new Map(prev); m.delete(comment.id); return m; });
        setCommentStatuses((prev) => new Map(prev).set(comment.id, "replied"));
        toast("Reply posted successfully", "ok");
      } else {
        setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "error" }));
        toast("message" in data && data.message ? `Reply not posted: ${data.message}` : "Failed to post reply", "alert");
      }
    } catch {
      setReplyStates((prev) => new Map(prev).set(comment.id, { commentId: comment.id, status: "error" }));
      toast("Reply result unknown. Check the PR on GitHub before retrying.", "alert");
    } finally { pendingReplies.current.delete(comment.id); }
  }

  // ── Draft reply ────────────────────────────────────────────────────

  async function handleDraftReply(comment: ReviewComment) {
    if (writesPending) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: comment.body,
          comment_author: comment.author,
          file_path: comment.path,
        }),
      });

      const text = await readTextResponse(res, response => {
        if (!controller.signal.aborted) setFixState(prev => prev ? { ...prev, response } : prev);
      });
      if (controller.signal.aborted) return;
      // Same short AI-assistance note as follow-up comments and the PR body;
      // the reply stays an editable draft the user sends themselves.
      setReplyTexts(prev => new Map(prev).set(comment.id, text.trim() ? text + commentDisclosure(CLAUDE_FAST_MODEL) : text));
      setShowReplyFor(comment.id);
      setFixState(prev => prev ? { ...prev, response: text, status: "done", step: "Complete" } : prev);
    } catch (err) {
      if (controller.signal.aborted) return;
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
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]),
        body: JSON.stringify({
          repo: repoFull,
          pr_title: pr?.title,
          comment_body: `I just pushed a follow-up commit to this PR. Here is the diff and explanation:\n\n${fixState.response.slice(0, 4000)}\n\nPlease write a detailed but concise PR comment I can post explaining:\n1. What this commit changes and why\n2. The technical reasoning behind the approach\n3. Any caveats or things the reviewer should know\n\nWrite it in the first person as the PR author, who is accountable for the commit. Be accurate about how it was made: an AI tool drafted the change and I reviewed it. A short AI-assistance note is appended automatically, so do not add another.`,
          comment_author: "me",
        }),
      });

      await readTextResponse(res, text => {
        if (!controller.signal.aborted) setFollowUpComment(text);
      });
      // Posted comments carry the same short AI-assistance note as the PR
      // body. It stays editable: this is a draft the user posts themselves.
      if (!controller.signal.aborted) setFollowUpComment((text) => text.trim() ? text + commentDisclosure(CLAUDE_FAST_MODEL) : text);
    } catch (err) {
      setFollowUpComment("");
      if (!controller.signal.aborted) toast(err instanceof Error ? err.message : "Failed to generate comment.", "alert");
    } finally {
      setFollowUpGenerating(false);
    }
  }

  async function handleSendFollowUp() {
    if (!followUpComment.trim() || followUpSent || pendingReplies.current.has("follow-up")) return;
    pendingReplies.current.add("follow-up");
    setFollowUpSending(true);
    setFollowUpSent(false);

    try {
      const res = await fetch("/api/prs/reply", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
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
      toast("Comment result unknown. Check the PR on GitHub before retrying.", "alert");
    } finally {
      pendingReplies.current.delete("follow-up");
      setFollowUpSending(false);
    }
  }


  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        // The breadcrumb is the mono path line: back to the list, then this PR.
        path={
          <nav aria-label="Breadcrumb">
            ship / <Link href="/prs" className="underline decoration-border-strong underline-offset-[3px] hover:text-signal">pull requests</Link> / {params.owner}/{params.repo} #{prNumber}
          </nav>
        }
        title={<>PR #{prNumber}</>}
        description={`Review and respond to feedback on ${repoFull}#${prNumber}`}
        actions={
          <>
            {/* Session cost + keyboard shortcut hint */}
            {sessionCost > 0 && (
              <span className="text-[13px] text-paper-muted tabular-nums">
                Session total: ${sessionCost.toFixed(4)}
              </span>
            )}
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              aria-expanded={showShortcuts}
              className="btn-quiet"
              data-size="sm"
            >
              ? shortcuts
            </button>
          </>
        }
      />


      {/* Shortcuts overlay */}
      {showShortcuts && (
        <div className="card mb-3 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] font-medium text-paper-muted">Keyboard shortcuts</span>
            <button onClick={() => setShowShortcuts(false)} className="text-[12.5px] text-paper-faint hover:text-paper-muted">close</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
            {SHORTCUTS.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-[12px]">
                <kbd className="min-w-[24px] rounded-md bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[12px] text-paper">{s.key}</kbd>
                <span className="text-paper-dim">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <PrSkeleton />}
      {error && (
        <div className="callout callout-alert mt-8 px-4 py-3 text-[13px] text-alert flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchComments()} className="btn-quiet text-alert" data-size="sm">
            retry
          </button>
        </div>
      )}

      {pr && (
        <>
          {/* PR header */}
          <div className="card mt-4 px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("chip", pr.state === "OPEN" ? "chip-info" : pr.state === "MERGED" ? "chip-ok" : "")}>
                {pr.state}
              </span>
              <span className="text-[19px] font-semibold leading-snug tracking-[-0.01em] text-paper">{pr.title}</span>
            </div>
            <div className="mt-2.5 flex items-center gap-x-4 gap-y-1 text-[13px] text-paper-muted flex-wrap">
              <span>
                {pr.author} wants to merge <span className="text-info">{pr.branch}</span> into <span className="text-info">{pr.base}</span>
              </span>
              <Term term="base branch">what does this mean?</Term>
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
                  className="text-paper-faint hover:text-paper-dim transition-colors text-[12.5px]"
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
                <span className="text-[12.5px] text-signal">
                  {newCommentsCount} new
                </span>
              )}
            </div>
          </div>

          {/* Collapsible PR diff */}
          {showDiff && (
            <>
            <p className="fig mt-4">
              <span className="fig-tag">fig. 1</span>
              <span>diff · {repoFull} #{prNumber}</span>
            </p>
            <div className="mt-2 max-h-[500px] overflow-auto rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
              {diffLoading ? (
                <div className="px-4 py-3 text-[12px] text-paper-muted">Loading diff...</div>
              ) : diffError ? (
                <div role="alert" className="px-4 py-3 text-[12px] text-alert">
                  {diffError}
                  <button onClick={() => void loadDiff()} className="ml-3 underline">Retry diff</button>
                </div>
              ) : prDiff ? (
                diffViewMode === "split" ? (
                  <SplitDiffView diff={prDiff} />
                ) : (
                  <pre className="px-4 py-3 text-[12px] font-mono leading-snug">
                    <DiffLines diff={prDiff} />
                  </pre>
                )
              ) : (
                <div className="px-4 py-3 text-[12px] text-paper-muted">No diff available</div>
              )}
            </div>
            </>
          )}

          {/* Ask about this change: the PR's own patch and description, plus a
              follow-up fix once one is drafted here. Loads the diff on open. */}
          <ChangeChat
            storageKey={`pr:${repoFull}#${prNumber}`}
            repo={repoFull}
            title={pr.title}
            onOpen={() => void loadDiff()}
            starters={STARTER_QUESTIONS.filter((q) => !q.includes("project's rules"))}
            caveat="Answers are based on this pull request's change; check them against the code."
            context={{
              description: [
                pr.body ? `PR description:\n${pr.body}` : "",
                fixState?.status === "done" && fixState.response ? `A follow-up fix drafted on this page (not pushed yet unless the page says so):\n${fixState.response}` : "",
              ].filter(Boolean).join("\n\n"),
              diff: prDiff ?? undefined,
            }}
          />

          {/* First contribution? The draft, the wait, the etiquette. */}
          <details className="card mt-4 px-4 py-3">
            <summary className="min-h-10 cursor-pointer py-1.5 text-[16px] font-semibold text-paper">New to this? What happens next, and how to answer reviewers</summary>
            <div className="mt-3"><NextSteps heading="After your pull request opens" /></div>
          </details>

          {/* Follow-up loop: events, opt-in, follow-up runs (opensrcer PRs only) */}
          <PrFollowups prUrl={pr.url} />

          {/* Comment status bar */}
          {stats.total > 0 && (
            <div className="mt-4 flex items-center gap-4 text-[12px] flex-wrap">
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
                <span className="chip chip-ok">all addressed</span>
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
                    disabled={isFixing || writesPending}
                    className="btn-quiet" data-size="sm"
                  >
                    {isFixing && fixState?.commentId === "all" ? "generating fixes..." : `fix all ${actionableComments.length} comments`}
                  </button>
                )}
              </div>
              {/* Fix mode selector */}
              <div className="card flex flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-ink-2 p-1 shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
                  <button
                    onClick={() => setFixMode("quick")}
                    aria-pressed={fixMode === "quick"}
                    className="pill"
                    data-size="sm"
                    data-quiet={fixMode === "quick" ? undefined : ""}
                  >
                    quick
                  </button>
                  <button
                    onClick={() => setFixMode("deep")}
                    aria-pressed={fixMode === "deep"}
                    className="pill"
                    data-size="sm"
                    data-quiet={fixMode === "deep" ? undefined : ""}
                  >
                    deep
                  </button>
                </div>
                <div className="text-[12.5px] leading-relaxed">
                  {fixMode === "quick" ? (
                    <div>
                      <span className="text-ok font-medium">Quick fix</span>
                      <span className="text-paper-faint"> — uses focused file context and nearby symbols. </span>
                      <span className="text-paper-dim">Recommended for single-file, straightforward comments.</span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-signal font-medium">Deep fix</span>
                      <span className="text-paper-faint"> — explores the repository and related symbols before proposing a change. </span>
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
              <div className="card px-4 py-6 text-center text-[13px] text-paper-muted">
                No review comments from maintainers yet.
              </div>
            )}

            {comments.map((c) => {
              const replySt = replyStates.get(c.id);
              const status = commentStatuses.get(c.id) ?? "pending";
              const isFocused = actionableComments[focusedComment]?.id === c.id;

              return (
                <div
                  key={c.id}
                  ref={(el) => { if (el) commentRefs.current.set(c.id, el); }}
                  className={cn(
                    "card overflow-hidden transition-all",
                    c.isOwnComment && "opacity-60",
                    isFocused && "ring-2 ring-signal/40",
                    status === "fixed" && "border-l-4 border-l-ok",
                    status === "replied" && "border-l-4 border-l-info",
                  )}
                >
                  {/* Comment header */}
                  <div className="px-5 py-3 border-b border-border-soft flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] text-paper font-semibold">{c.author}</span>
                    {c.isOwnComment && <span className="chip">you</span>}
                    <span className="text-[12.5px] text-paper-faint">
                      {new Date(c.createdAt).toLocaleDateString()} {new Date(c.createdAt).toLocaleTimeString()}
                    </span>
                    {/* Status indicator */}
                    {!c.isOwnComment && status !== "pending" && (
                      <span className={cn("chip", status === "fixed" ? "chip-ok" : "chip-info")}>

                        {status}
                      </span>
                    )}
                    {c.path && (
                      <span className="ml-auto text-[12.5px] text-info font-mono">{c.path}{c.line ? `:${c.line}` : ""}</span>
                    )}
                    {c.type === "review" && (
                      <span className="chip">inline</span>
                    )}
                  </div>

                  {/* Diff hunk */}
                  {c.diffHunk && (
                    <div className="px-4 py-2 border-b border-border-soft bg-ink-2 overflow-x-auto">
                      <pre className="text-[12.5px] text-paper-faint font-mono whitespace-pre-wrap">{c.diffHunk}</pre>
                    </div>
                  )}

                  {/* Comment body */}
                  <div className="px-4 py-3">
                    <p className="text-[16px] leading-[1.6] text-paper-dim whitespace-pre-wrap break-words">{c.body}</p>
                  </div>

                  {/* Action buttons */}
                  {!c.isOwnComment && (
                    <div className="px-4 py-2 border-t border-border-soft flex items-center gap-2 flex-wrap">
                      {isQuestion(c.body) ? (
                        <>
                          <button
                            onClick={() => handleDraftReply(c)}
                            disabled={isFixing || writesPending}
                            className="btn-quiet text-info" data-size="sm"
                          >
                            {fixState?.commentId === c.id && isFixing ? "drafting..." : "draft reply"}
                          </button>
                          <button
                            onClick={() => setShowReplyFor(showReplyFor === c.id ? null : c.id)}
                            className="btn-quiet" data-size="sm"
                          >
                            reply manually
                          </button>
                          <span className="text-[12.5px] text-paper-faint">question — AI will draft a reply</span>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleFix(c)}
                            disabled={isFixing || writesPending}
                            className="btn-quiet"
                            data-size="sm"
                          >
                            {fixState?.commentId === c.id && isFixing ? "generating..." : fixMode === "quick" ? "quick fix" : "deep fix"}
                          </button>
                          <button
                            onClick={() => handleDraftReply(c)}
                            disabled={isFixing || writesPending}
                            className="btn-quiet text-info" data-size="sm"
                          >
                            draft reply
                          </button>
                          <button
                            onClick={() => setShowReplyFor(showReplyFor === c.id ? null : c.id)}
                            className="btn-quiet" data-size="sm"
                          >
                            reply manually
                          </button>
                        </>
                      )}
                      {replySt?.status === "sent" && (
                        <span className="text-[12.5px] text-ok">replied</span>
                      )}
                      {replySt?.status === "error" && (
                        <span className="text-[12.5px] text-alert">failed to reply</span>
                      )}
                    </div>
                  )}

                  {/* Reply input */}
                  {showReplyFor === c.id && (
                    <div className="px-4 py-2.5 border-t border-border-soft bg-ink-2">
                      <div className="flex gap-2">
                        <textarea
                          value={replyTexts.get(c.id) ?? ""}
                          onChange={(e) => setReplyTexts((prev) => new Map(prev).set(c.id, e.target.value))}
                          placeholder="Write a reply..."
                          rows={2}
                          className="field flex-1 resize-y min-h-[40px]"
                        />
                        <div className="flex flex-col gap-1 self-end">
                          <button
                            onClick={() => handleReply(c)}
                            disabled={!replyTexts.get(c.id)?.trim() || replySt?.status === "sending"}
                            className="btn-quiet text-info shrink-0" data-size="sm"
                          >
                            {replySt?.status === "sending" ? "..." : "send"}
                          </button>
                          <button
                            onClick={() => setShowReplyFor(null)}
                            className="text-[12.5px] text-paper-faint hover:text-paper-muted transition"
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
            <div ref={fixRef} className="card mt-4">
              <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-signal">
                  {fixState.commentId === "all" ? "fix all comments" : "fix generation"}
                </span>
                {fixState.status === "generating" && (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[12.5px] text-paper-dim">{fixState.step}</span>
                    <span className="text-[12.5px] text-signal">
                      <LoadingDots />
                    </span>
                    <button onClick={cancelGeneration} className="btn-quiet" data-size="sm">cancel</button>
                  </span>
                )}
                {fixState.status === "done" && fixState.cost !== null && (
                  <span className="ml-auto text-[12.5px] text-paper-muted tabular-nums">{costLabel(fixState.cost)}</span>
                )}
                {fixState.status === "cancelled" && <span className="ml-auto text-[12.5px] text-paper-muted">Cancelled</span>}
                {fixState.status === "error" && (
                  <span className="ml-auto text-[12.5px] text-alert">failed</span>
                )}
              </div>

              {/* Live agent activity timeline */}
              {fixState.tools.length > 0 && (
                <div className="px-4 py-2 border-b border-border-soft bg-ink-2">
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-[12px] font-medium text-paper-faint">Agent activity</span>
                    <span className="text-[12px] text-paper-faint tabular-nums">{fixState.tools.length} tool calls</span>
                    {fixState.status === "generating" && <span className="text-[12px] text-signal ml-1">live</span>}
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
                            "flex items-center gap-2 pl-3 text-[12.5px]",
                            isLast && "font-medium",
                          )}>
                            <span className={cn(
                              "relative z-10 shrink-0 w-4 h-4 flex items-center justify-center text-[11px] font-mono rounded-full border",
                              isLast ? "bg-signal-faint border-signal/50 text-signal" : "bg-ink-2 border-border-soft",

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
                  <div className="text-[12px] text-alert whitespace-pre-wrap break-words">
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
                        className="btn-quiet" data-size="sm"
                      >
                        retry from scratch
                      </button>
                      {fixRetryCount < 3 && lastFixComment && (
                        <button
                          onClick={handleRetryWithContext}
                          className="btn-quiet text-ok" data-size="sm"
                        >
                          self-heal (retry with error context)
                        </button>
                      )}
                      {fixRetryCount >= 3 && (
                        <span className="text-[12.5px] text-paper-faint">Max retries reached — try deep fix mode or fix manually</span>
                      )}
                    </div>
                  </div>
                ) : fixState.response ? (
                  <FixResponse text={fixState.response} />
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-paper-muted">
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
                  <span className="text-[12.5px] text-paper-faint font-medium">export</span>
                  <button
                    onClick={async () => {
                      try {
                        await copyText(extractDiff(fixState.response)!);
                        toast("Diff copied to clipboard", "ok");
                      } catch {
                        toast("Clipboard access failed. Download the patch instead.", "alert");
                      }
                    }}
                    className="btn-quiet" data-size="sm"
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
                    className="btn-quiet" data-size="sm"
                  >
                    download .patch
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await copyText(fixState.response);
                        toast("Full response copied", "ok");
                      } catch {
                        toast("Clipboard access failed. Try again from a secure browser window.", "alert");
                      }
                    }}
                    className="btn-quiet" data-size="sm"
                  >
                    copy full response
                  </button>
                  <button
                    onClick={async () => {
                      if (sharing.current) return;
                      sharing.current = true;
                      let shareLink: string | null = null;
                      try {
                        const diff = extractDiff(fixState.response);
                        const comment = typeof fixState.commentId === "number"
                          ? comments.find((c) => c.id === fixState.commentId) : null;
                        const res = await fetch("/api/fixes", {
                          method: "POST",
                          signal: AbortSignal.timeout(30_000),
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
                        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
                        if (!res.ok || typeof data.url !== "string") throw new Error(data.error ?? "Could not create share link.");
                        if (data.url) {
                          shareLink = window.location.origin + data.url;
                          await copyText(shareLink);
                          toast("Share link copied to clipboard", "ok");
                        }
                      } catch (error) {
                        toast(
                          shareLink
                            ? "Share link created, but clipboard access failed."
                            : error instanceof Error ? error.message : "Failed to create share link",
                          "alert",
                        );
                      } finally {
                        sharing.current = false;
                      }
                    }}
                    className="btn-quiet" data-size="sm"
                  >
                    share fix
                  </button>
                </div>
              )}

              {verifyError && <p role="alert" className="px-4 py-3 text-[12.5px] text-alert">Verification could not finish: {verifyError}</p>}
              {/* Verification results */}
              {fixState.status === "done" && extractDiff(fixState.response) && (
                <div className="px-4 py-3 border-t border-border-soft">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12.5px] font-medium text-paper-muted">
                      verification checks
                    </span>
                    {verifying && (
                      <span className="text-[12.5px] text-signal flex items-center gap-1">
                        <LoadingDots /> running checks...
                      </span>
                    )}
                    {verifyResult && (
                      <span className={cn(
                        "chip",
                        verifyResult.summary.verdict === "clean" ? "chip-ok" :
                        verifyResult.summary.verdict === "review" ? "chip-info" :
                        "chip-alert",
                      )}>
                        {verifyResult.summary.verdict === "clean" ? "all clear" :
                         verifyResult.summary.verdict === "review" ? "review needed" : "blocked"}
                      </span>
                    )}
                  </div>

                  {verifyResult && (
                    <div className="space-y-1">
                      {verifyResult.checks.map((check, i) => (
                        <div key={i} className="flex items-start gap-2 text-[12px]">
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
                      <div className="mt-2 pt-2 border-t border-border-soft text-[12.5px] text-paper-faint">
                        +{verifyResult.summary.linesAdded} / -{verifyResult.summary.linesRemoved} lines | {verifyResult.summary.filesChanged} file(s) | {verifyResult.summary.pass} passed, {verifyResult.summary.warn} warnings, {verifyResult.summary.fail} failed
                      </div>
                      {verifyResult.summary.fail > 0 && fixRetryCount < 3 && lastFixComment && (
                        <div className="mt-2 pt-2 border-t border-border-soft">
                          <button
                            onClick={handleRetryWithContext}
                            className="btn-quiet text-ok" data-size="sm"
                          >
                            Self-heal: retry fix using these verification results as context
                          </button>
                          <span className="ml-2 text-[12.5px] text-paper-faint">Attempt {fixRetryCount + 1}/3</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Push controls */}
              {fixState.status === "done" && extractDiff(fixState.response) && (
                <div className="px-4 py-3 border-t border-border-soft bg-ink-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[12.5px] text-paper-faint font-medium">commit:</span>
                    <input
                      type="text"
                      value={commitMsg}
                      onChange={(e) => setCommitMsg(e.target.value)}
                      disabled={pushState === "pushing" || pushState === "pushed"}
                      className="field flex-1 min-w-[200px] max-w-md disabled:opacity-50"
                      placeholder="address review feedback"
                    />
                    <button
                      onClick={() => handlePush()}
                      disabled={pushState === "pushing" || pushState === "pushed"}
                      className={cn("shrink-0", pushState === "pushed" ? "btn-quiet text-ok" : "btn-primary")}
                      data-size="sm"
                    >
                      {pushState === "pushing" ? "pushing..." : pushState === "pushed" ? "pushed" : "push fix"}
                    </button>
                  </div>
                  {pushMessage && (
                    <div className={cn(
                      "callout mt-3 text-[13px]",
                      pushState === "error" ? "callout-alert" : "callout-ok text-ok",
                    )}>
                      {pushState === "error" && (
                        <div className="flex items-start justify-between gap-2">
                          <span className="whitespace-pre-wrap break-words">{pushMessage}</span>
                          <button
                            onClick={() => handlePush()}
                            className="btn-quiet shrink-0" data-size="sm"
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
                      <div className="callout callout-ok mb-2 px-3 py-2 text-[12px] text-paper-dim">
                        <span className="text-[12px] text-ok font-medium block mb-1">auto-generated explanation</span>
                        <p className="whitespace-pre-wrap">{autoExplainer}</p>
                        <button
                          onClick={() => { setFollowUpComment(autoExplainer); }}
                          className="btn-quiet mt-1.5 text-ok" data-size="sm"
                        >
                          use as follow-up comment
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[12.5px] text-paper-faint font-medium">
                        follow-up comment
                      </span>
                      <button
                        onClick={handleGenerateFollowUp}
                        disabled={followUpGenerating || followUpSending || followUpSent}
                        className="btn-quiet text-info" data-size="sm"
                      >
                        {followUpGenerating ? "drafting..." : followUpComment ? "regenerate" : "draft detailed version"}
                      </button>
                      {followUpGenerating && (
                        <button onClick={cancelGeneration} className="text-[12.5px] text-paper-muted hover:text-alert transition">cancel</button>
                      )}
                      <span className="text-[12px] text-paper-faint">
                        Explains the commit reasoning to the reviewer
                      </span>
                    </div>

                    {(followUpComment || followUpGenerating) && (
                      <>
                        <textarea
                          value={followUpComment}
                          onChange={(e) => setFollowUpComment(e.target.value)}
                          disabled={followUpGenerating || followUpSending || followUpSent}
                          rows={5}
                          className="field w-full disabled:opacity-50 resize-y"
                          placeholder="Generating comment..."
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={handleSendFollowUp}
                            disabled={!followUpComment.trim() || followUpGenerating || followUpSending || followUpSent}
                            className={followUpSent ? "btn-quiet text-ok" : "btn-quiet"}
                            data-size="sm"
                          >
                            {followUpSending ? "posting..." : followUpSent ? "sent" : "post comment to PR"}
                          </button>
                          <span className="text-[12px] text-paper-faint">
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
    <div className="grid grid-cols-2 text-[12px] font-mono leading-snug">
      {hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>
          <div className="col-span-2 px-3 py-px text-paper-faint bg-ink-2">
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
                      ? "bg-surface-2/60"
                      : changed
                        ? "text-alert bg-alert-dim/20"
                        : "text-paper-dim",
                  )}
                >
                  {left ?? "\u00a0"}
                </div>
                <div
                  className={cn(
                    "px-3 py-px whitespace-pre-wrap",
                    right === null
                      ? "bg-surface-2/60"
                      : changed
                        ? "text-ok bg-ok-dim/25"
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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const popOutButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!poppedOut) return;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPoppedOut(false);
        requestAnimationFrame(() => popOutButtonRef.current?.focus());
        return;
      }
      // Keep Tab inside the dialog.
      const dialog = closeButtonRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [poppedOut]);

  function closePopOut() {
    setPoppedOut(false);
    setCopyState("idle");
    requestAnimationFrame(() => popOutButtonRef.current?.focus());
  }

  async function copyDiff() {
    try {
      await copyText(diff);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  // Parse files from the diff
  const files = diff.match(/^\+\+\+ (?:b\/)?(\S+)/gm)?.map((l) => l.replace(/^\+\+\+ (?:b\/)?/, "")) ?? [];
  const added = (diff.match(/^\+[^+]/gm) || []).length;
  const removed = (diff.match(/^-[^-]/gm) || []).length;

  const diffContent = (
    <>
      <div className="px-3 py-1.5 border-b border-border-soft bg-ink-2 text-[12.5px] text-paper-faint flex items-center justify-between">
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
      <pre className="px-3 py-2 text-[12px] font-mono leading-snug">
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
            className="flex items-center gap-2 text-[12.5px] text-paper-muted hover:text-paper-dim transition"
          >
            <span className="font-medium">diff preview</span>
            <span className="text-ok tabular-nums">+{added}</span>
            <span className="text-alert tabular-nums">-{removed}</span>
            <span className="text-paper-faint">{files.length} file{files.length !== 1 ? "s" : ""}</span>
            <span className="text-paper-faint">{expanded ? "collapse" : "expand"}</span>
          </button>
          <button
            ref={popOutButtonRef}
            onClick={() => setPoppedOut(true)}
            className="text-[12.5px] text-paper-faint hover:text-info transition ml-2"
            title="Open in floating panel"
          >
            pop out
          </button>
        </div>

        {expanded && !poppedOut && (
          <div className="card mt-2 max-h-[400px] overflow-auto">
            {diffContent}
          </div>
        )}
      </div>

      {/* Pop-out floating panel */}
      {poppedOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/45" onClick={closePopOut}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="diff-preview-dialog-title"
            className="card w-[90vw] max-w-[900px] max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 border-b border-border-soft flex items-center justify-between shrink-0">
              <span id="diff-preview-dialog-title" className="text-[12px] text-paper-muted font-medium">Diff preview</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={copyDiff}
                  aria-live="polite"
                  className={cn("text-[12.5px] transition", copyState === "error" ? "text-alert" : "text-paper-muted hover:text-paper")}
                >
                  {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy diff"}
                </button>
                <button
                  ref={closeButtonRef}
                  onClick={closePopOut}
                  className="text-[12.5px] text-paper-faint hover:text-alert transition"
                >
                  Close <span aria-hidden>(Esc)</span>
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

// ── Quiet "still working" mark ────────────────────────────────────────
// A plain ellipsis: a status in words reads calmer than bouncing dots.

function LoadingDots() {
  return <span aria-hidden="true">…</span>;
}

// ── Fix response renderer ────────────────────────────────────────────

function FixResponse({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed text-paper-dim break-words">
      {blocks.map((block, i) => {
        if (block.type === "code") {
          const isDiff = block.lang === "diff" || block.lang === "patch" || block.content.includes("@@");
          return (
            <div key={i} className="overflow-x-auto">
              <div className="rounded-lg flex items-center px-3 py-1 bg-ink-2 border border-border-soft border-b-0 text-[12.5px] text-paper-muted">
                <span className="font-mono">{block.lang || (isDiff ? "diff" : "code")}</span>
              </div>
              <pre className="card overflow-x-auto px-3 py-2.5 text-[12px] leading-snug font-mono">
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
      <div className="card px-4 py-3">
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
        <div key={i} className="card">
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
