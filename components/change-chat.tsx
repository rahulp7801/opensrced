"use client";

// "Ask about this change": a small chat about one change, used on the run
// page's review step and on the PR page. Each answer is one plain model call
// (/api/explain, no tools) on the context the page passes in, so it is an
// explanation to check against the code, never a verified fact. The
// conversation survives closing the panel and, per run or PR, a reload
// (sessionStorage).

import { useEffect, useId, useRef, useState } from "react";
import { readTextResponse } from "@/lib/sse";
import { EXPLAIN_LIMITS, type ExplainContext, type ExplainTurn } from "@/lib/explain";

export const STARTER_QUESTIONS = [
  "Explain this fix like I'm new to the project",
  "What could this break?",
  "Which of the project's rules apply, and did it follow them?",
  "How do I explain this to a reviewer?",
] as const;

export const CHAT_CAVEAT = "Answers are based on this change and the project's rules; check them against the code.";

const STORAGE_PREFIX = "opensrcer:change-chat:";

/** Keep the head of long text and say it was cut. */
function cut(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 40)}\n… (truncated for this question)` : text;
}

/** The change as /api/explain and /api/quiz take it, cut to the server's caps. */
export function changeRequest(repo: string | undefined, title: string, context: ExplainContext) {
  return {
    repo, title: cut(title, EXPLAIN_LIMITS.title),
    context: {
      description: cut(context.description, EXPLAIN_LIMITS.description),
      diff: cut(context.diff, EXPLAIN_LIMITS.diff),
      verification: cut(context.verification, EXPLAIN_LIMITS.verification),
      rules: cut(context.rules, EXPLAIN_LIMITS.rules),
    },
  };
}

function loadTurns(key: string): ExplainTurn[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is ExplainTurn => typeof t?.question === "string" && typeof t?.answer === "string").slice(-20) : [];
  } catch {
    return []; // storage blocked or corrupt: start empty
  }
}

function saveTurns(key: string, turns: ExplainTurn[]) {
  try { sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(turns.slice(-20))); } catch { /* storage blocked: the chat still works for this view */ }
}

export function ChangeChat({ storageKey, repo, title, context, starters = STARTER_QUESTIONS, caveat = CHAT_CAVEAT, onOpen }: {
  /** One conversation per run or PR, e.g. "run:<id>" or "pr:owner/repo#12". */
  storageKey: string;
  repo?: string;
  title: string;
  context: ExplainContext;
  starters?: readonly string[];
  caveat?: string;
  /** Called when the panel opens, e.g. to load the diff it needs. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ExplainTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const panelId = useId();
  const inputId = useId();

  // Restore after mount (sessionStorage is not available while rendering on the server).
  useEffect(() => { setTurns(loadTurns(storageKey)); setError(null); }, [storageKey]);
  useEffect(() => () => abort.current?.abort(), [storageKey]);

  function toggle() {
    if (!open) onOpen?.();
    setOpen(!open);
  }

  async function ask(question: string) {
    const q = question.trim().slice(0, EXPLAIN_LIMITS.question);
    if (!q || pending) return;
    const controller = new AbortController();
    abort.current = controller;
    const history = turns.slice(-EXPLAIN_LIMITS.history).map((t) => ({ question: t.question, answer: cut(t.answer, EXPLAIN_LIMITS.historyAnswer) }));
    setInput("");
    setError(null);
    setPending(true);
    setTurns((prev) => [...prev, { question: q, answer: "" }]);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...changeRequest(repo, title, context), question: q, history }),
      });
      const answer = await readTextResponse(res, (text) => {
        if (!controller.signal.aborted) setTurns((prev) => [...prev.slice(0, -1), { question: q, answer: text }]);
      });
      setTurns((prev) => {
        const next = [...prev.slice(0, -1), { question: q, answer }];
        saveTurns(storageKey, next);
        return next;
      });
    } catch (cause) {
      // Drop the unanswered question and give it back to edit or retry.
      setTurns((prev) => prev.slice(0, -1));
      setInput(q);
      setError(controller.signal.aborted ? "Stopped. Your question is back in the box." : cause instanceof Error ? cause.message : "Could not get an answer.");
    } finally {
      if (abort.current === controller) abort.current = null;
      setPending(false);
    }
  }

  function clear() {
    setTurns([]);
    saveTurns(storageKey, []);
  }

  const button = "inline-flex min-h-10 items-center rounded-full border px-3 text-[12px] disabled:opacity-50 sm:min-h-8";
  return (
    <div className="mt-3 rounded-lg border border-info/40 bg-ink px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId} className={`${button} border-info/50 bg-info/10 font-medium text-info hover:bg-info/20`}>
          {open ? "Close the questions" : "Ask about this change"}{turns.length > 0 && !open ? ` (${turns.length} asked)` : ""}
        </button>
        <span className="text-paper-muted">Not sure what the fix does? Ask before you send it.</span>
      </div>
      <div id={panelId} hidden={!open} className="mt-2">
        <p className="text-paper-muted">{caveat} Each answer comes from one AI call that reads only what is shown here; it does not run the code.</p>
        <div role="group" aria-label="Starter questions" className="mt-2 flex flex-wrap gap-2">
          {starters.map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => void ask(s)} className={`${button} border-border-soft text-paper hover:border-info/50 hover:text-info`}>{s}</button>
          ))}
        </div>
        <ol role="log" aria-live="polite" aria-busy={pending} aria-label="Questions and answers" className="mt-2 max-h-[420px] space-y-3 overflow-y-auto">
          {turns.map((t, i) => (
            <li key={i} className="space-y-1">
              <p className="text-paper"><span className="mr-1.5 font-medium text-signal">You:</span>{t.question}</p>
              <div className="rounded-lg border border-border-soft bg-surface px-3 py-2 text-paper-dim">
                <p className="text-[11px] font-medium text-info">AI answer (not verified)</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{t.answer || (pending && i === turns.length - 1 ? "Thinking…" : "")}</p>
              </div>
            </li>
          ))}
        </ol>
        {error && <p role="alert" className="mt-2 text-alert">{error}</p>}
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
          <label htmlFor={inputId} className="basis-full text-paper">Your question</label>
          <textarea
            id={inputId}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            maxLength={EXPLAIN_LIMITS.question}
            rows={2}
            disabled={pending}
            placeholder="Why did it change this line?"
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint focus:border-info/50 focus:outline-none disabled:opacity-50"
          />
          {pending ? (
            <button type="button" onClick={() => abort.current?.abort()} className={`${button} border-border text-paper-muted hover:text-alert`}>Stop</button>
          ) : (
            <button type="submit" disabled={!input.trim()} className={`${button} border-info/50 bg-info/10 font-medium text-info hover:bg-info/20`}>Ask</button>
          )}
          {turns.length > 0 && !pending && (
            <button type="button" onClick={clear} className={`${button} border-border-soft text-paper-muted hover:text-paper`}>Clear</button>
          )}
        </form>
      </div>
    </div>
  );
}
