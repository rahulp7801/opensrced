"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";

type Provider = "claude-subscription" | "codex-subscription" | "anthropic-key";
type KeyStatus = {
  anthropic: boolean; gemini: boolean; maxSpendUsd: number;
  providerOrder?: Provider[]; keyFallback?: boolean; ready?: boolean; problem?: string;
  offered?: Provider[]; availability?: Partial<Record<Provider, { available: boolean; detail: string }>>;
  local?: boolean; hostedSubscription?: boolean;
};

// Plain-text descriptions; no product names used as feature names.
const PROVIDER_INFO: Record<Provider, { title: string; note: string }> = {
  "claude-subscription": { title: "Claude subscription", note: "Recommended. Runs Claude Code with your own Claude Pro, Max, Team or Enterprise plan; no API charges." },
  "codex-subscription": { title: "ChatGPT subscription", note: "Runs your own signed-in Codex CLI with your ChatGPT plan. Local and self-hosted only." },
  "anthropic-key": { title: "Anthropic API key", note: "Billed per token to your API account, capped by the budget below." },
};

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
  // A slow first load must not undo what the user already chose or saved.
  const budgetTouched = useRef(false);
  const saved = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/keys", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load settings.");
        return r.json();
      })
      .then((d: KeyStatus) => {
        if (!saved.current) setStatus(d);
        if (d.maxSpendUsd && !budgetTouched.current) setMaxSpend(d.maxSpendUsd);
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
      const data = (await res.json().catch(() => ({}))) as KeyStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not save settings (${res.status}).`);
      saved.current = true;
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

  const [checking, setChecking] = useState(false);

  // Order and fallback save on change: they are choices, not secrets to type.
  async function savePayment(update: { providerOrder?: Provider[]; keyFallback?: boolean }) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as KeyStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not save settings (${res.status}).`);
      saved.current = true;
      setStatus(data);
      window.dispatchEvent(new Event("opensrcer-keys-updated"));
    } catch (error) {
      setMessage({ text: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Saving settings timed out. Try again.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function recheck() {
    setChecking(true);
    try {
      const res = await fetch("/api/settings/keys?recheck=1", { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error("Could not check sign-ins.");
      setStatus(await res.json());
    } catch {
      setMessage({ text: "Could not check sign-ins. Try again.", ok: false });
    } finally {
      setChecking(false);
    }
  }

  const order = (status?.providerOrder ?? ["claude-subscription", "codex-subscription", "anthropic-key"]).filter((p) => !status?.offered || status.offered.includes(p));
  function move(index: number, by: -1 | 1) {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void savePayment({ providerOrder: next });
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
      const data = (await res.json().catch(() => ({}))) as KeyStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not save settings (${res.status}).`);
      saved.current = true;
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
      {/* How runs are paid for */}
      <fieldset className="space-y-3" aria-describedby="payment-help">
        <legend className="text-sm font-medium text-paper">Payment order</legend>
        <p id="payment-help" className="text-xs leading-5 text-paper-muted">
          Runs try these in order. Your own subscription comes first, so you are not charged API prices by default.
        </p>
        {loading ? (
          <p className="text-[11px] text-paper-faint">loading…</p>
        ) : (
          <ol className="divide-y divide-border-soft overflow-hidden rounded-md border border-border bg-surface/30">
            {order.map((provider, index) => {
              const info = PROVIDER_INFO[provider];
              const detected = status?.availability?.[provider];
              const isKey = provider === "anthropic-key";
              const chip = isKey
                ? status?.anthropic ? { tone: "ok", text: "key saved" } : { tone: "muted", text: "no key" }
                : detected?.available ? { tone: "ok", text: "ready" } : { tone: "muted", text: "not available" };
              return (
                <li key={provider} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-paper">
                      <span className="font-mono text-xs text-paper-muted">{index + 1}.</span>
                      {info.title}
                      <span className={`rounded-full border px-1.5 py-0.5 text-xs ${chip.tone === "ok" ? "border-ok/30 text-ok" : "border-border text-paper-muted"}`}>{chip.text}</span>
                    </p>
                    <p className="mt-1 text-xs leading-5 text-paper-muted">{info.note}</p>
                    {!isKey && detected && <p className="mt-1 text-xs leading-5 text-paper-dim">{status?.local ? "This machine: " : ""}{detected.detail}</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => move(index, -1)} disabled={saving || index === 0}
                      aria-label={`Move ${info.title} up`}
                      className="min-h-9 rounded-md border border-border px-2.5 text-xs text-paper-muted hover:text-paper disabled:opacity-40">↑</button>
                    <button type="button" onClick={() => move(index, 1)} disabled={saving || index === order.length - 1}
                      aria-label={`Move ${info.title} down`}
                      className="min-h-9 rounded-md border border-border px-2.5 text-xs text-paper-muted hover:text-paper disabled:opacity-40">↓</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!loading && status && !status.local && (
          <p className="text-xs leading-5 text-paper-muted">
            {status.hostedSubscription
              ? "Hosted runs ask you to sign in to Claude inside each run's isolated worker. opensrcer never sees or keeps your Claude login."
              : "Subscription sign-in for hosted runs is not enabled on this deployment yet; runs use your API key."}
            {" "}ChatGPT plans are available only when you run opensrcer yourself: hosted use needs OpenAI&apos;s approval.
          </p>
        )}
        {!loading && status?.local && (
          <p className="text-xs leading-5 text-paper-muted">
            Local mode uses the Claude Code and Codex logins already on this machine (<code className="font-mono">claude auth login</code>, <code className="font-mono">codex login</code>).{" "}
            <button type="button" onClick={recheck} disabled={checking} className="underline hover:text-paper disabled:opacity-50">
              {checking ? "Checking…" : "Check again"}
            </button>
          </p>
        )}
        <label className="flex items-start gap-2.5 text-sm text-paper">
          <input
            type="checkbox"
            checked={status?.keyFallback === true}
            onChange={(e) => void savePayment({ keyFallback: e.target.checked })}
            disabled={saving || loading}
            className="h-6 w-6 shrink-0 accent-[var(--color-signal)]"
          />
          <span>
            Use my API key when my plan is unavailable
            <span className="block text-xs leading-5 text-paper-muted">Off by default, so API spend is never a surprise. Applies when you are signed out or hit your plan&apos;s usage limit.</span>
          </span>
        </label>
        {status && status.ready === false && status.problem && (
          <p role="status" className="rounded-md border border-alert/30 bg-alert/5 px-3 py-2 text-xs leading-5 text-alert">{status.problem}</p>
        )}
      </fieldset>

      {/* Anthropic key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="anthropic-key" className="font-medium text-paper">Anthropic API key</label>
          {loading ? (
            <span className="text-paper-faint text-[11px]">loading…</span>
          ) : status?.anthropic ? (
            <span className="rounded-full text-xs text-ok border border-ok/30 px-1.5 py-0.5">configured</span>
          ) : status ? (
            <span className="text-xs text-paper-muted px-1.5 py-0.5">not configured</span>
          ) : (
            <span className="rounded-full text-xs text-alert border border-alert/30 px-1.5 py-0.5">unavailable</span>
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
                  className="rounded-full text-[11px] text-alert border border-alert/30 bg-alert/5 px-2.5 py-1.5 disabled:opacity-50"
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
                className="rounded-full text-[11px] text-paper-muted hover:text-alert border border-border px-2.5 py-1.5 disabled:opacity-50"
              >
                Clear
              </button>
            )
          )}
        </div>
        <div id="anthropic-help" className="text-xs leading-5 text-paper-muted">
          The fallback, or your first choice if you rank it first. Get one at{" "}
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
            <span className="rounded-full text-xs text-ok border border-ok/30 px-1.5 py-0.5">configured</span>
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
                  className="rounded-full text-[11px] text-alert border border-alert/30 bg-alert/5 px-2.5 py-1.5 disabled:opacity-50"
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
                className="rounded-full text-[11px] text-paper-muted hover:text-alert border border-border px-2.5 py-1.5 disabled:opacity-50"
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
              onClick={() => { budgetTouched.current = true; setMaxSpend(opt.value); }}
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
          Caps a single agent run paid with your API key. Subscription runs are capped by steps and time instead. Review, chat, and other provider calls are billed separately.
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
