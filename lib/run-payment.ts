// Which credential pays for a run.
//
// The default order is PLAN.md §0.6: GitHub Copilot, then a Claude plan (fix
// agent only), then the user's Anthropic key, then their OpenRouter key; the
// user can reorder. Subscriptions ranked above a key keep it from being spent
// unless the user ranked the key above them, or opted in to "use my API key
// when my plan is unavailable" (default off, so API spend is never a
// surprise). Anything else fails with a NoRunCredentialError that says what
// to do.
//
// A Claude plan only ever pays for the fix agent (the unmodified Claude Code
// CLI). Anthropic forbids routing any other feature through a user's plan, so
// the teacher asks teacherProviders(), which never returns it.
//
// Host logins (the Claude Code / Codex CLI already signed in on this machine)
// are only offered where the operator IS the user: local mode, or a
// self-hosted instance whose operator sets OPENSRCER_LOCAL_SUBSCRIPTION=1.
// On a multi-user deployment that would bill one person's plan for everyone,
// which Anthropic's terms forbid ("route requests through ... plan credentials
// on behalf of their users").

import { execFile } from "node:child_process";
import { AGENT_PROVIDERS, PROVIDER_LABELS, type AgentProvider } from "./agent-invocation";
import { childEnv } from "./child-env";
import { cloudExecution } from "./cloud-run-state";

export type PaymentPrefs = { order: AgentProvider[]; keyFallback: boolean };
export const DEFAULT_ORDER: AgentProvider[] = ["copilot", "claude-subscription", "codex-subscription", "anthropic-key", "openrouter-key"];

/** Paid per token with the user's own key (as opposed to a plan). */
const KEY_PROVIDERS: AgentProvider[] = ["anthropic-key", "openrouter-key"];
/** What may power the teacher: never a Claude or ChatGPT plan (PLAN.md §0.6). */
const TEACHER_PROVIDERS: AgentProvider[] = ["copilot", "anthropic-key", "openrouter-key"];

export type ProviderStatus = { available: boolean; detail: string };
export type Availability = Partial<Record<AgentProvider, ProviderStatus>>;

/** The user's OpenRouter key and the model it runs. */
export type OpenRouterCredential = { key: string; model: string };

export type RunPayment = {
  provider: AgentProvider;
  /** Present only when the key pays (primary) or may take over (opted-in fallback). */
  anthropicKey?: string;
  /** May a subscription run that hits its plan limit be re-run on the Anthropic key? */
  keyFallback: boolean;
  /** openrouter-key runs: the user's OpenRouter key and model. */
  openrouterKey?: string;
  agentModel?: string;
};

/** No credential the user allowed can pay for this run. Safe to show. */
export class NoRunCredentialError extends Error {}

/** Valid, de-duplicated order with every provider present exactly once. */
export function normalizeOrder(value: unknown): AgentProvider[] {
  const picked = Array.isArray(value) ? value.filter((p): p is AgentProvider => AGENT_PROVIDERS.includes(p)) : [];
  return [...new Set([...picked, ...DEFAULT_ORDER])];
}

export function hostLoginsAllowed(): boolean {
  if (cloudExecution()) return false;
  return (process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production") || process.env.OPENSRCER_LOCAL_SUBSCRIPTION === "1";
}

/** Hosted Claude sign-in inside the run's VM. Off until verified end to end. */
export function hostedSubscriptionEnabled(): boolean {
  return cloudExecution() && process.env.OPENSRCER_HOSTED_SUBSCRIPTION === "1";
}

/** Providers this deployment can use for a fix run, before checking any
 *  login. Copilot is not among them until its adapter exists
 *  (TODO(copilot-fix-agent) in lib/agent-invocation.ts). */
export function offeredProviders(): AgentProvider[] {
  if (hostLoginsAllowed()) return AGENT_PROVIDERS.filter((p) => p !== "copilot");
  // Hosted ChatGPT plan usage needs OpenAI's approval for remotely hosted apps.
  return hostedSubscriptionEnabled() ? ["claude-subscription", ...KEY_PROVIDERS] : [...KEY_PROVIDERS];
}

/** Teacher providers in the user's order. A Claude (or ChatGPT) plan is never
 *  one of them, whatever the user ranked first. */
export function teacherProviders(settings: { providerOrder?: unknown }): AgentProvider[] {
  return normalizeOrder(settings.providerOrder).filter((p) => TEACHER_PROVIDERS.includes(p));
}

/** Pure decision: walk the user's order over what is offered and available. */
export function choosePayment(
  prefs: PaymentPrefs, offered: AgentProvider[], availability: Availability, anthropicKey: string | null,
  openrouter: OpenRouterCredential | null = null,
): RunPayment {
  const order = normalizeOrder(prefs.order).filter((p) => offered.includes(p));
  const reasons: string[] = [];
  for (const [index, provider] of order.entries()) {
    if (KEY_PROVIDERS.includes(provider)) {
      // A key pays when nothing but keys is ranked above it, or with the opt-in.
      const allowed = prefs.keyFallback || order.slice(0, index).every((p) => KEY_PROVIDERS.includes(p));
      if (!allowed) continue;
      if (provider === "anthropic-key" && anthropicKey) return { provider, anthropicKey, keyFallback: prefs.keyFallback };
      if (provider === "openrouter-key" && openrouter) return { provider, openrouterKey: openrouter.key, agentModel: openrouter.model, keyFallback: false };
      continue;
    }
    const status = availability[provider];
    if (status?.available) {
      return { provider, keyFallback: prefs.keyFallback && Boolean(anthropicKey), ...(prefs.keyFallback && anthropicKey ? { anthropicKey } : {}) };
    }
    reasons.push(`${PROVIDER_LABELS[provider]}: ${status?.detail ?? "not checked"}`);
  }
  const hasKey = Boolean(anthropicKey || openrouter);
  const keyHint = !hasKey
    ? "add an Anthropic API key or connect OpenRouter in Settings"
    : "turn on \"Use my API key when my plan is unavailable\" in Settings, or rank your key first";
  throw new NoRunCredentialError(
    order.some((p) => !KEY_PROVIDERS.includes(p))
      ? `No subscription can pay for this run (${reasons.join("; ")}). Sign in, or ${keyHint}.`
      : `No API key configured. Add an Anthropic key or connect OpenRouter in Settings → Connect your AI.`,
  );
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { env, timeout: 15_000, windowsHide: true, maxBuffer: 64_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
      resolve({ code, out: `${stdout}\n${stderr}` });
    });
  });
}

/** Status env: no API key or token, so the CLI reports its own login. */
function statusEnv(): NodeJS.ProcessEnv {
  return childEnv({ CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME });
}

/** Parse `claude auth status --json`. Only a claude.ai login is a subscription. */
export function claudeStatusFrom(code: number, out: string): ProviderStatus {
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  let parsed: { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown } = {};
  try { parsed = JSON.parse(json); } catch { /* handled below */ }
  if (code === -1 && !json) return { available: false, detail: "the claude CLI is not installed or did not answer" };
  if (parsed.loggedIn !== true) return { available: false, detail: "not signed in (run `claude auth login`)" };
  if (parsed.authMethod !== "claude.ai") return { available: false, detail: `signed in with ${String(parsed.authMethod)}, not a Claude plan` };
  const plan = typeof parsed.subscriptionType === "string" && /^[a-z_]{1,20}$/.test(parsed.subscriptionType) ? parsed.subscriptionType : "unknown";
  return { available: true, detail: `signed in to Claude (${plan} plan)` };
}

/** Parse `codex login status`. Only a ChatGPT login is a subscription. */
export function codexStatusFrom(code: number, out: string): ProviderStatus {
  if (/logged in using chatgpt/i.test(out)) return { available: true, detail: "signed in with ChatGPT" };
  if (/logged in using an api key/i.test(out)) return { available: false, detail: "signed in with an API key, not a ChatGPT plan" };
  if (code === -1 && !/not logged in/i.test(out)) return { available: false, detail: "the codex CLI is not installed (set OPENSRCER_CODEX_BIN)" };
  return { available: false, detail: "not signed in (run `codex login`)" };
}

export type CopilotStatus = { state: "no_github_token" | "unknown"; detail: string };

/** GitHub Copilot on the user's own GitHub sign-in, without spending anything.
 *  The Copilot SDK's account/quota calls (`account.getQuota`, the runtime's
 *  `copilotUser` snapshot) run inside its Copilot CLI runtime process, which
 *  a web request cannot start; GitHub has no documented REST call for an
 *  individual's Copilot plan. So with a token the answer is "unknown" until
 *  that runtime exists (TODO(copilot-runtime): ask it for the quota then).
 *  Never makes a paid Copilot request. */
export async function copilotStatus(token: string | null): Promise<CopilotStatus> {
  if (!token) return { state: "no_github_token", detail: "Sign in with GitHub to use Copilot." };
  return { state: "unknown", detail: "Uses your GitHub sign-in. Plan and remaining allowance can't be checked yet." };
}

let cached: { at: number; value: Availability } | null = null;

/** What this machine's CLIs are signed in to. Reads only the CLIs' own status
 *  output, never a credentials file. Cached briefly: runs are not that frequent. */
export async function detectHostLogins(force = false): Promise<Availability> {
  if (!hostLoginsAllowed()) return {};
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.value;
  const env = statusEnv();
  const [claude, codex] = await Promise.all([
    run(process.env.CLAUDE_BIN || "claude", ["auth", "status", "--json"], env),
    run(process.env.OPENSRCER_CODEX_BIN || "codex", ["login", "status"], env),
  ]);
  const value: Availability = {
    "claude-subscription": claudeStatusFrom(claude.code, claude.out),
    "codex-subscription": codexStatusFrom(codex.code, codex.out),
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Availability for this deployment: host logins locally; hosted Claude is
 *  "available" because the user signs in inside the run's VM. */
export async function currentAvailability(force = false): Promise<Availability> {
  if (hostedSubscriptionEnabled()) return { "claude-subscription": { available: true, detail: "you sign in to Claude inside the run's isolated worker" } };
  return detectHostLogins(force);
}
