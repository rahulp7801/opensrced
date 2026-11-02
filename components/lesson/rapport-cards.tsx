"use client";

// Rapport with the maintainer, in the lesson: the comment that claims the
// issue (kickoff), how this repo's maintainers like PRs (kickoff and before
// publish), and the docs-first suggestion (s10). Every text here is for the
// contributor to post themselves; nothing is sent to GitHub from opensrcer.

import { useEffect, useId, useState } from "react";
import { copyText } from "@/lib/clipboard";

/** An editable draft with Copy and a GitHub link that opens where it goes. */
function CopyDraft({ label, text, onText, href, linkText }: { label: string; text: string; onText: (t: string) => void; href: string; linkText: string }) {
  const id = useId();
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea id={id} value={text} onChange={(e) => { onText(e.target.value); setCopied(null); }} rows={7} className="paper-field mt-3" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet" data-size="sm"
          onClick={() => void copyText(text).then(() => setCopied("Copied."), (e: Error) => setCopied(e.message))}>Copy</button>
        <a href={href} target="_blank" rel="noreferrer" className="link text-[14px]">{linkText}<span aria-hidden>↗</span></a>
        <span aria-live="polite" className="text-[13px] text-paper-muted">{copied}</span>
      </div>
    </>
  );
}

/** "I'd like to work on this; my plan is …", from the contributor's own s4 answer. */
export function ClaimCard({ lessonId, issueUrl, ready }: { lessonId: string; issueUrl: string; ready: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draftIt() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { draft?: string; error?: string };
      if (!res.ok || !body.draft) throw new Error(body.error ?? `Could not draft the comment (${res.status}).`);
      setDraft(body.draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not draft the comment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Tell the maintainers you're on it" className="card p-5">
      <p className="font-semibold text-paper">Tell the maintainers you&apos;re on it</p>
      <p className="mt-1 text-[14px] leading-[1.55] text-paper-dim">
        A short comment on the issue saying you&apos;d like to work on it, and how, saves duplicate work and starts a conversation. You post it yourself.
      </p>
      {draft === null ? (
        <button type="button" onClick={() => void draftIt()} disabled={!ready || pending} className="btn-quiet mt-3" data-size="sm">
          {pending ? "Drafting…" : ready ? "Draft it from my answers" : "Answer \"The task\" first"}
        </button>
      ) : (
        <CopyDraft label="Comment to post on the issue" text={draft} onText={setDraft} href={issueUrl} linkText="Open the issue on GitHub" />
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-alert">{error}</p>}
    </section>
  );
}

/** "How <repo> likes PRs" (lib/maintainer-prefs.ts), measured, never guessed. */
export function PrefsCard({ lessonId, repo }: { lessonId: string; repo: string }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/lessons/${lessonId}/prefs`, { signal: controller.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { lines?: string[]; error?: string };
        if (!r.ok || !body.lines) throw new Error(body.error ?? `Could not load (${r.status}).`);
        setLines(body.lines);
      })
      .catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [lessonId]);

  return (
    <section aria-label={`How ${repo} likes PRs`} className="card p-5">
      <p className="font-semibold text-paper">How {repo} likes PRs</p>
      {error ? <p className="mt-1 text-[14px] text-paper-muted">{error}</p>
        : !lines ? <p role="status" className="mt-1 text-[14px] text-paper-muted">Reading its recent merged PRs…</p>
        : lines.length === 0 ? <p className="mt-1 text-[14px] text-paper-muted">No recent merged PRs from people to learn from.</p>
        : (
          <>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-[1.55] text-paper-dim">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-2 text-[13px] text-paper-muted">Measured from its most recent merged pull requests.</p>
          </>
        )}
    </section>
  );
}

/** s10's docs-first suggestion: the kickoff's questions as a docs issue. */
export function DocsFirstCard({ repoUrl, draft }: { repoUrl: string; draft: { title: string; body: string } }) {
  const [body, setBody] = useState(draft.body);
  const href = `${repoUrl}/issues/new?${new URLSearchParams({ title: draft.title, body }).toString()}`;
  return (
    <section aria-label="Docs first" className="card p-5">
      <p className="font-semibold text-paper">Was anything confusing to set up or understand? That&apos;s a first PR.</p>
      <p className="mt-1 text-[14px] leading-[1.55] text-paper-dim">
        Your questions from the start of this lesson, as a docs issue. Edit it, then post it yourself: GitHub opens with it filled in, and nothing is sent until you submit.
      </p>
      <p className="mt-3 text-[14px] text-paper"><span className="label-mono mr-2">title</span>{draft.title}</p>
      <CopyDraft label="Docs issue text" text={body} onText={setBody} href={href} linkText="Open a new issue on GitHub" />
    </section>
  );
}
