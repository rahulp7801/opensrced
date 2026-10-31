"use client";

// The teacher chat beside a lesson (PLAN §7.3, §7.8): history from the
// lesson store, one reply per question from POST /api/lessons/<id>/teacher.
// Every reply was leak-checked on the server before its first byte was sent.
// Without Copilot or an API key the teacher is unavailable; a Claude plan
// never powers it (PLAN §0.6), so the page says what to connect instead.

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { sseEvents } from "@/lib/sse";
import type { StepId } from "@/lib/lesson/machine";
import type { LessonMessage } from "@/lib/lesson/store";
import { cn } from "@/lib/utils";

export const TEACHER_SETUP = "Connect Copilot or add an API key to use the teacher.";

export function TeacherChat({ lessonId, initial, step, available, starters = [], onTurn, className }: {
  lessonId: string;
  initial: LessonMessage[];
  /** The step the contributor is on, so the teacher knows what is being asked. */
  step: StepId | null;
  available: boolean;
  /** One-click questions, e.g. the reveal's "would my approach also work?". */
  starters?: string[];
  onTurn?: (turnsLeft: number | null) => void;
  className?: string;
}) {
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => setMessages(initial), [initial]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    setError(null);
    const at = new Date().toISOString();
    setMessages((m) => [...m, { role: "user", content: message, step, at }]);
    setInput("");
    try {
      const res = await fetch(`/api/lessons/${lessonId}/teacher`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, step }),
      });
      // The server sends the whole checked reply, then { done, turns_left }.
      let reply = "";
      let turnsLeft: number | null = null;
      for await (const event of sseEvents<{ text?: string; done?: boolean; turns_left?: number; error?: string }>(res)) {
        if (event.error) throw new Error(event.error);
        if (event.text) reply += event.text;
        if (event.done) { turnsLeft = event.turns_left ?? null; break; }
      }
      if (!reply.trim()) throw new Error("The teacher's answer did not arrive. Please retry.");
      setMessages((m) => [...m, { role: "teacher", content: reply, step, at: new Date().toISOString() }]);
      onTurn?.(turnsLeft);
    } catch (cause) {
      setMessages((m) => m.slice(0, -1));
      setInput(message);
      setError(cause instanceof Error ? cause.message : "The teacher could not answer.");
    } finally {
      setPending(false);
    }
  }

  if (!available) {
    return (
      <section aria-label="Teacher" className={cn("callout text-[15px]", className)} data-tone="info">
        <p className="font-semibold text-paper">{TEACHER_SETUP}</p>
        <p className="mt-1.5">
          The teacher runs on GitHub Copilot or your own Anthropic or OpenRouter key. A Claude plan can run the hidden fix, but
          Anthropic&apos;s terms don&apos;t allow it to power the teacher. Hints and your answers still work without it.
        </p>
        <Link href="/crucible" className="btn-quiet mt-3" data-size="sm">Open settings</Link>
      </section>
    );
  }

  return (
    <section aria-label="Teacher" className={cn("flex min-h-0 flex-col", className)}>
      <h2 className="label-mono">Teacher</h2>
      <div ref={log} role="log" aria-live="polite" aria-busy={pending} tabIndex={messages.length ? 0 : -1} className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && <p className="text-[15px] text-paper-muted">Ask anything about the issue or the code. The teacher asks back more than it tells, and never gives away the fix.</p>}
        <ol className="space-y-3">
          {messages.map((m, i) => (
            <li key={i} className={cn("whitespace-pre-wrap break-words text-[15px] leading-[1.6]", m.role === "user" ? "font-medium text-paper" : "border-l border-border-strong pl-3 text-paper-dim")}>
              <span className="sr-only">{m.role === "user" ? "You: " : "Teacher: "}</span>
              {/* The prompt asks for plain text; models still add **bold** now and then. */}
              {m.role === "teacher" ? m.content.replace(/\*\*/g, "") : m.content}
            </li>
          ))}
          {pending && <li className="border-l border-border-strong pl-3 text-paper-muted" role="status">Thinking…</li>}
        </ol>
      </div>
      {starters.length > 0 && (
        <div role="group" aria-label="Suggested questions" className="mt-3 flex flex-col items-start">
          {starters.map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => void send(s)} className="flex min-h-10 items-baseline gap-2 text-left text-[15px] text-paper hover:text-signal disabled:opacity-50">
              <span aria-hidden className="font-mono text-paper-faint">→</span><span>{s}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-alert">{error}</p>}
      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <label htmlFor={inputId} className="sr-only">Message the teacher</label>
        <textarea
          id={inputId} value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} disabled={pending}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="Ask the teacher" className="field min-w-0 flex-1"
        />
        <button type="submit" disabled={pending || !input.trim()} className="btn-quiet">Send</button>
      </form>
    </section>
  );
}
