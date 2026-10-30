"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";

type Provider = "copilot" | "claude-subscription" | "codex-subscription" | "anthropic-key" | "openrouter-key";
type KeyStatus = {
  anthropic: boolean; gemini: boolean; maxSpendUsd: number;
  openrouter?: boolean; openrouterModel?: string;
  copilot?: { state: "no_github_token" | "unknown"; detail: string };
  providerOrder?: Provider[]; keyFallback?: boolean; ready?: boolean; problem?: string;
  offered?: Provider[]; availability?: Partial<Record<Provider, { available: boolean; detail: string }>>;
  local?: boolean; hostedSubscription?: boolean;
};

// Plain-language notes (PLAN.md §0.6); no product names used as feature names.
const PROVIDER_INFO: Record<Provider, { title: string; note: string }> = {
  copilot: { title: "GitHub Copilot", note: "Uses the GitHub account you signed in with and bills your own Copilot plan (Copilot Free or Student work too, with a small monthly allowance). It will power the teacher; fix runs on Copilot are not available yet." },
  "claude-subscription": { title: "Claude subscription", note: "Your own Claude Pro or Max plan, for the fix agent only: Anthropic doesn't allow a plan to power anything else here. You sign in to Claude at the start of each run, in a terminal inside that run's isolated worker. opensrcer never sees or keeps your login." },
  "codex-subscription": { title: "ChatGPT subscription", note: "Runs your own signed-in Codex CLI with your ChatGPT plan. Local and self-hosted only." },
  "anthropic-key": { title: "Anthropic API key", note: "Billed per token to your Anthropic API account. Fix runs stop at the budget below." },
  "openrouter-key": { title: "OpenRouter", note: "Any model on OpenRouter, billed to your own OpenRouter credits. Fix runs are capped by steps, not dollars, so set a credit limit on the key at openrouter.ai. OpenRouter accounts are 18+." },
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
  const [openrouterInput, setOpenrouterInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [adult, setAdult] = useState(false);
  const [maxSpend, setMaxSpend] = useState(2);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const { toast } = useToast();
  // A slow first load must not undo what the user already chose or saved.
  const budgetTouched = useRef(false);
  const saved = useRef(false);

  // Back from "Connect OpenRouter" (app/api/settings/openrouter/callback).
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("openrouter");
    if (result === "connected") setMessage({ text: "OpenRouter connected. Your key is saved, encrypted, in this browser only.", ok: true });
    if (result === "failed") setMessage({ text: "OpenRouter was not connected. Try again, or paste a key from openrouter.ai/keys instead.", ok: false });
  }, []);

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
      if (openrouterInput) body.openrouter = openrouterInput;
      if (modelInput) body.openrouterModel = modelInput.trim();

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
      setOpenrouterInput("");
      setModelInput("");
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

  // Copilot is listed (and orderable) even before fix runs can use it.
  const order = (status?.providerOrder ?? ["copilot", "claude-subscription", "codex-subscription", "anthropic-key", "openrouter-key"])
    .filter((p) => p === "copilot" || !status?.offered || status.offered.includes(p));
  function move(index: number, by: -1 | 1) {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void savePayment({ providerOrder: next });
  }

  const [confirmClear, setConfirmClear] = useState<"anthropic" | "gemini" | "openrouter" | null>(null);

  async function clearKey(key: "anthropic" | "gemini" | "openrouter") {
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
        <legend className="text-[16px] font-semibold text-paper">Connect your AI</legend>
        <p id="payment-help" className="text-[14px] leading-[1.55] text-paper-muted">
          opensrcer runs on AI you already have. Runs try these in order; your own plans come first, so you are not charged API prices by default.
        </p>
        {loading ? (
          <p className="text-[12px] text-paper-faint">loading…</p>
        ) : (
          <ol className="card divide-y divide-border-soft overflow-hidden">
            {order.map((provider, index) => {
              const info = PROVIDER_INFO[provider];
              const detected = status?.availability?.[provider];
              const isKey = provider === "anthropic-key" || provider === "openrouter-key";
              const keySaved = provider === "anthropic-key" ? status?.anthropic : status?.openrouter;
              const chip = provider === "copilot"
                ? status?.copilot?.state === "unknown" ? { tone: "ok", text: "GitHub connected" } : { tone: "muted", text: "not signed in" }
                : isKey
                  ? keySaved ? { tone: "ok", text: "key saved" } : { tone: "muted", text: "no key" }
                  : detected?.available ? { tone: "ok", text: "ready" } : { tone: "muted", text: "not available" };
              return (
                <li key={provider} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-paper">
                      <span className="font-mono text-[12.5px] text-paper-muted">{index + 1}.</span>
                      {info.title}
                      <span className={`chip ${chip.tone === "ok" ? "chip-ok" : ""}`}>{chip.text}</span>
                    </p>
                    <p className="mt-1 text-[14px] leading-[1.55] text-paper-muted">{info.note}</p>
                    {!isKey && detected && <p className="mt-1 text-[14px] leading-[1.55] text-paper-dim">{status?.local ? "This machine: " : ""}{detected.detail}</p>}
                    {provider === "copilot" && status?.copilot && <p className="mt-1 text-[14px] leading-[1.55] text-paper-dim">{status.copilot.detail}</p>}
                    {provider === "openrouter-key" && status?.openrouter && status.openrouterModel && (
                      <p className="mt-1 text-[14px] leading-[1.55] text-paper-dim">Model: <code className="font-mono">{status.openrouterModel}</code></p>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => move(index, -1)} disabled={saving || index === 0}
                      aria-label={`Move ${info.title} up`}
                      className="btn-quiet" data-size="sm">↑</button>
                    <button type="button" onClick={() => move(index, 1)} disabled={saving || index === order.length - 1}
                      aria-label={`Move ${info.title} down`}
                      className="btn-quiet" data-size="sm">↓</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!loading && status && !status.local && (
          <p className="text-[14px] leading-[1.55] text-paper-muted">
            {status.hostedSubscription
              ? "Hosted runs ask you to sign in to Claude inside each run's isolated worker. opensrcer never sees or keeps your Claude login."
              : "Subscription sign-in for hosted runs is not enabled on this deployment yet; runs use your API key."}
            {" "}ChatGPT plans are available only when you run opensrcer yourself: hosted use needs OpenAI&apos;s approval.
          </p>
        )}
        {!loading && status?.local && (
          <p className="text-[14px] leading-[1.55] text-paper-muted">
            Local mode uses the Claude Code and Codex logins already on this machine (<code className="font-mono">claude auth login</code>, <code className="font-mono">codex login</code>).{" "}
            <button type="button" onClick={recheck} disabled={checking} className="underline hover:text-paper disabled:opacity-50">
              {checking ? "Checking…" : "Check again"}
            </button>
          </p>
        )}
        <label className="flex items-start gap-2.5 text-[14px] text-paper">
          <input
            type="checkbox"
            checked={status?.keyFallback === true}
            onChange={(e) => void savePayment({ keyFallback: e.target.checked })}
            disabled={saving || loading}
            className="h-6 w-6 shrink-0"
          />
          <span>
            Use my API key when my plan is unavailable
            <span className="block text-[14px] leading-[1.55] text-paper-muted">Off by default, so API spend is never a surprise. Applies when you are signed out or hit your plan&apos;s usage limit.</span>
          </span>
        </label>
        {status && status.ready === false && status.problem && (
          <p role="status" className="callout callout-alert px-3 py-2 text-[14px] leading-[1.55] text-alert">{status.problem}</p>
        )}
      </fieldset>

      {/* Anthropic key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[14px]">
          <label htmlFor="anthropic-key" className="font-medium text-paper">Anthropic API key</label>
          {loading ? (
            <span className="text-paper-faint text-[12px]">loading…</span>
          ) : status?.anthropic ? (
            <span className="chip chip-ok">configured</span>
          ) : status ? (
            <span className="text-[12.5px] text-paper-muted px-1.5 py-0.5">not configured</span>
          ) : (
            <span className="chip chip-alert">unavailable</span>
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
            className="field flex-1 min-w-0"
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
                  className="btn-quiet text-alert" data-size="sm"
                >
                  {saving ? "..." : "confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(null)}
                  className="text-[12px] text-paper-muted hover:text-paper px-1.5 py-1.5"
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear("anthropic")}
                disabled={saving}
                className="btn-quiet" data-size="sm"
              >
                Clear
              </button>
            )
          )}
        </div>
        <div id="anthropic-help" className="text-[14px] leading-[1.55] text-paper-muted">
          The fallback, or your first choice if you rank it first. Get one at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
            console.anthropic.com
          </a>
        </div>
      </div>

      {/* OpenRouter: OpenRouter's own sign-in (OAuth PKCE), or a pasted key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[14px]">
          <span className="font-medium text-paper">OpenRouter</span>
          {loading ? (
            <span className="text-paper-faint text-[12px]">loading…</span>
          ) : status?.openrouter ? (
            <span className="chip chip-ok">connected</span>
          ) : status ? (
            <span className="text-[12.5px] text-paper-muted px-1.5 py-0.5">not connected</span>
          ) : (
            <span className="chip chip-alert">unavailable</span>
          )}
        </div>
        <p className="text-[14px] leading-[1.55] text-paper-muted">
          Sign in on OpenRouter and approve a key for opensrcer; runs bill your own OpenRouter credits. OpenRouter accounts are 18+.
        </p>
        <label className="flex items-start gap-2.5 text-[14px] text-paper">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="h-6 w-6 shrink-0" />
          <span>I am 18 or older</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {adult ? (
            <a href="/api/settings/openrouter/connect?adult=1" className="btn-primary">Connect OpenRouter</a>
          ) : (
            <button type="button" disabled className="btn-primary">Connect OpenRouter</button>
          )}
          {status?.openrouter && (
            confirmClear === "openrouter" ? (
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => clearKey("openrouter")} disabled={saving} className="btn-quiet text-alert" data-size="sm">
                  {saving ? "..." : "confirm"}
                </button>
                <button type="button" onClick={() => setConfirmClear(null)} className="text-[12px] text-paper-muted hover:text-paper px-1.5 py-1.5">
                  cancel
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmClear("openrouter")} disabled={saving} className="btn-quiet" data-size="sm">
                Disconnect
              </button>
            )
          )}
        </div>
        <label htmlFor="openrouter-key" className="block pt-1 text-[14px] text-paper-muted">Or paste a key from openrouter.ai/keys</label>
        <input
          type="password"
          id="openrouter-key"
          value={openrouterInput}
          onChange={(e) => setOpenrouterInput(e.target.value)}
          placeholder={status?.openrouter ? "••••••• (replace)" : "sk-or-v1-..."}
          className="field w-full min-w-0"
          autoComplete="off"
          spellCheck={false}
        />
        <label htmlFor="openrouter-model" className="block pt-1 text-[14px] text-paper-muted">Model for fix runs</label>
        <input
          type="text"
          id="openrouter-model"
          aria-describedby="openrouter-model-help"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          placeholder={status?.openrouterModel ?? "deepseek/deepseek-v4-pro"}
          className="field w-full min-w-0 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <div id="openrouter-model-help" className="text-[14px] leading-[1.55] text-paper-muted">
          An OpenRouter model id, like <code className="font-mono">vendor/model</code>. Leave it empty to keep the one shown.
        </div>
      </div>

      {/* Gemini key */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[14px]">
          <label htmlFor="gemini-key" className="font-medium text-paper">Gemini API key</label>
          {loading ? (
            <span className="text-paper-faint text-[12px]">loading…</span>
          ) : status?.gemini ? (
            <span className="chip chip-ok">configured</span>
          ) : status ? (
            <span className="text-[12.5px] text-paper-muted px-1.5 py-0.5">not configured</span>
          ) : (
            <span className="text-[12.5px] text-alert px-1.5 py-0.5">unavailable</span>
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
            className="field flex-1 min-w-0"
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
                  className="btn-quiet text-alert" data-size="sm"
                >
                  {saving ? "..." : "confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(null)}
                  className="text-[12px] text-paper-muted hover:text-paper px-1.5 py-1.5"
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear("gemini")}
                disabled={saving}
                className="btn-quiet" data-size="sm"
              >
                Clear
              </button>
            )
          )}
        </div>
        <div id="gemini-help" className="text-[14px] leading-[1.55] text-paper-muted">
          Used for patch review and advisory analysis. Get one at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
            aistudio.google.com
          </a>
        </div>
      </div>

      {/* Agent budget per run */}
      <div className="space-y-2">
        <div className="text-[16px] font-semibold text-paper">Agent budget per run</div>
        <div className="flex flex-wrap gap-1.5">
          {SPEND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { budgetTouched.current = true; setMaxSpend(opt.value); }}
              aria-pressed={maxSpend === opt.value}
              className="pill"
              data-edge=""
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-[12.5px] text-paper-muted">
          Caps a single agent run
 paid with your API key. Subscription runs are capped by steps and time instead. Review, chat, and other provider calls are billed separately.
        </div>
      </div>

      {/* Save */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {message && (
          <span role="status" className={`text-[14px] font-medium ${message.ok ? "text-ok" : "text-alert"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
