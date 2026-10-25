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
        // On phones and touch screens the hit area grows to 40px; the negative
        // margins cancel it in the layout, so the line looks the same.
        className="inline-flex min-h-6 items-center gap-1 align-baseline text-inherit underline decoration-dotted decoration-paper-faint underline-offset-[3px] hover:decoration-signal max-sm:-mx-1.5 max-sm:-my-2 max-sm:min-h-10 max-sm:px-1.5 pointer-coarse:-mx-1.5 pointer-coarse:-my-2 pointer-coarse:min-h-10 pointer-coarse:px-1.5"
      >
        {children ?? term}
        <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold leading-none text-paper-dim no-underline">?</span>
        <span className="sr-only">: what&apos;s this?</span>
      </button>
      {/* Always in the DOM so aria-controls resolves; shown only when open. */}
      <span id={id} role="note" hidden={!open} className="my-2 block basis-full rounded-xl bg-signal-faint/70 px-3.5 py-2.5 text-[13px] font-normal normal-case leading-relaxed tracking-normal text-paper-dim">
        <strong className="font-medium text-paper">{term.charAt(0).toUpperCase() + term.slice(1)}:</strong> {GLOSSARY[term]}
      </span>
    </>
  );
}
