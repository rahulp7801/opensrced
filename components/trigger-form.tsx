"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
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
  // Publishable by default: it still stops for review before anything is
  // posted, while a preview is a paid run that can never be published.
  const [dryRun, setDryRun] = useState(false);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  // True when this run will be paid by the user's Claude plan through a
  // sign-in inside the run's worker (hosted, OPENSRCER_HOSTED_SUBSCRIPTION=1).
  const [claudeSignIn, setClaudeSignIn] = useState(false);
  // False when no payment method is ready: the same check as the setup banner
  // (components/api-key-gate.tsx). Null while unknown, so the form stays usable
  // if the read fails; the server refuses an unpaid run either way.
  const [paymentReady, setPaymentReady] = useState<boolean | null>(null);
  useEffect(() => {
    function check() {
      fetch("/api/settings/keys").then((res) => (res.ok ? res.json() : null)).then((s: { hostedSubscription?: boolean; providerOrder?: string[]; offered?: string[]; ready?: boolean; anthropic?: boolean } | null) => {
        const first = s?.providerOrder?.find((p) => s.offered?.includes(p));
        setClaudeSignIn(Boolean(s?.hostedSubscription && first === "claude-subscription"));
        setPaymentReady(s ? Boolean(s.ready ?? s.anthropic) : null);
      }).catch(() => {});
    }
    check();
    window.addEventListener("opensrcer-keys-updated", check);
    return () => window.removeEventListener("opensrcer-keys-updated", check);
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
        className="card col-span-12 p-6 sm:p-8 lg:col-span-8"
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
            className="field bg-ink-2"
          />
        </Row>

        <Row label="Mode" hint={<>A <Term term="preview">preview</Term> is a practice run you can read but never publish. A publishable run stops for your review too; a draft PR opens only when you confirm.</>}>
          {/* A segmented control: two pills in one well; the chosen one inks in. */}
          <div className="flex w-full flex-col gap-1 rounded-[24px] bg-ink-2 p-1 shadow-[inset_0_0_0_1px_var(--color-border-soft)] sm:w-fit sm:flex-row" role="group" aria-label="Run mode">
            <button
              type="button"
              onClick={() => setDryRun(true)}
              aria-pressed={dryRun}
              className="pill"
              data-quiet={dryRun ? undefined : ""}
            >
              preview
            </button>
            <button
              type="button"
              onClick={() => setDryRun(false)}
              aria-pressed={!dryRun}
              className="pill"
              data-quiet={!dryRun ? undefined : ""}
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
            className="field resize-none bg-ink-2"
          />
        </Row>

        <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-border-soft pt-6">
          <button
            type="submit"
            disabled={state.kind === "pending" || paymentReady === false}
            aria-describedby={paymentReady === false ? "run-payment-needed" : undefined}
            className="btn-primary group min-h-12 gap-3 px-6 text-[16px]"
          >
            {state.kind === "pending" ? (
              "Starting run..."
            ) : (
              <>
                <span>{claudeSignIn ? `Sign in with Claude & ${dryRun ? "preview" : "start"}` : dryRun ? "Generate preview" : "Start publishable run"}</span>
                <IconArrow size={15} className="transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>

          {paymentReady === false && state.kind !== "pending" && (
            <p id="run-payment-needed" className="text-[15px] text-paper-muted">
              Set up how runs are paid for in{" "}
              <Link href="/crucible" className="link">Settings</Link>{" "}
              before starting a run.
            </p>
          )}
          {state.kind === "ok" && (
            <div className="flex items-center gap-3 text-[15px]" aria-live="polite">
              <span className="flex items-center gap-1 font-medium text-ok">
                <span aria-hidden>+</span> Run started
              </span>
              {state.dispatch_id && (
                <a
                  href={`/dispatches?dispatch=${encodeURIComponent(state.dispatch_id)}`}
                  className="link"
                >
                  View live run
                </a>
              )}
            </div>
          )}
          {state.kind === "err" && (
            <div className="flex items-center gap-1 text-[15px] text-alert" role="alert">
              <span aria-hidden>x</span> {state.message}
            </div>
          )}
          {state.kind === "pending" && (
            <p className="basis-full text-[15px] text-paper-muted" role="status">
              Starting an isolated worker. This can take up to 90 seconds.
            </p>
          )}
        </div>
      </form>

      <aside className="card col-span-12 self-start overflow-hidden lg:col-span-4">
        <div className="px-6 pt-6">
          <h2 className="display text-[24px] leading-none text-paper">Before you start</h2>
        </div>
        <ol className="mt-2 divide-y divide-border-soft px-6">
          {[
            "Paste a link to one issue to start the AI agent on it. A link to a whole repository opens its issue list, so you can pick one first.",
            "Preview creates a patch to read. It can never be published; run the issue again to publish.",
            "A publishable run never posts by itself: it opens a draft PR from your GitHub account only after you read it and confirm.",
          ].map((item, index) => (
            <li key={item} className="grid grid-cols-[2rem_1fr] gap-2 py-4 text-[15px] leading-[1.55] text-paper-dim">
              <span className="label-mono pt-0.5">{index + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <div className="border-t border-border-soft px-6 py-3">
          <Link href="/dispatches" className="link inline-flex min-h-10 items-center gap-1 text-[15px] font-medium">
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
    <div className="mb-7 grid grid-cols-12 items-start gap-x-6 gap-y-2.5">
      <div className="col-span-12 md:col-span-4">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[16px] font-semibold text-paper">{label}</label>
        ) : (
          <div className="text-[16px] font-semibold text-paper">{label}</div>
        )}
        {hint && (
          <div className="mt-1 text-[14px] leading-[1.55] text-paper-muted">
            {hint}
          </div>
        )}
      </div>
      <div className="col-span-12 md:col-span-8">{children}</div>
    </div>
  );
}
