"use client";

// The publish gate on the run page: the frozen preview (PR text, evidence,
// warnings, blockers) and the only way to open a PR. Publishing needs an
// explicit confirmation and uses exactly what is shown here. A preview-only
// (dry) run can never publish; it offers to start the issue again as a
// publishable run instead of leaving the reader at a dead end.
//
// It reads as one signed document, not a form: one sheet of paper, numbered
// parts with the numbers hanging in the margin (cobalt only on the part you
// are on), the project's rules as definition rows, the explanation written
// on ruled paper, a sign line with your name, and footnotes for the words.

/* eslint-disable @next/next/no-img-element -- OAuth avatar hosts are user-controlled. */

import { useCallback, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { publishSteps } from "@/lib/beginner-guide";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";
import { projectRules, rulesText, RULE_STATUS_LABEL, type RuleRow, type RuleStatus, type RulesPreview } from "@/lib/project-rules";
import { useCurrentUser } from "@/lib/use-current-user";
import { safeAvatarUrl } from "@/lib/avatar-url";
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

/** Added and removed lines in a unified diff (file headers excluded). */
function diffCounts(diff: string | undefined): { add: number; del: number } | null {
  if (!diff) return null;
  let add = 0;
  let del = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) add++;
    else if (line.startsWith("-")) del++;
  }
  return { add, del };
}

export function PublishPanel({ dispatchId, repo, issue, dryRun = false, rerun, onPublished }: {
  dispatchId: string;
  /** The run's repository (owner/name or its GitHub URL), for "Ask about this change". */
  repo?: string;
  /** The issue number, for the header line. */
  issue?: number;
  /** The run was a preview: show how to get to a publishable run. */
  dryRun?: boolean;
  /** The issue this run was for, to start it again as a publishable run. */
  rerun?: { repoUrl: string; issue: number };
  onPublished?: (url: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [signedAt, setSignedAt] = useState<Date | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // "Explain it in your own words" + "Practice review": a comprehension aid
  // in the browser, not a security control (see components/own-words.tsx).
  const [ownWords, setOwnWords] = useState<OwnWordsResult | null>(null);
  const onOwnWords = useCallback((r: OwnWordsResult) => setOwnWords(r), []);
  // The signature uses only what the session already has (no new requests).
  const { user } = useCurrentUser();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dispatches/${dispatchId}/preview`, { signal: controller.signal })
      .then(async (r) => (r.ok ? setPreview(await r.json()) : r.status === 404 ? null : setLoadError("Could not load the preview.")))
      .catch(() => { if (!controller.signal.aborted) setLoadError("Could not load the preview."); });
    return () => controller.abort();
  }, [dispatchId]);

  if (loadError) return <div role="alert" className="callout mt-6 text-[15px]" data-tone="alert">{loadError}</div>;
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
      <pre className="mt-3 whitespace-pre-wrap border-l border-border-strong pl-4 font-sans text-[16px] leading-[1.65] text-paper-dim">{comment}</pre>
      <button className="link mt-1 inline-flex min-h-10 items-center text-[14px] sm:min-h-6" onClick={() => void copyText(comment).then(() => setCopied(true))}>
        {copied ? "copied" : "copy comment"}
      </button>
    </>
  );
  const verified = v?.status === "verified";
  const counts = diffCounts(preview.diff);
  const repoName = repo?.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");

  // Footnotes: each glossary word gets a number the first time it appears,
  // in reading order, and the Notes at the end of the sheet define them.
  const notes: GlossaryTerm[] = [];
  const note = (t: GlossaryTerm) => {
    if (!notes.includes(t)) notes.push(t);
    return notes.indexOf(t) + 1;
  };

  // Parts: 1 the change, 2 the rules, 3 your explanation, 4 publishing. The
  // part you are on gets the page's one cobalt mark.
  const current = askOwnWords && !gateOpen ? 3 : canPublish ? 4 : null;
  const words: GlossaryTerm[] = preview.followup_pr
    ? ["pull request", ...(preview.signoff ? (["sign-off"] as const) : [])]
    : ["fork", "branch", "draft PR", "AI disclosure", ...(preview.signoff ? (["sign-off"] as const) : [])];
  // Number every footnoted word now, in reading order: child components
  // render after this function returns, so the Notes below would miss them.
  note("verified");
  if (dryRun) note("preview");
  for (const r of rules) if (r.term) note(r.term);
  if (canPublish) words.forEach(note);

  return (
    <section
      aria-label={dryRun ? "Preview result" : "Review before publishing"}
      className="mt-8 w-full max-w-[720px] rounded-2xl bg-surface px-5 py-8 text-[16px] leading-[1.6] shadow-[inset_0_0_0_1px_var(--color-border-soft)] sm:px-14 sm:py-12"
    >
      {/* The header line: what this sheet is about, in mono. */}
      <p className="meta">
        <span>{dryRun ? "practice" : "review"}</span>
        <span>run {dispatchId}</span>
        {repoName && <span>{repoName}{issue !== undefined ? `#${issue}` : ""}</span>}
        <span>nothing posted yet</span>
      </p>
      <h3 className="display mt-3 text-[30px] leading-[1.05] text-paper">{dryRun ? "Preview: read the fix" : "Review before publishing"}</h3>
      <p className="chip mt-3 whitespace-normal text-[15px]" data-tone={verified ? "ok" : "alert"}>
        <span><Term term="verified" n={note("verified")}>Verification</Term>: {verdict}</span>
      </p>
      {dryRun ? (
        <div className="mt-5 border-l-2 border-info pl-4">
          <p className="font-semibold text-paper">This was a <Term term="preview" n={note("preview")}>preview</Term>, so it can&apos;t be published.</p>
          <p className="mt-1.5 text-paper-dim">
            Nothing was posted anywhere. If the fix below looks right and you want to send it to the project, run this issue again
            as a publishable run. It starts fresh (a new run, with its own cost), then stops here for your review: nothing is posted until you confirm.
          </p>
          {rerun && <RerunButton {...rerun} />}
        </div>
      ) : (
        <p className="mt-2 text-paper-muted">Nothing has been posted yet. Read the change and the evidence below first.</p>
      )}
      {preview.blockers.map((b) => <p key={b} role="alert" className="mt-4 font-medium text-alert">Blocked: {b}</p>)}
      {preview.warnings.map((w) => <p key={w} className="mt-3 text-paper-dim">Note: {w}</p>)}
      <ChangeChat
        storageKey={`run:${dispatchId}`}
        repo={repo}
        title={preview.title}
        context={context}
      />

      <Part n={1} current={false} title="The change" id={`gate-change-${dispatchId}`}>
        <p className="text-[17px] font-semibold leading-snug text-paper">{preview.title}</p>
        <p className="meta mt-1.5">
          <span>{preview.files.length} file{preview.files.length === 1 ? "" : "s"}</span>
          {counts && <span>+{counts.add} −{counts.del}</span>}
          {preview.diff && <a href="#run-patch">read the diff ↓</a>}
        </p>
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
        <details className="group mt-4 border-t border-border-soft">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-paper">
            <span aria-hidden className="font-mono text-paper-muted transition-transform group-open:rotate-90">›</span>
            <span className="min-w-0"><span className="font-semibold">PR text:</span> {preview.title}</span>
          </summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-l border-border-strong pb-2 pl-4 font-sans text-[15px] leading-[1.65] text-paper-dim">{preview.body}</pre>
        </details>
        {/* The suggested path where maintainers ask for discussion (and on older
            previews, which drafted a comment only then); an option everywhere else. */}
        {comment && (preview.ask_first !== false ? (
          <div className="mt-4 border-t border-border-soft pt-4">
            <p className="font-medium text-paper">Suggested instead: ask on the issue first. Post this yourself if it reads right:</p>
            {commentBlock}
          </div>
        ) : (
          <details className="group border-t border-border-soft">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-paper">
              <span aria-hidden className="font-mono text-paper-muted transition-transform group-open:rotate-90">›</span>
              <span className="min-w-0">Not sure the maintainers want this? Ask on the issue first (optional)</span>
            </summary>
            <div className="pb-3">
              <p className="text-paper-dim">
                In busy projects a short comment before a pull request avoids duplicate work. opensrcer never posts it; copy it to the issue on GitHub if it reads right.
              </p>
              {commentBlock}
            </div>
          </details>
        ))}
      </Part>

      <Part n={2} current={false} title="This project's rules" id={`gate-rules-${dispatchId}`}>
        <ProjectRules rows={rules} note={note} />
      </Part>

      {askOwnWords && (
        <OwnWords
          storageKey={`run:${dispatchId}`}
          repo={repo}
          title={preview.title}
          context={context}
          copySources={[preview.diagnosis ?? "", preview.body]}
          practice={dryRun}
          onResult={onOwnWords}
          number={<PartNumber n={3} current={current === 3} />}
        />
      )}

      {canPublish && (
        <>
          <Part n={askOwnWords ? 4 : 3} current={current === 4} title="What happens when you publish" id={`gate-publish-${dispatchId}`}>
            <ol className="space-y-2.5">
              {publishSteps({ files: preview.files.length, signoff: preview.signoff, followupPr: preview.followup_pr }).map((s, i) => (
                <li key={s} className="grid grid-cols-[1.5rem_1fr] text-paper-dim">
                  <span aria-hidden className="pt-[3px] font-mono text-[12px] text-paper-faint">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex flex-wrap items-center gap-x-4 text-[14px] text-paper-muted">
              <span>Words used here:</span>
              {words.map((t) => <Term key={t} term={t} n={note(t)} />)}
            </p>
          </Part>

          {/* The sign line: a rule, your tick, your name, then the one button. */}
          <div className="mt-10 border-t border-paper pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <label className="flex min-h-10 max-w-[30rem] items-start gap-3 text-[16px] leading-[1.5] text-paper">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => { setConfirmed(e.target.checked); setSignedAt(e.target.checked ? new Date() : null); }}
                  className="h-6 w-6 shrink-0"
                />
                {preview.confirmation}
              </label>
              <Signature user={user} signedAt={signedAt} />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                onClick={publish}
                disabled={!confirmed || pending || !gateOpen}
                className="btn-primary min-h-11 px-5 text-[15px]"
              >
                {pending ? "publishing…" : preview.followup_pr ? "Push follow-up commit" : "Publish draft PR"}
              </button>
              {!gateOpen && <span className="text-[14px] text-paper-muted">To publish: explain the change in your own words, answer the practice review, and tick the box.</span>}
              {error && <span role="alert" className="basis-full text-alert">{error}</span>}
            </div>
          </div>
        </>
      )}

      {/* Notes: the footnoted words, defined once, readable on any screen. */}
      <div className="mt-10 border-t border-border-soft pt-5">
        <h4 className="label-mono">Notes</h4>
        <ol className="mt-2 space-y-1.5 text-[14px] leading-[1.55] text-paper-muted">
          {notes.map((t, i) => (
            <li key={t} id={`fn-${dispatchId}-${i + 1}`} className="grid grid-cols-[1.5rem_1fr]">
              <span className="font-mono text-[12px] leading-[1.9] text-paper-faint">{i + 1}</span>
              <span><span className="text-paper-dim">{t.charAt(0).toUpperCase() + t.slice(1)}:</span> {GLOSSARY[t]}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** A part number hanging in the sheet's left margin; cobalt only on the part you are on. */
export function PartNumber({ n, current }: { n: number; current: boolean }) {
  return (
    <span aria-hidden className={cn("font-mono text-[12px] leading-[2.4] sm:absolute sm:-left-9 sm:top-0", current ? "font-semibold text-signal" : "text-paper-faint")}>
      {n}
    </span>
  );
}

function Part({ n, current, title, id, children }: { n: number; current: boolean; title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="relative mt-8 border-t border-border-soft pt-8">
      <div className="relative flex items-baseline gap-3">
        <PartNumber n={n} current={current} />
        <h4 id={id} className="text-[19px] font-semibold tracking-[-0.01em] text-paper">{title}</h4>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** The signer: the session's avatar and GitHub handle (or name), and the time
 *  the box was ticked. Nothing is shown that the session does not already have. */
function Signature({ user, signedAt }: { user: ReturnType<typeof useCurrentUser>["user"]; signedAt: Date | null }) {
  if (!user) return null;
  const handle = typeof user.nickname === "string" && user.nickname ? `@${user.nickname}` : typeof user.name === "string" ? user.name : null;
  if (!handle) return null;
  const picture = safeAvatarUrl(user.picture);
  return (
    <div className="flex shrink-0 items-center gap-2.5 sm:pt-0.5">
      {picture ? (
        <img src={picture} alt="" width={24} height={24} className="size-6 rounded-full" />
      ) : (
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-paper-dim shadow-[inset_0_0_0_1px_var(--color-border)]">{handle.replace(/^@/, "").charAt(0).toUpperCase()}</span>
      )}
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-paper">{handle}</span>
        <span className="block font-mono text-[12px] text-paper-faint">
          {signedAt ? `signed today, ${signedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "not signed yet"}
        </span>
      </span>
    </div>
  );
}

const STATUS_TONE: Record<RuleStatus, string | undefined> = {
  done: "ok",
  action: "signal",
  blocked: "alert",
  check: "info",
  unknown: undefined,
  none: undefined,
};

/** Each rule the project sets and how this run handled it (lib/project-rules.ts),
 *  as definition rows: the rule on the left, its state in mono on the right.
 *  The state comes first in the markup so it is read first. */
function ProjectRules({ rows, note }: { rows: RuleRow[]; note: (t: GlossaryTerm) => number }) {
  return (
    <div>
      <p className="max-w-2xl text-paper-muted">Why this matters: maintainers set these rules, and following them is what makes a contribution welcome.</p>
      <ul className="mt-4">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border-soft py-3 sm:flex-nowrap">
            <span className="chip order-2 shrink-0 font-mono text-[12.5px] font-normal sm:ml-auto" data-tone={STATUS_TONE[r.status]}>{RULE_STATUS_LABEL[r.status]}</span>
            <div className="order-1 min-w-0 basis-full sm:basis-auto">
              <span className="text-[15px] font-medium text-paper">{r.term ? <Term term={r.term} n={note(r.term)}>{r.label}</Term> : r.label}</span>
              {" "}
              <span className={cn("text-[15px]", r.status === "action" || r.status === "blocked" ? "text-paper" : "text-paper-muted")}>{r.text}</span>
              {r.detail && <p className="mt-1 break-words text-[14px] text-paper-muted">{r.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
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
