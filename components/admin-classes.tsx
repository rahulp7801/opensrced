"use client";

import { useCallback, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

type Invite = { code: string; name: string; maxUses: number; members: number; expiresAt: string; revokedAt: string | null };

/** Class invite links on /admin/access (app/api/admin/classes): make one per
 *  class, share the link, watch seats fill, turn it off. */
export function AdminClasses() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [seats, setSeats] = useState("60");
  const [days, setDays] = useState("120");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Turning a link off ends its students' access, so it takes a second press.
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/classes", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) { setError("Couldn't load class links."); return; }
    setInvites(((await res.json()) as { invites: Invite[] }).invites);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, maxUses: Number(seats), days: Number(days) }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: unknown } | undefined;
    if (!res?.ok) setError(typeof body?.error === "string" ? body.error : "Couldn't create the class link.");
    else setName("");
    setBusy(false);
    await load();
  }

  async function revoke(code: string) {
    setConfirming(null);
    const res = await fetch(`/api/admin/classes?code=${encodeURIComponent(code)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError("Couldn't turn that link off.");
    await load();
  }

  // Prepare a repository's code map before class: the first build takes minutes, then every student's lesson starts at once.
  const [mapRepo, setMapRepo] = useState("");
  const [mapStatus, setMapStatus] = useState<string | null>(null);
  async function prepareMap(event: React.FormEvent) {
    event.preventDefault();
    setMapStatus("Building the code map… a big project takes a few minutes.");
    const res = await fetch("/api/admin/classes/maps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo: mapRepo }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: unknown; repo?: string; nodes?: number; revision?: string; already?: boolean } | undefined;
    setMapStatus(res?.ok && body
      ? `${body.repo}: ${body.already ? "already ready" : "ready"} (${body.nodes} nodes, commit ${body.revision}). Students' lessons on it start at once.`
      : typeof body?.error === "string" ? body.error : "Couldn't prepare that map. Try again in a minute.");
  }

  const link = (code: string) => `${window.location.origin}/class/${code}`;
  const open = (i: Invite) => !i.revokedAt && new Date(i.expiresAt).getTime() > Date.now();

  return (
    <div className="mt-8 space-y-5">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="label-mono mb-1.5 block">Class name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. CS 101, Fall 2026" className="field w-full" />
        </label>
        <label className="w-24">
          <span className="label-mono mb-1.5 block">Seats</span>
          <input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" required className="field w-full" />
        </label>
        <label className="w-28">
          <span className="label-mono mb-1.5 block">Days open</span>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" required className="field w-full" />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create class link"}</button>
      </form>
      {error && <p role="alert" className="text-[14px] text-paper">{error}</p>}
      {invites && invites.length === 0 && <p className="text-paper-muted">No class links yet.</p>}
      {invites && invites.length > 0 && (
        <ul className="space-y-3">
          {invites.map((i) => (
            <li key={i.code} className="card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-paper">{i.name}</p>
                  <p className="text-[14px] text-paper-muted">
                    {i.members} of {i.maxUses} joined · {i.revokedAt ? "turned off" : open(i) ? `open until ${new Date(i.expiresAt).toLocaleDateString()}` : "closed to new students"}
                  </p>
                  <code className="break-all font-mono text-[13px] text-paper-dim">{link(i.code)}</code>
                </div>
                <div className="flex gap-2">
                  {!i.revokedAt && (
                    <button type="button" className="btn-quiet" data-size="sm" onClick={async () => { await copyText(link(i.code)).then(() => setCopied(i.code), () => setCopied(null)); }}>
                      {copied === i.code ? "Copied" : "Copy link"}
                    </button>
                  )}
                  {!i.revokedAt && (confirming === i.code
                    ? <button type="button" className="btn-quiet" data-size="sm" onClick={() => revoke(i.code)}>Turn off: {i.members} lose access</button>
                    : <button type="button" className="btn-quiet" data-size="sm" onClick={() => setConfirming(i.code)}>Turn off</button>)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={prepareMap} className="flex flex-wrap items-end gap-3 border-t border-border-soft pt-5">
        <label className="min-w-0 flex-1">
          <span className="label-mono mb-1.5 block">Prepare a code map before class</span>
          <input value={mapRepo} onChange={(e) => setMapRepo(e.target.value)} required placeholder="owner/name, e.g. pallets/itsdangerous" className="field w-full" />
        </label>
        <button type="submit" className="btn-quiet" disabled={!mapRepo.trim() || mapStatus?.startsWith("Building") === true}>Prepare map</button>
      </form>
      {mapStatus && <p role="status" className="text-[14px] text-paper-muted">{mapStatus}</p>}
    </div>
  );
}
