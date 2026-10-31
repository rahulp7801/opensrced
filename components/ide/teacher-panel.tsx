"use client";

// The teacher side view (PLAN §8.2 item 1). "Ask about selection" sends the
// selected code and its file; Ctrl+I "Suggest" answers land here too. Both
// are lesson teacher turns on the server, leak-checked and saved with the
// lesson chat (lib/lesson/api.ts askAboutSelection, suggestAtCursor).

import { useState } from "react";

export type TeacherMessage = { from: "you" | "teacher"; text: string };
export type EditorSelection = { file: string; selection: string; line: number };

export function TeacherPanel({ lessonId, messages, onMessage, currentSelection }: {
  lessonId: string;
  messages: TeacherMessage[];
  onMessage: (message: TeacherMessage) => void;
  currentSelection: () => EditorSelection | null;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask() {
    const picked = currentSelection();
    const asked = question.trim() || "What does this code do?";
    onMessage({ from: "you", text: picked?.selection ? `${asked}\n\n${picked.file}:${picked.line}\n${picked.selection}` : asked });
    setBusy(true);
    try {
      const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: picked?.selection ?? "", file: picked?.file ?? "", question: asked }),
      });
      const body = await res.json().catch(() => null) as { reply?: string; error?: string } | null;
      onMessage({ from: "teacher", text: body?.reply ?? body?.error ?? `The teacher didn't answer (${res.status}).` });
      setQuestion("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-label="Teacher" className="flex h-full flex-col border-l border-white/10 bg-[#252526] text-sm text-[#ccc]">
      <h2 className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/70">Teacher</h2>
      <ol data-testid="teacher-messages" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && <li className="text-white/50">Select code in the editor and ask about it. Ctrl+I asks for a suggestion at the cursor.</li>}
        {messages.map((message, i) => (
          <li key={i} className={`whitespace-pre-wrap rounded p-2 ${message.from === "you" ? "bg-sky-900/40" : "bg-white/5"}`}>{message.text}</li>
        ))}
      </ol>
      <form className="space-y-2 border-t border-white/10 p-3" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <label htmlFor="ide-ask" className="sr-only">Question about the selection</label>
        <textarea id="ide-ask" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="What does this code do?" className="w-full resize-none rounded bg-black/30 p-2 text-white outline-none focus:ring-1 focus:ring-sky-400" />
        <button type="submit" disabled={busy} className="w-full rounded bg-sky-600 py-1.5 text-xs font-medium text-white disabled:opacity-50">Ask about selection</button>
      </form>
    </aside>
  );
}
