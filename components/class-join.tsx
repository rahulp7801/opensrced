"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The join button on a class invite page (app/class/[code]): posts the code,
 *  then reloads the page, which now shows the next steps. */
export function ClassJoin({ code, name }: { code: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/class/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Couldn't join just now. Try again in a moment.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach opensrcer. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-paper-dim">Step 2 of 3: join the class.</p>
      <button type="button" className="btn-primary" onClick={join} disabled={busy}>{busy ? "Joining…" : `Join ${name}`}</button>
      {error && <p role="alert" className="text-[14px] text-paper">{error}</p>}
    </div>
  );
}
