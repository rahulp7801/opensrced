"use client";

// The publish gate on the run page: the frozen preview (PR text, evidence,
// warnings, blockers) and the only way to open a PR. Publishing needs an
// explicit confirmation and uses exactly what is shown here. A preview-only
// (dry) run can never publish; it offers to start the issue again as a
// publishable run instead of leaving the reader at a dead end.

import { useCallback, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { publishSteps } from "@/lib/beginner-guide";
import { projectRules, rulesText, RULE_STATUS_LABEL, type RuleRow, type RuleStatus, type RulesPreview } from "@/lib/project-rules";
import { cn } from "@/lib/utils";
import { ChangeChat } from "./change-chat";
import { OwnWords, type OwnWordsResult } from "./own-words";
import { Term } from "./term";

type Preview = RulesPreview & {
  title: string;
  body: string;
  files: string[];
  signoff: boolean;
  executed: boolean;
  /** The frozen patch (GET /api/dispatches/<id>/preview). */
  diff?: string;
  diagnosis?: string;
  blockers: string[];
  warnings: string[];
  draft_issue_comment?: string;
  /** Maintainers ask for discussion first: the comment is the suggested path. */
  ask_first?: boolean;
  cases?: Array<{ variant: string; test: string | null }>;
  confirmation: string;
  publishable: boolean;
  /** A follow-up run: publishing pushes one commit to this PR. */
  followup_pr?: string;
};

export function PublishPanel({ dispatchId, repo, dryRun = false, rerun, onPublished }: {
  dispatchId: string;
  /** The run's repository (owner/name or its GitHub URL), for "Ask about this change". */
  repo?: string;
  /** The run was a preview: show how to get to a publishable run. */
  dryRun?: boolean;
  /** The issue this run was for, to start it again as a publishable run. */
  rerun?: { repoUrl: string; issue: number };
  onPublished?: (url: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // "Explain it in your own words" + "Practice review": a comprehension aid
  // in the browser, not a security control (see components/own-words.tsx).
  const [ownWords, setOwnWords] = useState<OwnWordsResult | null>(null);
  const onOwnWords = useCallback((r: OwnWordsResult) => setOwnWords(r), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dispatches/${dispatchId}/preview`, { signal: controller.signal })
      .then(async (r) => (r.ok ? setPreview(await r.json()) : r.status === 404 ? null : setLoadError("Could not load the preview.")))
      .catch(() => { if (!controller.signal.aborted) setLoadError("Could not load the preview."); });
    return () => controller.abort();
  }, [dispatchId]);

  if (loadError) return <div role="alert" className="border-b border-border-soft bg-alert-dim/30 px-5 py-3 text-[15px] text-alert sm:px-8">{loadError}</div>;
  if (!preview) return null;

  async function publish() {
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/dispatches/${dispatchId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          ...(askOwnWords && ownWords?.ready ? { authorExplanation: ownWords.text, explanationChecked: ownWords.checked, practiceAnswered: ownWords.practiced } : {}),
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const result = (await r.json().catch(() => ({}))) as { error?: string; pr_url?: string };
      if (!r.ok || !result.pr_url) throw new Error(result.error ?? "Could not publish.");
      onPublished?.(result.pr_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish.");
    } finally {
      setPending(false);
    }
  }

  const v = preview.verification;
  const verdict = !preview.executed ? "not verified (no code was run)" : !v ? "not verified" : `${v.status} — ${v.reason}`;
  const canPublish = preview.publishable && preview.blockers.length === 0;
  const rules = projectRules(preview);
  // A follow-up only adds a commit (no PR text to carry the explanation).
  const askOwnWords = (canPublish || dryRun) && !preview.followup_pr;
  const gateOpen = !askOwnWords || Boolean(ownWords?.ready);
  const context = {
    description: `${preview.diagnosis ? `The agent's diagnosis:\n${preview.diagnosis}\n\n` : ""}PR text:\n${preview.body}`,
    diff: preview.diff,
    verification: `Verification: ${verdict}${v?.regression ? `; regression check: ${v.regression.replace(/_/g, " ")}` : ""}`,
    rules: rulesText(rules),
  };
  const comment = preview.draft_issue_comment;
  const commentBlock = comment && (
    <>
      <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-surface p-4 font-sans text-[15px] leading-[1.6] text-paper-dim shadow-[inset_0_0_0_1px_var(--color-border-soft)]">{comment}</pre>
      <button className="link mt-1 inline-flex min-h-10 items-center text-[13px] sm:min-h-6" onClick={() => void copyText(comment).then(() => setCopied(true))}>
        {copied ? "copied" : "copy comment"}
      </button>
    </>
  );
  const verified = v?.status === "verified";
  // The publish gate is a short lesson: read the change, see the project's
  // rules, explain it, practise the review, then publish. Calm type and room
  // to breathe; status lives in chips, not in coloured paragraphs.
  return (
    <section aria-label={dryRun ? "Preview result" : "Review before publishing"} className="border-b border-border-soft bg-ink-2 px-5 py-8 text-[16px] leading-[1.6] sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="label-mono">{dryRun ? "Practice run" : "Before anything is posted"}</p>
          <h3 className="display mt-2 text-[30px] leading-none text-paper sm:text-[36px]">{dryRun ? "Preview: read the fix" : "Review before publishing"}</h3>
        </div>
        <span className="chip whitespace-normal" data-tone={verified ? "ok" : "alert"}><Term term="verified">Verification</Term>: {verdict}</span>
      </div>
      {dryRun ? (
        <div className="callout mt-5" data-tone="info">
          <p className="text-[16px] font-semibold text-paper">This was a <Term term="preview">preview</Term>, so it can&apos;t be published.</p>
          <p className="mt-1.5 max-w-2xl text-paper-dim">
            Nothing was posted anywhere. If the fix below looks right and you want to send it to the project, run this issue again
            as a publishable run. It starts fresh (a new run, with its own cost), then stops here for your review: nothing is posted until you confirm.
          </p>
          {rerun && <RerunButton {...rerun} />}
        </div>
      ) : (
        <p className="mt-3 max-w-2xl text-[16px] text-paper-muted">Nothing has been posted yet. Read the change and the evidence below first.</p>
      )}
      {preview.blockers.map((b) => <p key={b} role="alert" className="callout mt-4 font-medium" data-tone="alert">Blocked: {b}</p>)}
      {preview.warnings.map((w) => <p key={w} className="mt-3 text-paper-dim">Note: {w}</p>)}
      {preview.cases && preview.cases.length > 0 && (
        <div className="mt-4">
          <p className="text-paper">Cases covered (the agent&apos;s list of reported variants):</p>
          <ul className="mt-1 list-disc pl-5 text-paper-dim">
            {preview.cases.map((c) => (
              <li key={c.variant} className={c.test ? "" : "text-alert"}>{c.variant} → {c.test ?? "not covered"}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="group mt-5 rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-paper">
          <span aria-hidden className="text-paper-muted transition-transform group-open:rotate-90">›</span>
          <span className="min-w-0"><span className="font-semibold">PR text:</span> {preview.title}</span>
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-border-soft px-4 py-3 font-sans text-[15px] leading-[1.6] text-paper-dim">{preview.body}</pre>
      </details>
      {/* The suggested path where maintainers ask for discussion (and on older
          previews, which drafted a comment only then); an option everywhere else. */}
      {comment && (preview.ask_first !== false ? (
        <div className="callout mt-4" data-tone="signal">
          <p className="font-medium text-paper">Suggested instead: ask on the issue first. Post this yourself if it reads right:</p>
          {commentBlock}
        </div>
      ) : (
        <details className="group mt-3 rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-paper">
            <span aria-hidden className="text-paper-muted transition-transform group-open:rotate-90">›</span>
            <span className="min-w-0">Not sure the maintainers want this? Ask on the issue first (optional)</span>
          </summary>
          <div className="border-t border-border-soft px-4 py-3">
            <p className="text-paper-dim">
              In busy projects a short comment before a pull request avoids duplicate work. opensrcer never posts it; copy it to the issue on GitHub if it reads right.
            </p>
            {commentBlock}
          </div>
        </details>
      ))}
      <ProjectRules rows={rules} />
      <ChangeChat
        storageKey={`run:${dispatchId}`}
        repo={repo}
        title={preview.title}
        context={context}
      />
      {askOwnWords && (
        <OwnWords
          storageKey={`run:${dispatchId}`}
          repo={repo}
          title={preview.title}
          context={context}
          copySources={[preview.diagnosis ?? "", preview.body]}
          practice={dryRun}
          onResult={onOwnWords}
        />
      )}
      {canPublish && (
        <>
          <div className="mt-8 border-t-2 border-paper pt-5">
            <h4 className="text-[19px] font-semibold tracking-[-0.01em] text-paper">What happens when you publish</h4>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {publishSteps({ files: preview.files.length, signoff: preview.signoff, followupPr: preview.followup_pr }).map((s, i) => (
                <li key={s} className="grid grid-cols-[1.75rem_1fr] gap-1 text-paper-dim">
                  <span className="label-mono pt-[3px]">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex flex-wrap items-center gap-x-3 text-[14px] text-paper-muted">
              <span>Words used here:</span>
              {preview.followup_pr ? (
                <><Term term="pull request" />{preview.signoff && <Term term="sign-off" />}</>
              ) : (
                <><Term term="fork" /><Term term="branch" /><Term term="draft PR" /><Term term="AI disclosure" />{preview.signoff && <Term term="sign-off" />}</>
              )}
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-border)] sm:flex-row sm:flex-wrap sm:items-center sm:p-5">
            <label className="flex min-h-10 flex-1 items-center gap-3 text-[16px] text-paper">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-6 w-6 shrink-0" />
              {preview.confirmation}
            </label>
            <button
              onClick={publish}
              disabled={!confirmed || pending || !gateOpen}
              className="btn-primary min-h-12 px-6 text-[16px]"
            >
              {pending ? "publishing…" : preview.followup_pr ? "Push follow-up commit" : "Publish draft PR"}
            </button>
            {!gateOpen && <span className="basis-full text-[14px] text-paper-muted">To publish: explain the change in your own words, answer the practice review, and tick the box.</span>}
            {error && <span role="alert" className="basis-full text-alert">{error}</span>}
          </div>
        </>
      )}
    </section>
  );
}

const STATUS_TONE: Record<RuleStatus, string | undefined> = {
  done: "ok",
  action: "signal",
  blocked: "alert",
  check: "signal",
  unknown: undefined,
  none: undefined,
};

/** Each rule the project sets and how this run handled it (lib/project-rules.ts).
 *  Rows that need the user, or that stop publishing, stand out. */
function ProjectRules({ rows }: { rows: RuleRow[] }) {
  return (
    <section aria-labelledby="project-rules-heading" className="mt-8">
      <h4 id="project-rules-heading" className="text-[19px] font-semibold tracking-[-0.01em] text-paper">This project&apos;s rules</h4>
      <p className="mt-1 max-w-2xl text-paper-muted">Why this matters: maintainers set these rules, and following them is what makes a contribution welcome.</p>
      <ul className="mt-4 divide-y divide-border-soft overflow-hidden rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border-soft)]">
        {rows.map((r) => (
          <li key={r.id} className={cn("px-4 py-3", r.status === "action" ? "bg-signal-faint/60" : r.status === "blocked" ? "bg-alert-dim/25" : "")}>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="chip shrink-0" data-tone={STATUS_TONE[r.status]}>{RULE_STATUS_LABEL[r.status]}</span>
              <span className="font-semibold text-paper">{r.term ? <Term term={r.term}>{r.label}</Term> : r.label}:</span>
              <span className={r.status === "action" || r.status === "blocked" ? "text-paper" : "text-paper-dim"}>{r.text}</span>
            </div>
            {r.detail && <p className="mt-1 break-words text-[14px] text-paper-muted">{r.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Start the same issue as a publishable (live) run. The new run still ends at
 *  this review step; nothing is posted without the confirmation above. */
function RerunButton({ repoUrl, issue }: { repoUrl: string; issue: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/run/agentic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl, issue_number: issue, dry_run: false }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = (await res.json().catch(() => ({}))) as { dispatch_id?: unknown; message?: string; error?: string };
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Could not start the run.");
      if (typeof json.dispatch_id !== "string" || !json.dispatch_id.trim()) throw new Error("The server returned an invalid run response. Please try again.");
      window.location.href = `/dispatches?dispatch=${encodeURIComponent(json.dispatch_id)}`;
    } catch (e) {
      setError(e instanceof Error && e.name === "TimeoutError" ? "Starting the run timed out. Please try again." : e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button onClick={start} disabled={pending} className="btn-primary">
        {pending ? "Starting…" : "Run again, ready to publish"}
      </button>
      {error && <span role="alert" className="text-alert">{error}</span>}
    </div>
  );
}
