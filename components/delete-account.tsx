"use client";

import { useState } from "react";
import { readJson, requestErrorMessage } from "@/lib/fetch-json";

/** "Delete my data": typing the GitHub login arms the button; the server
 *  re-checks the session and the login (DELETE /api/me), then this follows
 *  its redirect to sign out. */
export function DeleteAccount({ login }: { login: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const armed = typed.trim().toLowerCase() === login.toLowerCase();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!armed || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { redirect } = await readJson<{ redirect: string }>(await fetch("/api/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed.trim() }),
      }));
      window.location.assign(redirect);
    } catch (error) {
      setProblem(requestErrorMessage(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="callout callout-alert p-5 sm:p-6">
      <h3 className="text-[16px] font-semibold text-paper">Delete my data</h3>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-paper-dim">
        Stops any running work, disconnects organizations, clears your saved provider keys, and permanently erases your
        account record, onboarding answers, lessons, contributions, run records and stats from opensrcer. Then you&apos;re
        signed out. Pull requests already opened on GitHub stay on GitHub. This can&apos;t be undone.
      </p>
      <label htmlFor="delete-confirm" className="field-label mt-4 block">Type <strong className="font-mono text-paper">{login}</strong> to confirm</label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          id="delete-confirm"
          className="field max-w-xs"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" disabled={!armed || busy} className="btn-quiet" data-tone="alert">
          {busy ? "Deleting…" : "Delete my data"}
        </button>
      </div>
      {problem && <p role="alert" className="mt-3 text-[14px] text-alert">{problem}</p>}
    </form>
  );
}
