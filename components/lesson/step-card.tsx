"use client";

// One lesson step as a card (PLAN §7.4): the question, the answer box,
// Check, the hint ladder (§7.5) and the grade's feedback. The server grades
// and saves; this only shows what came back.

import { useId, useState } from "react";
import type { AnswerKeyStatus, StepId } from "@/lib/lesson/machine";
import type { StepGrade } from "@/lib/lesson/store";
import { cn } from "@/lib/utils";
import type { PublicLesson } from "./types";

export type PublicStep = PublicLesson["steps"][number];

/** A saved answer as the box shows it: s7's picks one per line. */
function answerText(step: PublicStep): string {
  if (step.id !== "s7" || !step.answer.startsWith("[")) return step.answer;
  try { return (JSON.parse(step.answer) as string[]).join("\n"); } catch { return step.answer; }
}

const PLACEHOLDER: Partial<Record<StepId, string>> = {
  s7: "src/app/session.py\nsave_session\ntests/test_session.py",
};

export function StepCard({ lessonId, step, answerKey, open, onLesson }: {
  lessonId: string;
  step: PublicStep;
  answerKey: AnswerKeyStatus;
  /** The step can be submitted in the lesson's current stage. */
  open: boolean;
  onLesson: (lesson: PublicLesson) => void;
}) {
  const [answer, setAnswer] = useState(() => answerText(step));
  const [pending, setPending] = useState<"check" | "hint" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<StepGrade | null>(step.grade);
  const [done, setDone] = useState(step.done);
  const [hints, setHints] = useState<Array<{ level: number; text: string }>>([]);
  const [hintLevel, setHintLevel] = useState(step.hint_level);
  // State starts from the saved step; the parent keys this card by step id.
  const ids = { q: useId(), a: useId() };

  async function call(path: string, body: object): Promise<Record<string, unknown>> {
    const res = await fetch(`/api/lessons/${lessonId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${res.status}).`);
    return data;
  }

  async function check() {
    setPending("check");
    setError(null);
    try {
      const data = await call(`steps/${step.id}`, { answer });
      const result = data.step as { done: boolean; grade: StepGrade | null };
      setGrade(result.grade);
      setDone(result.done);
      onLesson(data.lesson as PublicLesson);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check this step.");
    } finally {
      setPending(null);
    }
  }

  async function hint() {
    setPending("hint");
    setError(null);
    try {
      const data = await call("hint", { step: step.id });
      const level = data.level as number;
      setHints((h) => [...h, { level, text: String(data.text) }]);
      setHintLevel(level);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load a hint.");
    } finally {
      setPending(null);
    }
  }

  const ungraded = done && !grade;
  const keyNotVerified = (step.id === "s7" || step.id === "s8") && answerKey !== "verified";
  const hintsLeft = hintLevel < step.max_hint_level;
  return (
    <section aria-labelledby={ids.q} className="card p-5 sm:p-6">
      <p className="label-mono">{step.id === "explain-it" ? "explain it" : step.id}</p>
      <h2 id={ids.q} className="mt-1 text-[19px] font-semibold tracking-[-0.01em] text-paper">{step.title}</h2>
      <p className="mt-2 text-[15px] leading-[1.6] text-paper-dim">{step.question}</p>
      {keyNotVerified && open && (
        <p className="mt-2 text-[14px] text-paper-muted">
          {answerKey === "pending" ? "The AI's fix is still running, so" : "The AI's fix could not be verified, so"} this step is saved without a grade: investigate it together with the teacher.
        </p>
      )}
      <label htmlFor={ids.a} className="sr-only">Your answer</label>
      <textarea
        id={ids.a} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!open || pending !== null}
        rows={step.id === "s7" ? 4 : 6} maxLength={3000} placeholder={PLACEHOLDER[step.id] ?? "Your answer"}
        className="paper-field mt-3"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void check()} disabled={!open || pending !== null || !answer.trim()} className="btn-primary" data-size="sm">
          {pending === "check" ? "Checking…" : "Check"}
        </button>
        <button type="button" onClick={() => void hint()} disabled={!open || pending !== null || !hintsLeft} className="btn-quiet" data-size="sm">
          {pending === "hint" ? "Loading…" : hintsLeft ? `Hint (${hintLevel + 2} of ${step.max_hint_level + 1})` : "No more hints"}
        </button>
      </div>
      {hints.length > 0 && (
        <ol className="mt-4 space-y-2 border-l border-border-strong pl-4 text-[15px] text-paper-dim" aria-label="Hints">
          {hints.map((h) => <li key={h.level}><span className="label-mono mr-2">hint {h.level + 1}</span>{h.text}</li>)}
        </ol>
      )}
      <div aria-live="polite" className="mt-3 empty:hidden">
        {error && <p role="alert" className="text-alert">{error}</p>}
        {grade && (
          <p className={cn("text-[15px] leading-[1.6]", grade.passed ? "text-ok" : "text-alert")}>
            <span className="font-semibold">{grade.passed ? "Passed. " : "Not yet. "}</span>
            <span className="text-paper-dim">{grade.feedback}</span>
          </p>
        )}
        {ungraded && !error && <p className="text-[15px] text-paper-dim">Saved.{keyNotVerified ? " Not graded this time; talk it through with the teacher." : ""}</p>}
      </div>
    </section>
  );
}
