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
];

export function ApiKeysForm() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [anthropicInput, setAnthropicInput] = useState("");
  const [geminiInput, setGeminiInput] = useState("");
  const [maxSpend, setMaxSpend] = useState(2);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d: KeyStatus) => {
        setStatus(d);
        if (d.maxSpendUsd) setMaxSpend(d.maxSpendUsd);
      })
      .catch(() => {});
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
      });
      const data = (await res.json()) as KeyStatus;
      setStatus(data);
      setAnthropicInput("");
      setGeminiInput("");
      setMessage({ text: "Settings saved.", ok: true });
      toast("Settings saved", "ok");
      sessionStorage.removeItem("opensrcer-has-key");
    } catch {
      setMessage({ text: "Failed to save.", ok: false });
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
      });
      const data = (await res.json()) as KeyStatus;
      setStatus(data);
      setMessage({ text: `${key} key cleared.`, ok: true });
      toast(`${key} key cleared`, "signal");
      sessionStorage.removeItem("opensrcer-has-key");
    } catch {
      setMessage({ text: "Failed to clear.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Security explainer */}
      <div className="border border-border-soft bg-ink/40 p-3 text-[11px] text-paper-faint leading-relaxed space-y-1.5">
        <div className="text-[11.5px] text-paper-muted font-medium">How your keys are protected</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>Keys are <span className="text-paper-dim">encrypted (AES-256-GCM)</span> and stored in a browser cookie — never in a database or on disk</li>
          <li>When you click &quot;deep solve&quot;, the server decrypts the key <span className="text-paper-dim">in memory only</span> to call Claude/Gemini, then discards it</li>
          <li>Keys are <span className="text-paper-dim">never logged</span>, never transmitted to any third party beyond the AI provider you chose</li>
          <li>Cookie is httpOnly (invisible to JavaScript) and encrypted (unreadable without the server secret)</li>
          <li>Cleared instantly when you sign out or click &quot;Clear&quot;</li>
        </ul>
      </div>

      {/* Anthropic key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-paper-muted">Anthropic API key</span>
          {status === null ? (
            <span className="text-paper-faint text-[11px]">loading…</span>
          ) : status.anthropic ? (
            <span className="text-[10.5px] text-ok border border-ok/30 px-1.5 py-0.5">configured</span>
          ) : (
            <span className="text-[10.5px] text-alert border border-alert/30 px-1.5 py-0.5">required</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={anthropicInput}
            onChange={(e) => setAnthropicInput(e.target.value)}
            placeholder={status?.anthropic ? "••••••• (replace)" : "sk-ant-api03-..."}
            className="flex-1 min-w-0 bg-ink border border-border px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/60"
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
        <div className="text-[10.5px] text-paper-faint">
          Required for agentic dispatches. Get one at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
            console.anthropic.com
          </a>
        </div>
      </div>

      {/* Gemini key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-paper-muted">Gemini API key</span>
          {status === null ? (
            <span className="text-paper-faint text-[11px]">loading…</span>
          ) : status.gemini ? (
            <span className="text-[10.5px] text-ok border border-ok/30 px-1.5 py-0.5">configured</span>
          ) : (
            <span className="text-[10.5px] text-paper-faint border border-border-soft px-1.5 py-0.5">optional</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={geminiInput}
            onChange={(e) => setGeminiInput(e.target.value)}
            placeholder={status?.gemini ? "••••••• (replace)" : "AIza..."}
            className="flex-1 min-w-0 bg-ink border border-border px-2.5 py-1.5 text-[12px] text-paper placeholder:text-paper-faint focus:outline-none focus:border-signal/60"
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
        <div className="text-[10.5px] text-paper-faint">
          Optional — used for advisory pre-analysis. Get one at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
            aistudio.google.com
          </a>
        </div>
      </div>

      {/* Max spend per task */}
      <div className="space-y-2">
        <div className="text-[12px] text-paper-muted">Max spend per task</div>
        <div className="flex gap-1.5">
          {SPEND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMaxSpend(opt.value)}
              className={`text-[11.5px] px-2.5 py-1 border transition ${
                maxSpend === opt.value
                  ? "border-signal/60 bg-signal/10 text-signal"
                  : "border-border bg-surface/40 text-paper-muted hover:border-border-strong"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-[10.5px] text-paper-faint">
          Hard cap on Anthropic API spend for a single agentic dispatch.
          Claude stops cleanly when the limit is reached.
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-[12px] text-paper border border-border bg-surface/60 hover:bg-surface px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {message && (
          <span className={`text-[11px] ${message.ok ? "text-ok" : "text-alert"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
