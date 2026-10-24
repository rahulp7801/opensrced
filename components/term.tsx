"use client";

// An inline "what's this?" for a jargon word (lib/glossary.ts). A real button
// that toggles a definition in the flow below it: works by keyboard and touch,
// never hover-only, and the definition stays until it is closed again.

import { useId, useState } from "react";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";

export function Term({ term, children }: { term: GlossaryTerm; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-6 items-center gap-1 align-baseline text-inherit underline decoration-dotted decoration-paper-faint underline-offset-[3px] hover:decoration-signal"
      >
        {children ?? term}
        <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full border border-border-strong text-[10px] font-semibold leading-none text-paper-muted no-underline">?</span>
        <span className="sr-only">: what&apos;s this?</span>
      </button>
      {/* Always in the DOM so aria-controls resolves; shown only when open. */}
      <span id={id} role="note" hidden={!open} className="my-1.5 block rounded-lg border border-border-soft bg-ink px-3 py-2 text-[12px] font-normal leading-relaxed text-paper-dim">
        <strong className="font-medium text-paper">{term.charAt(0).toUpperCase() + term.slice(1)}:</strong> {GLOSSARY[term]}
      </span>
    </>
  );
}
