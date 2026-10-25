"use client";

// "Explain it in your own words" and "Practice review" on the review screen.
// The contributor explains the change (checked by one model call against the
// diff, after a local copy check), then answers two maintainer-style
// questions. Publish waits for both, plus the confirmation checkbox.
//
// This gate runs in the browser and is a comprehension aid, not security:
// the publish API does not depend on it beyond the optional explanation it
// puts in the PR. When the automatic check cannot run (no key, provider
// error, unusable reply), the written explanation is still required and the
// practice review is skipped, so an outage never blocks publishing.

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import type { ExplainContext } from "@/lib/explain";
import { COPY_MESSAGE, OWN_WORDS, looksCopied, type ExplanationCheck, type PracticeFeedback } from "@/lib/understanding";
import { changeRequest } from "./change-chat";

export const FALLBACK_MESSAGE = "The automatic check couldn't run. Your explanation will still be included in the PR.";
export const PRACTICE_INTRO = "Maintainers will ask questions like these. Answer them now so you're ready.";

/** What the publish request carries (lib/publish.ts parseAuthorWords). */
export type OwnWordsResult = { ready: boolean; text: string; checked: boolean; practiced: boolean };

type Answer = { draft: string; sent: string | null; feedback: PracticeFeedback | null; error: string | null };
type Saved = {
  text: string;
  checksUsed: number;
  result: (ExplanationCheck & { passed: boolean; forText: string }) | null;
  checkFailed: boolean;
  practiceFailed: boolean;
  questions: string[] | null;
  answers: Answer[];
};

const EMPTY: Saved = { text: "", checksUsed: 0, result: null, checkFailed: false, practiceFailed: false, questions: null, answers: [] };
const STORAGE_PREFIX = "opensrcer:own-words:";

function load(key: string): Saved {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + key) ?? "null") as Saved | null;
    return parsed && typeof parsed.text === "string" && Array.isArray(parsed.answers) ? { ...EMPTY, ...parsed } : EMPTY;
  } catch {
    return EMPTY; // storage blocked or corrupt: start over
  }
}

async function post(body: object): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/understand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(200_000) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function OwnWords({ storageKey, repo, title, context, copySources, practice = false, onResult, number }: {
  /** One per run, e.g. "run:<id>". */
  storageKey: string;
  repo?: string;
  title: string;
  context: ExplainContext;
  /** The AI's own words (diagnosis, PR text): an explanation must not copy them. */
  copySources: string[];
  /** A preview run: the same steps, nothing to unlock. */
  practice?: boolean;
  onResult: (result: OwnWordsResult) => void;
  /** The part number, hung in the margin by the sheet around it. */
  number?: React.ReactNode;
}) {
  const [s, setS] = useState<Saved>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"check" | "questions" | number | null>(null);
  const [copyWarning, setCopyWarning] = useState(false);
  const ids = { a: useId(), text: useId(), hint: useId(), b: useId() };

  useEffect(() => { setS(load(storageKey)); setLoaded(true); }, [storageKey]);
  useEffect(() => {
    if (!loaded) return;
    try { sessionStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(s)); } catch { /* storage blocked: kept for this view */ }
  }, [s, loaded, storageKey]);

  const text = s.text.trim();
  const lengthOk = text.length >= OWN_WORDS.min && text.length <= OWN_WORDS.max;
  const copied = lengthOk && looksCopied(text, copySources);
  const checked = Boolean(s.result?.passed && s.result.forText === text);
  const stale = Boolean(s.result && s.result.forText !== text);
  const checksLeft = Math.max(0, OWN_WORDS.checksPerRun - s.checksUsed);
  const practiced = Boolean(s.questions && s.answers.length === s.questions.length && s.answers.every((a) => a.sent));
  const aOk = checked || (s.checkFailed && lengthOk && !copied);
  const ready = aOk && (s.checkFailed || s.practiceFailed || practiced);
  useEffect(() => onResult({ ready, text, checked, practiced: checked && practiced }), [ready, text, checked, practiced, onResult]);

  const change = changeRequest(repo, title, context);

  async function loadQuestions() {
    setBusy("questions");
    try {
      const r = await post({ ...change, step: "questions" });
      const qs = r.data.questions;
      if (!r.ok || !Array.isArray(qs) || qs.length !== 2) throw new Error(String(r.data.error ?? `status ${r.status}`));
      setS((p) => ({ ...p, questions: qs as string[], answers: qs.map(() => ({ draft: "", sent: null, feedback: null, error: null })), practiceFailed: false }));
    } catch (error) {
      console.warn("[own-words] practice review unavailable:", error instanceof Error ? error.message : error);
      setS((p) => ({ ...p, practiceFailed: true }));
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    if (!lengthOk || busy !== null || checksLeft === 0) return;
    // Deterministic, before any model call: no spend on a copy.
    if (looksCopied(text, copySources)) { setCopyWarning(true); return; }
    setCopyWarning(false);
    setBusy("check");
    let passed = false;
    try {
      const r = await post({ ...change, step: "check", explanation: text });
      if (r.status === 400 && r.data.error === COPY_MESSAGE) { setCopyWarning(true); return; }
      if (!r.ok || typeof r.data.passed !== "boolean") throw new Error(String(r.data.error ?? `status ${r.status}`));
      const result = r.data as unknown as ExplanationCheck & { passed: boolean };
      passed = result.passed;
      setS((p) => ({ ...p, checksUsed: p.checksUsed + 1, checkFailed: false, result: { ...result, mistakes: result.mistakes ?? [], forText: text } }));
    } catch (error) {
      console.warn("[own-words] explanation check unavailable:", error instanceof Error ? error.message : error);
      setS((p) => ({ ...p, checkFailed: true }));
    } finally {
      setBusy(null);
    }
    if (passed && !s.questions) await loadQuestions();
  }

  async function answer(i: number) {
    const a = s.answers[i];
    const reply = a?.draft.trim() ?? "";
    if (!s.questions || reply.length < OWN_WORDS.answerMin || busy !== null) return;
    setBusy(i);
    const update = (patch: Partial<Answer>) => setS((p) => ({ ...p, answers: p.answers.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
    try {
      const r = await post({ ...change, step: "feedback", question: s.questions[i], answer: reply });
      if (!r.ok || typeof r.data.feedback !== "string") throw new Error(String(r.data.error ?? `status ${r.status}`));
      update({ sent: reply, feedback: { feedback: r.data.feedback, followUp: typeof r.data.followUp === "string" ? r.data.followUp : null }, error: null });
    } catch (error) {
      console.warn("[own-words] practice feedback unavailable:", error instanceof Error ? error.message : error);
      // Answering is what counts here; feedback is advice.
      update({ sent: reply, feedback: null, error: "Feedback couldn't load, but your answer counts." });
    } finally {
      setBusy(null);
    }
  }

  const covered = (ok: boolean | undefined, optional = false) => (ok ? "covered" : optional ? "not mentioned (optional)" : "missing");
  // A small dot before each line of the check result; drawn in CSS so the text stays exactly the result.
  const mark = "relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:size-1.5 before:rounded-full before:bg-current";
  const r = s.result;
  return (
    <>
      {/* The lesson, as a part of the review sheet: three questions, then your
          answer written on ruled paper, then a practice review. */}
      <section aria-labelledby={ids.a} className="relative mt-8 border-t border-border-soft pt-8">
        <div className="relative flex items-baseline gap-3">
          {number}
          <h4 id={ids.a} className="text-[19px] font-semibold tracking-[-0.01em] text-paper">Explain it in your own words</h4>
        </div>
        <p className="mt-3 max-w-2xl text-paper-dim">Maintainers want to know the person sending a change understands it.{practice ? " This run is a preview, so this is practice." : ""} In a few sentences, answer:</p>
        <ol className="mt-2 list-[lower-alpha] space-y-0.5 pl-6 text-[15px] text-paper-muted marker:font-mono marker:text-[12px] marker:text-paper-faint">
          <li>What was wrong?</li>
          <li>What did the change do?</li>
          <li>How do you know it works?</li>
        </ol>
        <label htmlFor={ids.text} className="label-mono mt-6 block">Your explanation</label>
        <textarea
          id={ids.text}
          aria-describedby={ids.hint}
          value={s.text}
          onChange={(e) => { setS((p) => ({ ...p, text: e.target.value })); setCopyWarning(false); }}
          maxLength={OWN_WORDS.max}
          rows={7}
          className="paper-field mt-1"
        />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p id={ids.hint} className="text-[14px] text-paper-muted">
            At least {OWN_WORDS.min} characters. It goes into the pull request under &quot;In the author&apos;s words&quot;.
          </p>
          <span className="font-mono text-[12px] tabular-nums text-paper-faint">{text.length} / {OWN_WORDS.min} minimum</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void check()} disabled={!lengthOk || busy !== null || checksLeft === 0} className="btn-quiet">
            {busy === "check" ? "Checking…" : "Check my explanation"}
          </button>
          <span className="font-mono text-[12px] text-paper-muted">{checksLeft === 1 ? "1 check left" : `${checksLeft} checks left`}</span>
        </div>
        <div aria-live="polite" className="mt-4 space-y-2 empty:hidden">
          {(copyWarning || (s.checkFailed && copied)) && <p className="text-alert">{COPY_MESSAGE}</p>}
          {r && !stale && (
            <>
              <ul className="space-y-1 font-medium">
                <li className={cn(mark, r.rootCause ? "text-ok" : "text-alert")}>What was wrong: {covered(r.rootCause)}</li>
                <li className={cn(mark, r.change ? "text-ok" : "text-alert")}>What the change did: {covered(r.change)}</li>
                <li className={cn(mark, r.evidence ? "text-ok" : "text-paper-muted")}>How you know it works: {covered(r.evidence, true)}</li>
              </ul>
              {r.mistakes.map((m) => <p key={m} className="text-alert">That&apos;s not quite it: {m}</p>)}
              <p className="text-paper-dim">Tip: {r.tip}</p>
              <p className={cn("text-[16px] font-semibold", r.passed ? "text-ok" : "text-paper")}>{r.passed ? "Your explanation covers the change." : "Not there yet: fix what's above, then check again."}</p>
            </>
          )}
          {stale && <p className="text-paper-muted">You&apos;ve edited it since the last check. Check it again.</p>}
          {checksLeft === 0 && !checked && !s.checkFailed && <p className="text-alert">No checks left for this run.</p>}
          {(s.checkFailed || s.practiceFailed) && <p role="alert" className="text-paper">{FALLBACK_MESSAGE}</p>}
        </div>
      </section>

      {checked && !s.practiceFailed && (
        <section aria-labelledby={ids.b} className="mt-8">
          <h4 id={ids.b} className="text-[17px] font-semibold tracking-[-0.01em] text-paper">Practice review</h4>
          <p className="mt-2 max-w-2xl text-paper-dim">{PRACTICE_INTRO}</p>
          {busy === "questions" && <p role="status" className="mt-4 text-paper-muted">Writing 2 review questions about this change…</p>}
          {!s.questions && busy !== "questions" && (
            <button type="button" onClick={() => void loadQuestions()} className="btn-quiet mt-4">Get the practice questions</button>
          )}
          {s.questions?.map((q, i) => {
            const a = s.answers[i];
            const qid = `${ids.b}-q${i}`;
            return (
              <div key={q} className="mt-6 border-l border-border-strong pl-4 sm:pl-5">
                <p id={qid} className="text-[16px] leading-[1.5] text-paper"><span className="font-semibold">Reviewer:</span> {q}</p>
                <label htmlFor={`${qid}-a`} className="sr-only">Your answer to: {q}</label>
                <textarea
                  id={`${qid}-a`}
                  value={a?.draft ?? ""}
                  onChange={(e) => setS((p) => ({ ...p, answers: p.answers.map((x, j) => (j === i ? { ...x, draft: e.target.value } : x)) }))}
                  maxLength={OWN_WORDS.answerMax}
                  rows={3}
                  placeholder="Your answer"
                  className="paper-field mt-2"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void answer(i)} disabled={(a?.draft.trim().length ?? 0) < OWN_WORDS.answerMin || busy !== null} className="btn-quiet" data-size="sm">
                    {busy === i ? "Sending…" : a?.sent ? "Send again" : "Send answer"}
                  </button>
                  <span className="font-mono text-[12px] text-paper-muted">at least {OWN_WORDS.answerMin} characters</span>
                </div>
                <div aria-live="polite" className="empty:hidden">
                  {a?.feedback && <p className="mt-3 text-paper-dim"><span className="font-semibold text-paper">Feedback:</span> {a.feedback.feedback}</p>}
                  {a?.feedback?.followUp && <p className="mt-1 text-paper-muted">A reviewer might follow up: {a.feedback.followUp}</p>}
                  {a?.error && <p className="mt-3 text-paper-muted">{a.error}</p>}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
