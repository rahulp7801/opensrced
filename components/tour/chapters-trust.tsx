"use client";

// Tour act "Trust": the guardrails every run works inside, the controls you
// keep over your account and data, and the close.
// Each guarantee here must stay literally true; see lib/sandbox-egress.ts,
// lib/claude-tools.ts, lib/agentic-pr.ts and app/privacy/page.tsx.

import { cn } from "@/lib/utils";
import { AppWindow, PageHead, Press, Reveal, useAutoScroll, useT, type Chapter } from "./kit";
import { RUN } from "./data";

// ── 12. Guardrails ────────────────────────────────────────────────────────

const FLOW = ["Your issue", "Isolated machine", "Test machine (no keys)", "Your review", "Secret scan", "Draft PR"];

const GUARANTEES = [
  { title: "A fresh machine for every run", text: "Each run gets its own virtual machine, stopped when the run ends." },
  { title: "A short network allowlist", text: "Each machine has one. The agent's machine reaches GitHub, your AI provider and opensrcer's storage; the test machine reaches only package registries and GitHub." },
  { title: "Code runs where your keys aren't", text: "The agent edits and runs the project's tests in a second machine that holds no credentials." },
  { title: "A hard spend limit", text: "Every run stops at your budget, whatever it's in the middle of." },
  { title: "Scanned before it's pushed", text: "A secret scan runs on the patch before anything leaves the machine." },
  { title: "Draft pull requests only", text: "Opened in your name only after you confirm you've read it, saying plainly that AI helped. Nothing merges on its own." },
  { title: "Your keys stay yours", text: "Kept in an encrypted cookie in your browser, sent only to your provider and the worker running your job." },
];

function TrustView() {
  const t = useT();
  return (
    <div className="flex h-full flex-col justify-start overflow-hidden bg-ink px-4 py-5 sm:justify-center sm:px-8">
      <Reveal at={0} className="text-center">
        <p className="display text-[26px] leading-tight text-paper sm:text-[38px]">Nothing ships without you.</p>
        <p className="mt-1 text-[13px] text-paper-muted sm:text-[15px]">Every run is fenced in before it starts.</p>
      </Reveal>
      <ol className="mx-auto mt-5 flex w-full max-w-[860px] flex-wrap items-center justify-center gap-x-1 gap-y-2" aria-label="Where a run goes">
        {FLOW.map((step, i) => {
          const lit = t >= 700 + i * 350;
          return (
            <li key={step} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className={cn("h-px w-3 transition-colors duration-500 sm:w-6", lit ? "bg-signal" : "bg-border")} />}
              <span className={cn("rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-500 sm:text-[12.5px]", lit ? "border-signal/40 bg-signal/10 text-signal" : "border-border text-paper-faint")}>{step}</span>
            </li>
          );
        })}
      </ol>
      <ul className="mx-auto mt-5 grid w-full max-w-[920px] gap-2 sm:grid-cols-2">
        {GUARANTEES.map((g, i) => (
          <Reveal as="li" key={g.title} at={2600 + i * 1500} className="flex gap-2.5 rounded-xl border border-border-soft bg-surface px-3 py-2">
            <span aria-hidden className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-ok text-[10px] font-bold text-white">✓</span>
            <span className="text-[12px] leading-5"><span className="font-semibold text-paper">{g.title}.</span> <span className="hidden text-paper-muted sm:inline">{g.text}</span></span>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}

export const trust: Chapter = {
  id: "trust",
  act: "Trust",
  label: "Guardrails",
  title: "Safe by default",
  duration: 15000,
  source: "How every run is set up",
  captions: [
    { at: 0, text: "Nothing ships without you. Every run is fenced in before it starts." },
    { at: 2600, text: "Each run gets its own virtual machine, with a short network allowlist, and it's stopped when the run ends." },
    { at: 5600, text: "The agent edits and tests only in a machine that holds none of your keys, and it stops at your spend cap." },
    { at: 8600, text: "Nothing is published until you've reviewed it and confirmed. Then the patch is scanned for secrets, and the pull request is only ever a draft, opened in your name, saying plainly that AI helped." },
    { at: 11600, text: "Your AI key stays in an encrypted cookie in your browser, sent only to your provider and the worker running your job." },
  ],
  View: TrustView,
};

// ── 13. Close ─────────────────────────────────────────────────────────────

const RECAP = [
  { value: `#2`, label: "a real issue" },
  { value: `${RUN.seconds} s`, label: "agent time" },
  { value: `$${RUN.cost.toFixed(2)}`, label: "provider spend" },
  { value: `PR #${RUN.pr}`, label: "draft, in your name" },
];

function OutroView() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-ink px-5 py-8 text-center">
      <Reveal at={0}><p className="display text-[34px] leading-[1.05] text-paper sm:text-[52px]">Issues in.<br />Pull requests out.</p></Reveal>
      <Reveal at={700}><p className="mt-3 text-[15px] text-paper-muted sm:text-[17px]">Reviewed by you, every line.</p></Reveal>
      <dl className="mt-8 grid w-full max-w-[720px] grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-soft bg-border-soft sm:grid-cols-4">
        {RECAP.map((r, i) => (
          <Reveal key={r.label} at={1500 + i * 450} className="bg-surface px-3 py-3">
            <dt className="sr-only">{r.label}</dt>
            <dd className="display text-[24px] leading-none text-paper">{r.value}</dd>
            <dd className="mt-1 text-[11.5px] text-paper-muted">{r.label}</dd>
          </Reveal>
        ))}
      </dl>
    </div>
  );
}

export const outro: Chapter = {
  id: "outro",
  act: "Trust",
  label: "Recap",
  title: "From issue to pull request",
  duration: 9000,
  source: "Recap of the real run",
  captions: [
    { at: 0, text: "That's opensrcer: from an open issue to a reviewed draft pull request, with you in charge of every step." },
    { at: 4500, text: `The run you saw was real: one issue, ${RUN.seconds} seconds of agent time, ${Math.round(RUN.cost * 100)} cents, verified with the project's own tests, and a draft pull request. Jump back to any chapter whenever you like.` },
  ],
  View: OutroView,
};

// ── You stay in control ───────────────────────────────────────────────────

// From the Settings confirmation (app/crucible/revoke-all-button.tsx); the last item shortened.
const REVOKE = [
  "Stop your active hosted runs before access is cleared",
  "Disconnect all GitHub organizations you've connected",
  "Revoke all cached installation tokens immediately",
  "Sign this browser out",
];

// From the privacy page (app/privacy/page.tsx).
const PRIVACY = [
  "No advertising, and no analytics or tracking scripts.",
  "Your newest 100 runs and 20 code graphs are kept; older ones are removed automatically.",
  "Logs can contain repository content but never credential values.",
  "Each job runs in a disposable virtual machine that is stopped when the job ends.",
];

function ControlView() {
  const t = useT();
  const confirming = t >= 2600 && t < 8600;
  // Brings the privacy list into view on small screens; a no-op when it fits.
  const scrollRef = useAutoScroll(8800, 11400);
  return (
    <AppWindow path="/crucible" section="none">
      <div ref={scrollRef} className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <PageHead title="Settings" description="Manage provider credentials, GitHub access, and your account." />
        <div className="grid gap-3 md:grid-cols-[190px_minmax(0,1fr)]">
          <div>
            <p className="text-[13px] font-semibold text-paper">Account</p>
            <p className="mt-1 text-[11.5px] leading-5 text-paper-muted">Remove opensrcer&apos;s saved organization connections and end this session.</p>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-alert/30 bg-alert/5 p-3 text-[12px] leading-5">
              <p className="font-semibold text-paper">Disconnect opensrcer</p>
              <p className="text-paper-dim">This removes saved organization connections, revokes cached installation tokens, and signs you out. To remove the GitHub OAuth grant too, revoke it in GitHub application settings.</p>
              {!confirming ? (
                <Press at={2600} className="mt-2 text-[12px] font-medium text-alert">Disconnect all &amp; sign out</Press>
              ) : (
                <Reveal at={2600} className="mt-2 rounded-lg border border-alert/40 bg-surface p-2.5">
                  <p className="font-semibold text-paper">Disconnect this account?</p>
                  <p className="mt-0.5 text-paper-muted">This will:</p>
                  <ul className="mt-1 space-y-0.5 text-[11.5px] text-paper-dim">
                    {REVOKE.map((r, i) => <Reveal as="li" key={r} at={3000 + i * 450}>· {r}</Reveal>)}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
                    <span className="rounded-md bg-alert px-2.5 py-1 font-medium text-white">Stop runs, disconnect, and sign out</span>
                    <Press at={8200} className="rounded-md border border-border px-2.5 py-1 text-paper">Cancel</Press>
                  </div>
                </Reveal>
              )}
            </div>
            {t >= 8600 && (
              <Reveal at={8600} className="rounded-xl border border-border-soft bg-surface p-3">
                <p className="text-[12px] font-semibold text-paper">From the privacy page</p>
                <ul className="mt-1.5 space-y-1">
                  {PRIVACY.map((p, i) => <Reveal as="li" key={p} at={9000 + i * 600} className="flex gap-2 text-[11.5px] leading-5 text-paper-dim"><span className="text-ok">✓</span>{p}</Reveal>)}
                </ul>
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export const control: Chapter = {
  id: "control",
  act: "Trust",
  label: "You're in control",
  title: "You stay in control",
  duration: 16000,
  source: "The Settings account section and the privacy page",
  captions: [
    { at: 0, text: "You can leave whenever you like. One button in Settings stops your runs, disconnects your organizations, revokes its cached tokens and signs you out." },
    { at: 4800, text: "It tells you exactly what it will do before it does it, and what to revoke on GitHub if you want a clean break." },
    { at: 8600, text: "opensrcer runs no ads, analytics or tracking scripts. It keeps only your newest 100 runs and 20 code graphs, and never stores credentials in logs." },
  ],
  View: ControlView,
};
