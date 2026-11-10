"use client";

// Account → Harness: personal tokens for the opensrcer plugin (harness/),
// created and revoked here (app/api/me/tokens). A token is shown once.

import { useCallback, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

type Token = { id: number; name: string; createdAt: string; lastUsedAt: string | null };

const INSTALL = [
  "/plugin marketplace add rahulp7801/opensrced",
  "/plugin install opensrcer@opensrced",
];
const when = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never";

/** `vscode`: show the one-command VS Code install (only once opensrcer-mcp is published to npm). */
export function HarnessTokens({ vscode = false }: { vscode?: boolean }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/me/tokens", { cache: "no-store" });
    const body = await r.json().catch(() => ({})) as { tokens?: Token[]; error?: string };
    if (r.ok && body.tokens) setTokens(body.tokens);
    else setError(body.error ?? "Could not load your tokens.");
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/me/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await r.json().catch(() => ({})) as { token?: string; error?: string };
      if (!r.ok || !body.token) throw new Error(body.error ?? "Could not create a token.");
      setFresh(body.token);
      setCopied(false);
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setError(null);
    const r = await fetch(`/api/me/tokens/${id}`, { method: "DELETE" });
    if (!r.ok) setError("Could not revoke that token. Try again.");
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-paper-dim">Create a token below, then install the plugin. It asks for the token. In Claude Code:</p>
        {/* Scrolls sideways on phones, so it takes keyboard focus. */}
        <pre tabIndex={0} role="region" aria-label="Plugin install commands" className="card mt-2 overflow-x-auto px-4 py-3 font-mono text-[13px] text-paper">{INSTALL.join("\n")}</pre>
        <p className="mt-2 text-[14px] text-paper-muted">To change the token later, run <code className="font-mono">/plugin configure opensrcer@opensrced</code>.</p>
        {vscode && (
          <>
            <p className="mt-4 text-paper-dim">In VS Code with GitHub Copilot, run this once in any terminal (it needs Node 20 or newer):</p>
            <pre tabIndex={0} role="region" aria-label="VS Code install command" className="card mt-2 overflow-x-auto px-4 py-3 font-mono text-[13px] text-paper">npx -y opensrcer-mcp install</pre>
            <p className="mt-2 text-[14px] text-paper-muted">Then open Copilot Chat in Agent mode. VS Code asks for the token the first time opensrcer starts.</p>
          </>
        )}
        <p className="mt-3 text-[14px] text-paper-muted">Something not working? Ask your agent to &ldquo;check my opensrcer setup&rdquo; (in Claude Code: /opensrcer:setup).</p>
      </div>

      {fresh && (
        <div role="status" className="callout" data-tone="ok">
          <p className="font-semibold text-paper">Your new token. Copy it now: it won&apos;t be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="min-w-0 break-all font-mono text-[13px] text-paper">{fresh}</code>
            <button type="button" className="btn-quiet" data-size="sm" onClick={async () => { await copyText(fresh).then(() => setCopied(true), () => setCopied(false)); }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-[14px] text-paper-muted">
            Paste it when the plugin install asks for it (or run <code className="font-mono">/plugin configure opensrcer@opensrced</code>), then restart Claude Code.
          </p>
        </div>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="label-mono mb-1.5 block">Token name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. work laptop" className="field w-full" />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create token"}</button>
      </form>
      {error && <p role="alert" className="text-[14px] text-alert">{error}</p>}

      {tokens === null ? <p className="text-paper-muted">Loading your tokens…</p> : tokens.length === 0 ? (
        <p className="text-paper-muted">No tokens yet.</p>
      ) : (
        <ul className="ruled" aria-label="Your harness tokens">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block font-semibold text-paper">{t.name}</span>
                <span className="meta"><span>created {when(t.createdAt)}</span><span>last used {when(t.lastUsedAt)}</span></span>
              </span>
              <button type="button" className="btn-quiet" data-size="sm" onClick={() => void revoke(t.id)} aria-label={`Revoke ${t.name}`}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
