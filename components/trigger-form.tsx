"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import { parseRunTarget } from "@/lib/run-target";
import { IconArrow } from "@/components/icons";
import { Term } from "@/components/term";

type SubmitState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; message: string; queued_at: string; mode: string; dispatch_id: string }
  | { kind: "err"; message: string };

function friendlyError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("econnrefused") || lower.includes("fetch failed")) return "Could not reach the server. Check your connection and try again.";
  if (lower.includes("unauthenticated") || lower.includes("not authenticated")) return "Your session expired. Please log in again.";
  // Payment errors already say what to do (lib/run-payment.ts); only the bare one gets a hint.
  if (lower.startsWith("no anthropic api key")) return "Choose how runs are paid for in Settings before starting a run.";
  if (lower.includes("rate limit")) return "Rate limit hit. Wait a minute and try again.";
  if (lower.includes("repo_url")) return "Please enter a valid GitHub repository URL.";
  return msg;
}

/** Claude's own sign-in pages: a run's sign-in link must point at one of them. */
const CLAUDE_SIGN_IN_HOSTS = new Set(["claude.com", "claude.ai", "platform.claude.com"]);

/** Wait for the run's worker to publish Claude's sign-in link, then send the
 *  tab the user's click opened there (a tab opened later would be blocked as
 *  a popup). Sign-in happens on Anthropic's page; the code is pasted on the
 *  run page, which relays it to the run's VM. */
async function openClaudeSignIn(tab: Window, dispatchId: string) {
  for (let i = 0; i < 90 && !tab.closed; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const run = await fetch(`/api/dispatches/${encodeURIComponent(dispatchId)}`)
      .then((res) => (res.ok ? res.json() : null)).catch(() => null) as { status?: string; sign_in?: { url?: string; status?: string } } | null;
    const url = run?.sign_in?.status === "waiting" ? run.sign_in.url : undefined;
    if (url) {
      try {
        if (CLAUDE_SIGN_IN_HOSTS.has(new URL(url).hostname)) { tab.location.href = url; return; }
      } catch { /* not a URL */ }
      break;
    }
    if (run?.status && run.status !== "running") break;
  }
  tab.close();
}

export function TriggerForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  // True when this run will be paid by the user's Claude plan through a
  // sign-in inside the run's worker (hosted, OPENSRCER_HOSTED_SUBSCRIPTION=1).
  const [claudeSignIn, setClaudeSignIn] = useState(false);
  useEffect(() => {
    fetch("/api/settings/keys").then((res) => (res.ok ? res.json() : null)).then((s: { hostedSubscription?: boolean; providerOrder?: string[]; offered?: string[] } | null) => {
      const first = s?.providerOrder?.find((p) => s.offered?.includes(p));
      setClaudeSignIn(Boolean(s?.hostedSubscription && first === "claude-subscription"));
    }).catch(() => {});
  }, []);
  // A run started here can finish starting after the user has moved on;
  // only navigate if this form is still on screen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Pre-fill from URL params (e.g. ?repo=owner/name&issue=123&try=1)
  useEffect(() => {
    const repo = searchParams.get("repo");
    const issue = searchParams.get("issue");
    const tryMode = searchParams.get("try");
    if (repo) {
      setRepoUrl(issue ? `https://github.com/${repo}/issues/${issue}` : `https://github.com/${repo}`);
      if (tryMode === "1") setDryRun(true);
    }
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "pending") return;
    if (!repoUrl.trim()) {
      setState({ kind: "err", message: "Please enter a GitHub repository URL" });
      return;
    }
    setState({ kind: "pending" });
    // Opened now, inside the click, so the browser allows it.
    const signInTab = claudeSignIn ? window.open("", "_blank") : null;
    if (signInTab) {
      signInTab.document.title = "Claude sign-in";
      signInTab.document.body.textContent = "Starting your run… Claude's sign-in page opens here in a moment.";
    }
    try {
      const target = parseRunTarget(repoUrl);
      if (!target.issue) {
        signInTab?.close();
        router.push(`/issues?repo=${encodeURIComponent(target.repo)}`);
        setState({ kind: "idle" });
        return;
      }
      const res = await fetch("/api/run/agentic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: target.repo, issue_number: target.issue, dry_run: dryRun, notes }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => null) as {
        message?: string;
        error?: string;
        dispatch_id?: string;
        queued_at?: string;
        mode?: string;
      } | null;
      if (res.status === 401) throw new Error("Your session expired. Sign in again to start a run.");
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `The server could not start this run (${res.status}).`);
      if (!data || typeof data.dispatch_id !== "string" || !data.dispatch_id.trim()) {
        throw new Error("The server returned an invalid run response. Please try again.");
      }
      const dispatchId = data.dispatch_id;
      if (signInTab) void openClaudeSignIn(signInTab, dispatchId);
      setState({
        kind: "ok",
        message: data.message ?? "queued",
        queued_at: data.queued_at ?? new Date().toISOString(),
        mode: data.mode ?? (dryRun ? "dry-run" : "live"),
        dispatch_id: dispatchId,
      });
      if (!mounted.current) {
        toast("Run started. Open Runs to watch it.", "ok");
        return;
      }
      toast("Run started — opening the live view...", "ok");
      setRepoUrl("");
      setNotes("");

      router.push(`/dispatches?dispatch=${encodeURIComponent(dispatchId)}`);
    } catch (err) {
      signInTab?.close();
      const msg = err instanceof Error && err.name === "TimeoutError"
        ? "Starting the run timed out. Please try again."
        : err instanceof TypeError ? "Could not reach the server. Check your connection and try again."
        : err instanceof Error ? err.message : String(err);
      setState({ kind: "err", message: friendlyError(msg) });
      toast(friendlyError(msg), "alert");
    }
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      <form
        onSubmit={submit}
        className="col-span-12 rounded-md border border-border bg-surface p-5 sm:p-6 lg:col-span-8"
      >
        <Row
          htmlFor="run-repository"
          label="Repository"
          hint="Paste a GitHub repo URL or issue URL"
        >
          <input
            id="run-repository"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo or https://github.com/owner/repo/issues/123"
            spellCheck={false}
            autoComplete="off"
            className="rounded-2xl w-full border border-border-soft bg-ink px-3 py-3 text-[14px] text-paper placeholder:text-paper-faint focus:border-signal focus:outline-none"
          />
        </Row>

        <Row label="Mode" hint={<>A <Term term="preview">preview</Term> is a practice run you can read but never publish. A publishable run stops for your review too; a draft PR opens only when you confirm.</>}>
          <div className="flex w-fit gap-0 rounded-sm border border-border bg-ink" role="group" aria-label="Run mode">
            <button
              type="button"
              onClick={() => setDryRun(true)}
              aria-pressed={dryRun}
              className={cn(
                "px-4 py-2 text-[12px] font-medium",
                dryRun ? "bg-info/10 text-info" : "text-paper-muted hover:text-paper",
              )}
            >
              preview
            </button>
            <button
              type="button"
              onClick={() => setDryRun(false)}
              aria-pressed={!dryRun}
              className={cn(
                "px-4 py-2 text-[12px] font-medium border-l border-border",
                !dryRun ? "bg-signal/10 text-signal" : "text-paper-muted hover:text-paper",
              )}
            >
              publishable (you review first)
            </button>
          </div>
        </Row>

        <Row htmlFor="run-notes" label="Notes" hint="Optional guidance for the AI agent.">
          <textarea
            id="run-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. focus on security fixes, avoid license-encumbered files, skip tests/"
            className="rounded-lg w-full border border-border bg-ink px-3 py-3 text-[13px] text-paper placeholder:text-paper-faint focus:border-signal focus:outline-none resize-none"
          />
        </Row>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={state.kind === "pending"}
            className={cn(
              "rounded-full group inline-flex items-center gap-3 border px-5 py-3 text-[13px] transition",
              state.kind === "pending"
                ? "border-border text-paper-muted"
                : "border-signal bg-signal/10 text-paper hover:bg-signal/20",
            )}
          >
            {state.kind === "pending" ? (
              "Starting run..."
            ) : (
              <>
                <span className="text-signal">{claudeSignIn ? `Sign in with Claude & ${dryRun ? "preview" : "start"}` : dryRun ? "Generate preview" : "Start live run"}</span>
                <IconArrow size={14} className="text-signal transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>

          {state.kind === "ok" && (
            <div className="flex items-center gap-3 text-[12px]" aria-live="polite">
              <span className="text-ok flex items-center gap-1">
                <span aria-hidden>+</span> Run started
              </span>
              {state.dispatch_id && (
                <a
                  href={`/dispatches?dispatch=${encodeURIComponent(state.dispatch_id)}`}
                  className="text-signal hover:underline"
                >
                  View live run
                </a>
              )}
            </div>
          )}
          {state.kind === "err" && (
            <div className="text-[12px] text-alert flex items-center gap-1" role="alert">
              <span aria-hidden>x</span> {state.message}
            </div>
          )}
          {state.kind === "pending" && (
            <p className="basis-full text-xs text-paper-muted" role="status">
              Starting an isolated worker. This can take up to 90 seconds.
            </p>
          )}
        </div>
      </form>

      <aside className="col-span-12 overflow-hidden rounded-md border border-border bg-surface p-0 lg:col-span-4">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-paper">Before you start</h2>
        </div>
        <ol className="divide-y divide-border-soft px-4">
          {[
            "Use an issue URL to start a worker. Repository URLs open the issue scanner.",
            "Preview creates a patch to read. It can never be published; run the issue again to publish.",
            "A publishable run never posts by itself: it opens a draft PR from your GitHub account only after you read it and confirm.",
          ].map((item, index) => (
            <li key={item} className="grid grid-cols-[1.5rem_1fr] gap-2 py-4 text-xs leading-5 text-paper-muted">
              <span className="font-mono text-paper-faint">{String(index + 1).padStart(2, "0")}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <div className="border-t border-border px-4 py-3">
          <Link href="/dispatches" className="text-xs text-signal hover:underline">
            View run history <span aria-hidden>→</span>
          </Link>
        </div>
      </aside>
    </div>
  );
}

function Row({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 grid grid-cols-12 gap-4 items-start">
      <div className="col-span-12 md:col-span-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[12px] font-medium text-paper">{label}</label>
        ) : (
          <div className="text-[12px] font-medium text-paper">{label}</div>
        )}
        {hint && (
          <div className="mt-1 text-[11px] leading-relaxed text-paper-muted">
            {hint}
          </div>
        )}
      </div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}
