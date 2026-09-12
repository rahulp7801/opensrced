"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";

type KeyStatus = { anthropic: boolean; gemini: boolean; maxSpendUsd: number };

const SPEND_OPTIONS = [
  { value: 0.10, label: "$0.10" },
  { value: 0.25, label: "$0.25" },
  { value: 0.50, label: "$0.50" },
  { value: 0.75, label: "$0.75" },
  { value: 1.00, label: "$1.00" },
  { value: 2.00, label: "$2.00" },
  { value: 5.00, label: "$5.00" },
  { value: 10.00, label: "$10.00" },
];

export function ApiKeysForm() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [anthropicInput, setAnthropicInput] = useState("");
  const [geminiInput, setGeminiInput] = useState("");
  const [maxSpend, setMaxSpend] = useState(2);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/keys", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load settings.");
        return r.json();
      })
      .then((d: KeyStatus) => {
        setStatus(d);
        if (d.maxSpendUsd) setMaxSpend(d.maxSpendUsd);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage({ text: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Settings took too long to load. Refresh and try again.", ok: false });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { maxSpendUsd: maxSpend };
      if (anthropicInput) body.anthropic = anthropicInput;
      if (geminiInput) body.gemini = geminiInput;

      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as KeyStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save settings.");
      setStatus(data);
      setAnthropicInput("");
      setGeminiInput("");
      setMessage({ text: "Settings saved.", ok: true });
      toast("Settings saved", "ok");
      window.dispatchEvent(new Event("opensrcer-keys-updated"));
    } catch (error) {
      setMessage({ text: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Saving settings timed out. Try again.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  const [confirmClear, setConfirmClear] = useState<"anthropic" | "gemini" | null>(null);

  async function clearKey(key: "anthropic" | "gemini") {
    setSaving(true);
    setConfirmClear(null);
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: "" }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as KeyStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save settings.");
      setStatus(data);
      setMessage({ text: `${key} key cleared.`, ok: true });
      toast(`${key} key cleared`, "signal");
      window.dispatchEvent(new Event("opensrcer-keys-updated"));
    } catch (error) {
      setMessage({ text: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Clearing the key timed out. Try again.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-7">
      {/* Anthropic key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="anthropic-key" className="font-medium text-paper">Anthropic API key</label>
          {loading ? (
            <span className="text-paper-faint text-[11px]">loading…</span>
          ) : status?.anthropic ? (
            <span className="text-xs text-ok border border-ok/30 px-1.5 py-0.5">configured</span>
          ) : status ? (
            <span className="text-xs text-alert border border-alert/30 px-1.5 py-0.5">required</span>
          ) : (
            <span className="text-xs text-alert border border-alert/30 px-1.5 py-0.5">unavailable</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            id="anthropic-key"
            aria-describedby="anthropic-help"
            value={anthropicInput}
            onChange={(e) => setAnthropicInput(e.target.value)}
            placeholder={status?.anthropic ? "••••••• (replace)" : "sk-ant-api03-..."}
            className="flex-1 min-w-0 bg-ink border border-border rounded-md px-3 py-3 text-base text-paper placeholder:text-paper-faint focus:border-signal"
            autoComplete="off"
            spellCheck={false}
          />
          {status?.anthropic && (
            confirmClear === "anthropic" ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => clearKey("anthropic")}
                  disabled={saving}
                  className="text-[11px] text-red-300 border border-red-700 bg-red-950/30 px-2.5 py-1.5 disabled:opacity-50"
                >
                  {saving ? "..." : "confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(null)}
                  className="text-[11px] text-paper-muted hover:text-paper px-1.5 py-1.5"
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear("anthropic")}
                disabled={saving}
                className="text-[11px] text-paper-muted hover:text-red-300 border border-border px-2.5 py-1.5 disabled:opacity-50"
              >
                Clear
              </button>
            )
          )}
        </div>
        <div id="anthropic-help" className="text-xs leading-5 text-paper-muted">
          Required for agent runs. Get one at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
            console.anthropic.com
          </a>
        </div>
      </div>

      {/* Gemini key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="gemini-key" className="font-medium text-paper">Gemini API key</label>
          {loading ? (
            <span className="text-paper-faint text-[11px]">loading…</span>
          ) : status?.gemini ? (
            <span className="text-xs text-ok border border-ok/30 px-1.5 py-0.5">configured</span>
          ) : status ? (
            <span className="text-xs text-paper-muted px-1.5 py-0.5">not configured</span>
          ) : (
            <span className="text-xs text-alert px-1.5 py-0.5">unavailable</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            id="gemini-key"
            aria-describedby="gemini-help"
            value={geminiInput}
            onChange={(e) => setGeminiInput(e.target.value)}
            placeholder={status?.gemini ? "••••••• (replace)" : "AIza..."}
            className="flex-1 min-w-0 bg-ink border border-border rounded-md px-3 py-3 text-base text-paper placeholder:text-paper-faint focus:border-signal"
            autoComplete="off"
            spellCheck={false}
          />
          {status?.gemini && (
            confirmClear === "gemini" ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => clearKey("gemini")}
                  disabled={saving}
                  className="text-[11px] text-red-300 border border-red-700 bg-red-950/30 px-2.5 py-1.5 disabled:opacity-50"
                >
                  {saving ? "..." : "confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(null)}
                  className="text-[11px] text-paper-muted hover:text-paper px-1.5 py-1.5"
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear("gemini")}
                disabled={saving}
                className="text-[11px] text-paper-muted hover:text-red-300 border border-border px-2.5 py-1.5 disabled:opacity-50"
              >
                Clear
              </button>
            )
          )}
        </div>
        <div id="gemini-help" className="text-xs leading-5 text-paper-muted">
          Used for patch review and advisory analysis. Get one at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
            aistudio.google.com
          </a>
        </div>
      </div>

      {/* Agent budget per run */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-paper">Agent budget per run</div>
        <div className="flex flex-wrap gap-1.5">
          {SPEND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMaxSpend(opt.value)}
              aria-pressed={maxSpend === opt.value}
              className={`text-sm min-h-11 rounded-md px-3 py-2 border transition ${
                maxSpend === opt.value
                  ? "border-signal/60 bg-signal/10 text-signal"
                  : "border-border bg-surface/40 text-paper-muted hover:border-border-strong"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-paper-faint">
          Applies to a single Claude agent run. Review, chat, and other provider calls are billed separately.
        </div>
      </div>

      {/* Save */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-12 rounded-md bg-signal px-5 py-3 text-sm font-medium text-ink hover:bg-signal-soft disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {message && (
          <span role="status" className={`text-sm ${message.ok ? "text-ok" : "text-alert"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
