"use client";

// Tour acts "Start" and "Find": what opensrcer is, setting up, finding an
// issue, choosing it, and understanding the code around it.

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, Inline, PageHead, Pips, Press, Reveal, SCOPE_LABEL, SCOPE_TONE, SEVERITY_TONE, Typed, Count, progress, useAutoScroll, useT, type Chapter } from "./kit";
import { DEMO_ISSUES, DEMO_REPO, DISCOVER_ROWS, ISSUE, ISSUE_BODY, SUGGESTED } from "./data";
import { CodeGraph } from "./graph";

// ── 1. Intro ──────────────────────────────────────────────────────────────

const PILLARS = [
  { name: "Find", line: "Search GitHub for issues an agent can realistically fix." },
  { name: "Explore", line: "Map a codebase and ask how its pieces connect." },
  { name: "Fix", line: "An agent reads the code and writes a patch, in a sandbox." },
  { name: "Ship", line: "Review the patch, open a draft PR, answer reviewers." },
];

function IntroView() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-ink px-5 py-8 text-center">
      <Reveal at={0}><p className="text-[15px] font-semibold tracking-[-0.01em] text-paper">opensrcer</p></Reveal>
      <Reveal at={300}>
        <p className="display mt-2 text-[34px] leading-[1.05] text-paper sm:text-[52px]">Issues in.<br className="sm:hidden" /> Pull requests out.</p>
      </Reveal>
      <Reveal at={900}>
        <p className="mx-auto mt-3 max-w-[46ch] text-balance text-[14px] leading-6 text-paper-muted sm:text-[16px]">An agent that turns open issues into pull requests you review line by line.</p>
      </Reveal>
      <ol className="mt-8 grid w-full max-w-[860px] grid-cols-2 gap-2.5 text-left sm:grid-cols-4 sm:gap-3">
        {PILLARS.map((p, i) => (
          <Reveal as="li" key={p.name} at={1700 + i * 700} className="rounded-2xl border border-border-soft bg-surface p-3.5 sm:p-4">
            <p className="font-mono text-[11px] text-paper-faint">0{i + 1}</p>
            <p className="mt-1 text-[15px] font-semibold text-paper">{p.name}</p>
            <p className="mt-1 hidden text-[12px] leading-5 text-paper-muted sm:block">{p.line}</p>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

export const intro: Chapter = {
  id: "intro",
  act: "Start",
  label: "Overview",
  title: "What opensrcer does",
  duration: 8000,
  source: "Product overview",
  captions: [
    { at: 0, text: "opensrcer helps you contribute to open source: it finds issues worth fixing, works through the code with an AI agent, and opens a draft pull request you review line by line." },
    { at: 3600, text: "This tour follows one real issue from start to finish, then shows everything else the product does." },
    { at: 6000, text: "Every screen is drawn the way the app really looks, and the bug fix at its centre is a real run on a public demo repository." },
  ],
  View: IntroView,
};

// ── Get set up ────────────────────────────────────────────────────────────

const ACCESS = [
  { name: "Public repositories", why: "to fork repositories and open draft pull requests." },
  { name: "Profile and email", why: "to identify your account and attribute commits." },
  { name: "Organization membership", why: "to verify administrator access when you connect an organization." },
];
const BUDGETS = ["$0.10", "$0.25", "$0.50", "$0.75", "$1.00", "$2.00", "$5.00", "$10.00"];

function SetupView() {
  const t = useT();
  const settings = t >= 6200;
  const saved = t >= 15200;
  const scrollRef = useAutoScroll(9200, 12800);
  return (
    <AppWindow path={settings ? "/crucible" : "/login"} section={settings ? "none" : undefined}>
      {!settings ? (
        <div className="grid h-full place-items-center px-4 py-6">
          <div className="w-full max-w-[460px] rounded-2xl border border-border-soft bg-surface p-5">
            <p className="display text-[22px] text-paper">Sign in to opensrcer</p>
            <p className="mt-1 text-[12.5px] text-paper-muted">Connect your GitHub account to browse repositories, start runs, and view your activity.</p>
            <Press at={4800} className="mt-4 w-full rounded-md bg-paper py-2 text-[13px] font-medium text-surface">Sign in with GitHub</Press>
            <p className="mt-5 text-[12px] font-medium text-paper">Access requested</p>
            <ul className="mt-2 space-y-2 text-[12px] leading-5 text-paper-dim">
              {ACCESS.map((a, i) => <Reveal as="li" key={a.name} at={900 + i * 700}><strong className="font-medium text-paper">{a.name}</strong> {a.why}</Reveal>)}
            </ul>
            <Reveal at={3100}><p className="mt-3 text-[11px] leading-5 text-paper-muted">Private repositories require a separate GitHub App connection that you initiate from Settings. You can revoke OAuth access from GitHub at any time.</p></Reveal>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="h-full overflow-hidden px-4 py-4 sm:px-6">
          <PageHead title="Settings" description="Manage provider credentials, GitHub access, and your account." />
          <div className="grid gap-3 md:grid-cols-[190px_minmax(0,1fr)]">
            <div>
              <p className="text-[13px] font-semibold text-paper">How runs are paid for</p>
              <p className="mt-1 text-[11.5px] leading-5 text-paper-muted">Runs use your own Anthropic API key, capped per run. Gemini keys power patch review.</p>
              <p className="mt-2 text-[11px] leading-5 text-paper-faint">opensrcer never asks for, sees, or stores your Claude or ChatGPT login.</p>
            </div>
            <div className="space-y-3 rounded-xl border border-border-soft bg-surface p-3">
              <div>
                <p className="text-[12px] font-medium text-paper">Payment order</p>
                <ol className="mt-1.5 space-y-1.5">
                  <Reveal as="li" at={6800} className={cn("rounded-lg border px-2.5 py-2", t >= 7600 ? "border-signal/50 bg-signal/[0.06]" : "border-border")}>
                    <p className="flex items-center gap-2 text-[12px] font-medium text-paper"><span className="font-mono text-[11px] text-paper-muted">1.</span>Anthropic API key</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-paper-muted">Billed per token to your API account, capped by the budget below.</p>
                  </Reveal>
                </ol>
                <Reveal at={7600}><p className="mt-1.5 text-[11px] leading-5 text-paper-muted">Subscription sign-in for hosted runs is not enabled on this deployment yet; runs use your API key. ChatGPT plans are available only when you run opensrcer yourself: hosted use needs OpenAI&apos;s approval.</p></Reveal>
              </div>
              <Reveal at={9800}>
                <p className="text-[12px] font-medium text-paper">Agent budget per run</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {BUDGETS.map((b) => (
                    <Press key={b} at={b === "$2.00" ? 11600 : null} className={cn("rounded-md border px-2 py-1 text-[11.5px]", b === "$2.00" && t >= 11600 ? "border-signal bg-signal/10 font-medium text-signal" : "border-border text-paper-dim")}>{b}</Press>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-paper-muted">Applies to a single Claude agent run. Review, chat, and other provider calls are billed separately.</p>
              </Reveal>
              <div className="flex items-center gap-3">
                <Press at={14600} className="rounded-full bg-signal px-3.5 py-1 text-[12px] font-medium text-white">{t >= 14600 && !saved ? "Saving…" : "Save settings"}</Press>
                {saved && <span className="text-[12px] text-ok">Settings saved.</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppWindow>
  );
}

export const setup: Chapter = {
  id: "setup",
  act: "Start",
  label: "Get set up",
  title: "Get set up in a minute",
  duration: 18000,
  source: "The sign-in and settings screens",
  captions: [
    { at: 0, text: "Sign in with GitHub. opensrcer asks only for what it needs: public repositories to open draft pull requests, and your profile to put your name on commits." },
    { at: 6200, text: "Then add your own Anthropic API key: runs are paid with it. A fix like the one in this tour costs about ten cents." },
    { at: 9800, text: "Pick a spend cap per run. A run stops at it, whatever it's in the middle of." },
    { at: 14600, text: "That's the whole setup. Claude and ChatGPT plans work when you run opensrcer yourself." },
  ],
  View: SetupView,
};

// ── 2. Find ───────────────────────────────────────────────────────────────

function FindView() {
  const t = useT();
  const searching = t >= 2200 && t < 3800;
  const results = t >= 3800;
  const focus = t >= 7400;
  return (
    <AppWindow path="/discover" section="Find" tab="Browse repos">
      <div className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <PageHead title="Browse repos" description="Search public GitHub repositories by stars and language, then compare their open issues by scope and complexity. Search uses GitHub only and does not consume AI credits." />
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-soft bg-surface p-3">
          <label className="min-w-[110px] flex-1 text-[11px] text-paper-muted">language
            <span className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-paper"><Typed text="typescript" at={500} cps={22} />&nbsp;</span>
          </label>
          <label className="min-w-[90px] flex-1 text-[11px] text-paper-muted">minimum stars
            <span className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-paper"><Typed text="500" at={1300} cps={10} />&nbsp;</span>
          </label>
          <label className="hidden min-w-[90px] flex-1 text-[11px] text-paper-muted sm:block">maximum stars
            <span className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-paper-faint">(no ceiling)</span>
          </label>
          <Press at={2200} className="rounded-full bg-paper px-3.5 py-1.5 text-[12px] font-medium text-surface">{searching ? "Searching GitHub…" : "Search GitHub"}</Press>
        </div>
        {searching && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-border-soft bg-surface px-3 py-2.5 text-[12px] text-paper-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-signal" />
            <span><span className="font-medium text-paper">Searching GitHub</span> · Checking repositories and their open issues.</span>
          </div>
        )}
        {results && (
          <div className="mt-3">
            <Reveal at={3800}>
              <p className="flex items-baseline gap-2 text-[12px] text-paper-muted"><span className="text-[22px] font-semibold leading-none text-signal"><Count to={14} at={3800} duration={900} /></span><span className="text-paper">issues to look at</span> from <Count to={96} at={3800} duration={1100} /> open issues in <Count to={6} at={3800} duration={600} /> repositories</p>
            </Reveal>
            <ul className="mt-2 space-y-1.5">
              {DISCOVER_ROWS.map((r, i) => {
                const lit = focus && "demo" in r;
                return (
                  <Reveal as="li" key={r.repo} at={4100 + i * 330} className={cn("flex items-center justify-between gap-3 rounded-xl border bg-surface px-3 py-2 transition-colors duration-500", lit ? "border-signal/50 bg-signal/[0.06]" : "border-border-soft")}>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-paper">{r.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-paper-muted">
                        <span className="text-paper-dim">{r.repo}</span>
                        <span>#{r.number}</span>
                        <span className="inline-flex items-center gap-1">Size <StatusChip tone={SCOPE_TONE[r.scope] ?? "muted"}>{SCOPE_LABEL[r.scope] ?? r.scope}</StatusChip></span>
                        <span className="hidden items-center gap-1 sm:inline-flex">Difficulty <Pips value={r.complexity} /></span>
                        <span className="hidden md:inline">about {r.estimate.replace("~", "")}</span>
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-[11px] text-paper-muted lg:inline">Save repo</span>
                      <Press at={lit ? 9600 : null} label="Look at this issue" className="whitespace-nowrap rounded-full bg-paper px-2.5 py-0.5 text-[11px] font-medium text-surface">Look at this issue →</Press>
                    </span>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </AppWindow>
  );
}

export const find: Chapter = {
  id: "find",
  act: "Find",
  label: "Browse repos",
  title: "Find an issue worth fixing",
  duration: 11000,
  source: "Example search · fictional repositories, plus the real demo repository",
  captions: [
    { at: 0, text: "Find: search public GitHub repositories by language and stars. Searching uses GitHub only and spends no AI credit." },
    { at: 3800, text: "Each issue it finds is sized up in plain words: how much code it likely touches, how hard it is, and about how long it takes, so you can see which ones an agent can realistically fix." },
    { at: 7400, text: "This one is a contained bug in a single file, which makes it a good fit. Look at it to see the evidence." },
  ],
  View: FindView,
};

// ── Suggested issues ──────────────────────────────────────────────────────

const LANGS = ["python", "typescript", "javascript", "rust", "go", "java"];

function SuggestedView() {
  const t = useT();
  const refreshing = t >= 2600 && t < 3600;
  return (
    <AppWindow path="/issues" section="Find" tab="Issues">
      <div className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="flex items-start gap-3 border-b border-border-soft px-4 py-3">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-signal/10 text-signal">✦</span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-paper">Suggested issues</p>
              <p className="text-[11.5px] text-paper-muted">Beginner-friendly work from active public repositories. <Reveal as="span" at={3800} className="inline"><span className="text-paper-faint">3 low-quality results hidden.</span></Reveal></p>
            </div>
          </div>
          <div className="space-y-2 border-b border-border-soft px-4 py-3">
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-paper-muted">
              <span className="mr-1 font-medium text-paper-dim">Languages</span>
              {LANGS.map((l) => {
                const on = l === "python" || l === "typescript";
                return <span key={l} className={cn("rounded-full border px-2 py-0.5", on ? "border-signal/50 bg-signal/10 text-signal" : "border-border text-paper-muted")}>{l}</span>;
              })}
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-paper-muted">
              <span className="mr-1 font-medium text-paper-dim">Issue labels</span>
              <span className="rounded-full border border-ok/50 bg-ok/10 px-2 py-0.5 text-ok">Good first issue</span>
              <span className="rounded-full border border-border px-2 py-0.5">All beginner tags</span>
              <Press at={2600} className="ml-auto rounded-full border border-border px-2.5 py-0.5 text-paper-dim">{refreshing ? "Refreshing" : "Refresh results"}</Press>
            </p>
          </div>
          <ul className="divide-y divide-border-soft">
            {SUGGESTED.map((s, i) => (
              <Reveal as="li" key={s.repo + s.number} at={3800 + i * 450} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5", i === 0 && t >= 8800 && "bg-signal/[0.06]")}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-paper-muted">
                    <span>{s.repo}</span><span className="text-paper-faint">#{s.number}</span>
                    <span className="tag" data-tone="info">{s.lang}</span>
                    {s.labels.map((l) => <span key={l} className="tag" data-tone={l.includes("good first") ? "ok" : l.includes("bug") ? "alert" : undefined}>{l}</span>)}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-paper">{s.title}</p>
                  <p className="hidden text-[11px] text-paper-muted sm:block">Updated {s.updated} · {s.comments} {s.comments === 1 ? "comment" : "comments"} · {s.stars} stars</p>
                </div>
                <span className="hidden rounded-full bg-surface-3 px-2.5 py-0.5 text-[11.5px] text-paper sm:inline">GitHub ↗</span>
                <Press at={i === 0 ? 11200 : null} className="rounded-full bg-signal/10 px-2.5 py-0.5 text-[11.5px] font-medium text-signal">Fix issue →</Press>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </AppWindow>
  );
}

export const suggested: Chapter = {
  id: "suggested",
  act: "Find",
  label: "Suggested issues",
  title: "Start with a good first issue",
  duration: 14000,
  source: "Example results · fictional repositories",
  captions: [
    { at: 0, text: "Not sure where to start? Suggested issues gathers beginner-friendly work from active public projects in the languages you pick." },
    { at: 3800, text: "Bounty hunts, token farming, social-media and follow-or-star tasks are filtered out, so what's left is real work that maintainers want done." },
    { at: 8800, text: "Each one is a click away from a run. For this tour, we'll follow the demo repository's issue." },
  ],
  View: SuggestedView,
};

// ── 3. Choose ─────────────────────────────────────────────────────────────

function ChooseView() {
  const t = useT();
  const expanded = t >= 2400;
  return (
    <AppWindow path={`/issues?repo=${DEMO_REPO}&issue=2`} section="Find" tab="Issues">
      <div className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <Reveal at={0}>
          <p className="text-[11px] font-semibold text-signal">Scan complete</p>
          <p className="display text-[20px] leading-tight text-paper sm:text-[24px]">{DEMO_REPO}</p>
          <p className="mt-0.5 text-[12px] text-paper-muted">4 open issues; 4 ready for an automated attempt.</p>
        </Reveal>
        <div className="mt-3 space-y-2">
          {DEMO_ISSUES.map((issue, i) => {
            const isTarget = issue.number === ISSUE.number;
            if (expanded && !isTarget) {
              return (
                <Reveal key={issue.number} at={300 + i * 250} className="rounded-xl border border-border-soft bg-surface/70 px-3 py-1.5 text-[11.5px] text-paper-muted">
                  <span className="mr-1.5 text-paper-faint">#{issue.number}</span>{issue.title}
                </Reveal>
              );
            }
            return (
              <Reveal key={issue.number} at={300 + i * 250} className={cn("rounded-xl border bg-surface px-3 py-2.5", isTarget && expanded ? "border-signal/40 shadow-[0_8px_30px_-12px_rgb(0_86_173/0.35)]" : "border-border-soft")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper-muted">
                  <span className="text-paper-faint">#{issue.number}</span>
                  <span>Opened 1d ago</span>
                  <span className="tag" data-tone="signal">new</span>
                  <span className="tag" data-tone="info">bug</span>
                </div>
                <p className="mt-1 text-[13px] font-medium text-paper">{issue.title}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-paper-muted">
                  <span>Likely change <StatusChip tone={SCOPE_TONE[issue.scope]}>{SCOPE_LABEL[issue.scope] ?? issue.scope}</StatusChip></span>
                  <span className="hidden sm:inline">Risk <StatusChip tone={SEVERITY_TONE[issue.risk]}>{issue.risk}</StatusChip></span>
                  <span className="hidden sm:inline-flex items-center gap-1">Complexity <Pips value={issue.complexity} /></span>
                  <span>Estimate {issue.estimate}</span>
                  <StatusChip tone="ok">Ready</StatusChip>
                </div>
                {isTarget && expanded && (
                  <div className="mt-3 grid gap-3 border-t border-border-soft pt-3 md:grid-cols-2">
                    <Reveal at={2600} className="min-w-0">
                      <p className="mono-label">Issue description</p>
                      <p className="mt-1 text-[11.5px] leading-5 text-paper-dim"><Inline text={ISSUE_BODY[0]} /></p>
                      <pre className="mt-2 overflow-hidden rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-[10.5px] leading-[1.55] text-paper-dim">{ISSUE_BODY.slice(1).join("\n")}</pre>
                    </Reveal>
                    <div className="space-y-2.5">
                      <Reveal at={4600} className="rounded-lg border border-border-soft bg-surface-2/60 p-2.5">
                        <p className="mono-label">Recommendation</p>
                        <p className="mt-0.5 text-[12.5px] font-semibold text-paper">Fix it, then review</p>
                        <p className="text-[11px] leading-5 text-paper-muted">The agent explores the repository and writes a fix, then stops for your review. A draft PR opens only when you confirm it on the run page.</p>
                      </Reveal>
                      <Reveal at={6000} className="text-[11px] leading-5 text-paper-muted">
                        <p className="mono-label">Why &apos;{SCOPE_LABEL[issue.scope] ?? issue.scope}&apos;</p>
                        <p>Files: <code className="font-mono text-paper">{issue.files.join(", ")}</code> · Symbols: <code className="font-mono text-paper">{issue.symbols.join(", ")}</code></p>
                        <p>high confidence · complexity {issue.complexity}/5 · about 30m</p>
                      </Reveal>
                      <Reveal at={7600} className="flex flex-wrap gap-2">
                        <Press at={null} className="rounded-full border border-border px-3 py-1 text-[12px] text-paper-dim">Preview patch</Press>
                        <Press at={null} className="rounded-full border border-signal bg-signal/15 px-3 py-1 text-[12px] font-medium text-signal">
                          <span aria-hidden className="mr-1.5 size-1.5 rounded-full bg-signal" />Fix it (you review first)
                        </Press>
                      </Reveal>
                    </div>
                  </div>
                )}
              </Reveal>
            );
          })}
        </div>
      </div>
    </AppWindow>
  );
}

export const choose: Chapter = {
  id: "choose",
  act: "Find",
  label: "Choose",
  title: "Choose the issue",
  duration: 12000,
  source: "Real issue · rahulp7801/opensrcer-demo #2",
  captions: [
    { at: 0, text: "The issue scanner lists a repository's open issues, each with the files and symbols a fix is likely to touch." },
    { at: 2400, text: "Here's the bug report: truncate() cuts words in half and returns one character more than it promises." },
    { at: 7600, text: "Two ways to start. Preview writes a patch you can read without publishing anything. Solve can also open a draft pull request." },
    { at: 10200, text: "You can start a run right here. First, though, a look at the code around this bug." },
  ],
  View: ChooseView,
};

// ── 4. Understand ─────────────────────────────────────────────────────────

// The graph builds itself; it does not react to the queries beside it, because
// the real graph view doesn't either.
function GraphPane() {
  return <CodeGraph buildAt={3700} />;
}

const PHASES = ["Cloning repository", "Reading the source files", "Writing output files", "Graph built"];

function UnderstandView() {
  const t = useT();
  const building = t >= 700 && t < 3600;
  const built = t >= 3600;
  const pct = Math.round(progress(t, 700, 3500) * 100);
  const phase = PHASES[Math.min(3, Math.floor(progress(t, 700, 3600) * 3.999))];
  return (
    <AppWindow path={`/graph?repo=${DEMO_REPO}`} section="Explore">
      <div className="flex h-full flex-col overflow-hidden px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[12px] text-paper">{DEMO_REPO}</span>
          <Press at={650} className="rounded-full bg-paper px-3 py-1 text-[12px] font-medium text-surface">{building ? "building..." : built ? "Rebuild graph" : "Build graph"}</Press>
          {built && <span className="text-[11.5px] text-ok">● ready</span>}
        </div>
        {building && (
          <div className="mt-3 rounded-xl border border-border-soft bg-surface p-3">
            <div className="flex items-center justify-between text-[12px]"><span className="text-paper">{phase}</span><span className="font-mono text-signal">{pct}%</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-signal transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {built && (
          <div className="mt-3 grid min-h-0 flex-1 gap-3 md:grid-cols-[55fr_45fr]">
            <div className="flex min-h-[150px] flex-col overflow-hidden rounded-xl border border-border-soft bg-surface">
              <p className="flex items-center justify-between border-b border-border-soft px-3 py-1.5 text-[11px] text-paper-muted"><span>interactive graph — {DEMO_REPO}</span><span className="font-mono text-ok">parsed · no AI</span></p>
              <div className="min-h-0 flex-1 p-2"><GraphPane /></div>
            </div>
            <QueryPanel />
          </div>
        )}
      </div>
    </AppWindow>
  );
}

export const understand: Chapter = {
  id: "understand",
  act: "Find",
  label: "Explore the code",
  title: "Understand the code",
  duration: 20000,
  source: "Example session on the real demo repository",
  captions: [
    { at: 0, text: "Explore: build a map of any repository. It's parsed from the source code, with no AI model involved." },
    { at: 3600, text: "Files, symbols and the calls between them become a graph you can query." },
    { at: 5400, text: "Graph commands answer instantly and cost nothing. Impact shows what depends on truncate, and how risky a change would be." },
    { at: 8600, text: "Trace follows the connections in and out, so you know what a fix could touch before you make it." },
    { at: 12000, text: "Or ask in plain English. Answers come from the code map: they point to the files involved, and show what they cost." },
    { at: 16800, text: "Follow-up suggestions keep the exploration going, one click each." },
  ],
  View: UnderstandView,
};

// The questions asked on the Explore screen, in order. Graph commands are free;
// a plain-English question uses the AI provider and shows its cost.
// Each pressAt comes after its question has finished typing (typeAt + length at
// the typing speed), so a click-through stop never lands mid-word.
const QUERIES = [
  {
    q: "impact truncate", typeAt: 5400, pressAt: 7100, showAt: 7300, cost: "$0.0000", ai: false,
    body: (
      <pre className="mt-1.5 font-mono text-[10.5px] leading-[1.6] text-paper-dim">{"IMPACT truncate\n  defined  src/truncate.ts:12\n"}<span className="text-info">{"  ← src/index.ts (re-export)\n  ← test/text.test.ts (tests)\n"}</span><span className="text-ok">RISK: LOW</span>{" — 2 dependents"}</pre>
    ),
  },
  {
    q: "trace truncate", typeAt: 8600, pressAt: 10200, showAt: 10400, cost: "$0.0000", ai: false,
    body: (
      <pre className="mt-1.5 font-mono text-[10.5px] leading-[1.6] text-paper-dim">{"TRACE truncate\n"}<span className="text-info">{"  src/index.ts       → truncate"}</span><span className="text-signal">{"  [re-exports]\n"}</span><span className="text-info">{"  test/text.test.ts  → truncate"}</span><span className="text-signal">{"  [calls]\n"}</span><span className="text-info">{"  truncate           → TruncateOptions"}</span><span className="text-signal">{"  [uses]"}</span></pre>
    ),
  },
  {
    q: "Why does truncate return 13 characters?", typeAt: 12000, pressAt: 14100, showAt: 14300, cost: "$0.0031", ai: true,
    body: (
      <p className="mt-1.5 text-[11.5px] leading-5 text-paper-dim">
        <Typed at={14500} cps={70} text={"It slices max characters and then appends the ellipsis (src/truncate.ts:15), so the result is max + 1 long. TruncateOptions.ellipsis says the ellipsis counts toward max (src/truncate.ts:2)."} />
      </p>
    ),
  },
];

function QueryPanel() {
  const t = useT();
  const typing = [...QUERIES].reverse().find((q) => t >= q.typeAt) ?? QUERIES[0];
  const shown = QUERIES.filter((q) => t >= q.showAt).slice(-2);
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-mono text-paper"><Typed key={typing.q} text={typing.q} at={typing.typeAt} cps={typing.ai ? 30 : 16} /></span>
        <Press at={typing.pressAt} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-paper-dim">query</Press>
      </div>
      {shown.map((q) => (
        <Reveal key={q.q} at={q.showAt} className="rounded-xl border border-border-soft bg-surface p-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate"><span className="font-semibold text-signal">Q</span> {q.q}</span>
            <span className="shrink-0">{q.ai && <span className="tag mr-1" data-tone="info">AI</span>}<span className="font-mono text-ok">{q.cost}</span></span>
          </div>
          {q.body}
        </Reveal>
      ))}
      <Reveal at={16800} className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-paper-muted">follow up:</span>
        {["impact TruncateOptions", "trace slugify", "explain src"].map((c) => <span key={c} className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-paper-dim">{c}</span>)}
      </Reveal>
    </div>
  );
}
