"use client";

import { useState } from "react";
import Link from "next/link";

type Field = "name" | "email" | "github";
type State = { kind: "idle" } | { kind: "sending" } | { kind: "done"; name: string; email: string } | { kind: "error"; message: string; field?: Field };

const FIELDS: Array<{ id: Field; label: string; type: string; autoComplete: string; placeholder: string; hint?: string }> = [
  { id: "name", label: "Name", type: "text", autoComplete: "name", placeholder: "Ada Lovelace" },
  { id: "email", label: "Email", type: "email", autoComplete: "email", placeholder: "you@example.com", hint: "Where we'll tell you you're in." },
  { id: "github", label: "GitHub username", type: "text", autoComplete: "username", placeholder: "octocat", hint: "Access is given to this GitHub account; you sign in with it." },
];

/** The early-access form: name, email, GitHub username. Posts to /api/interest. */
export function JoinForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/interest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; field?: Field };
      if (res.ok) setState({ kind: "done", name: data.name.trim().split(" ")[0], email: data.email.trim() });
      else setState({ kind: "error", message: body.error ?? "Something went wrong. Please try again.", field: body.field });
    } catch {
      setState({ kind: "error", message: "Couldn't reach opensrcer. Check your connection and try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <div role="status" className="mt-10 max-w-[560px] rounded-2xl border border-border-soft bg-surface px-6 py-6">
        <p className="font-display text-[26px] font-[650] leading-tight text-paper [font-stretch:92%]">You&apos;re on the list{state.name ? `, ${state.name}` : ""}.</p>
        <p className="mt-2 text-[16px] leading-[1.55] text-paper-muted">We&apos;ll email {state.email} when your access is ready. Until then, the product tour shows a full run.</p>
        <p className="mt-4"><Link href="/demo" className="text-link text-[16px]">Watch the product tour</Link></p>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={submit} noValidate className="mt-10 grid max-w-[560px] gap-5">
      {FIELDS.map((f) => {
        const invalid = state.kind === "error" && state.field === f.id;
        return (
          <div key={f.id}>
            <label htmlFor={`join-${f.id}`} className="field-label">{f.label}</label>
            <input
              id={`join-${f.id}`} name={f.id} type={f.type} autoComplete={f.autoComplete} placeholder={f.placeholder}
              required maxLength={f.id === "email" ? 254 : 100} disabled={sending} className="field"
              aria-invalid={invalid || undefined} aria-describedby={invalid ? "join-error" : f.hint ? `join-${f.id}-hint` : undefined}
              {...(f.id === "github" ? { autoCapitalize: "none", spellCheck: false } : {})}
            />
            {f.hint && !invalid && <p id={`join-${f.id}-hint`} className="mt-1.5 text-[13.5px] text-paper-muted">{f.hint}</p>}
          </div>
        );
      })}
      {/* Hidden from people (and from assistive tech); bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="join-website">Website</label>
        <input id="join-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {state.kind === "error" && <p id="join-error" role="alert" className="text-[15px] text-alert">{state.message}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={sending} className="btn-primary inline-flex min-h-11 items-center px-6 text-[16px] disabled:opacity-60">
          {sending ? "Sending…" : "Request access"}
        </button>
        <p className="text-[13.5px] text-paper-muted">Used only to give you access and tell you about it. <Link href="/privacy" className="text-link">Privacy</Link></p>
      </div>
    </form>
  );
}
