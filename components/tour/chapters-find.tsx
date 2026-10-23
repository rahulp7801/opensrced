"use client";

// Tour acts "Start" and "Find": what opensrcer is, setting up, finding an
// issue, choosing it, and understanding the code around it.

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, Inline, PageHead, Pips, Press, Reveal, SCOPE_TONE, SEVERITY_TONE, Typed, Count, progress, useAutoScroll, useT, type Chapter } from "./kit";
import { DEMO_ISSUES, DEMO_REPO, DISCOVER_ROWS, ISSUE, ISSUE_BODY, SUGGESTED } from "./data";

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
              <p className="text-[13px] font-semibold text-paper">AI providers</p>
              <p className="mt-1 text-[11.5px] leading-5 text-paper-muted">Add the credentials used to generate and review patches. Each agent run stops at your selected budget.</p>
              <p className="mt-2 text-[11px] leading-5 text-paper-faint">Keys are encrypted in account-bound, HTTP-only cookies and sent only to the selected provider.</p>
            </div>
            <div className="space-y-3 rounded-xl border border-border-soft bg-surface p-3">
              <div>
                <p className="flex items-center gap-2 text-[12px] font-medium text-paper">Anthropic API key {saved ? <StatusChip tone="ok">configured</StatusChip> : <StatusChip tone="alert">required</StatusChip>}</p>
                <p className="mt-1 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-paper">
                  {saved ? "••••••• (replace)" : <Typed text="sk-ant-api03-••••••••••••••••" at={7000} cps={24} />}&nbsp;
                </p>
                <p className="mt-1 text-[11px] text-paper-muted">Required for agent runs. Get one at console.anthropic.com</p>
              </div>
              <div>
                <p className="flex items-center gap-2 text-[12px] font-medium text-paper">Gemini API key <StatusChip tone="muted">not configured</StatusChip></p>
                <p className="mt-1 text-[11px] text-paper-muted">Optional: used for patch review and advisory analysis.</p>
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
  source: "The sign-in and settings screens, with an example key",
  captions: [
    { at: 0, text: "Sign in with GitHub. opensrcer asks only for what it needs: public repositories to open draft pull requests, and your profile to put your name on commits." },
    { at: 6200, text: "Then add your own Anthropic API key. You pay the provider directly, and the key is kept in an encrypted cookie tied to your account." },
    { at: 9800, text: "Pick a spend cap per run. Every agent run stops at it, whatever it's in the middle of." },
    { at: 14600, text: "That's the whole setup. Gemini is optional, for a second opinion on patches." },
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
              <p className="text-[12px] text-paper-muted"><span className="mono-label">discover</span> <Count to={6} at={3800} duration={600} /> repos · <span className="text-[18px] font-semibold text-signal"><Count to={14} at={3800} duration={900} /></span> issues after filters · <Count to={96} at={3800} duration={1100} /> total scanned</p>
            </Reveal>
            <div className="mt-2 overflow-hidden rounded-xl border border-border-soft bg-surface">
              <table className="w-full table-fixed text-left text-[11.5px]">
                <thead className="border-b border-border-soft text-[10px] uppercase tracking-wide text-paper-faint">
                  <tr>
                    <th className="w-[34%] px-3 py-1.5 font-medium sm:w-[24%]">repo</th>
                    <th className="px-2 py-1.5 font-medium">title</th>
                    <th className="w-[64px] px-2 py-1.5 font-medium">scope</th>
                    <th className="hidden w-[78px] px-2 py-1.5 font-medium md:table-cell">severity</th>
                    <th className="hidden w-[92px] px-2 py-1.5 font-medium lg:table-cell">complexity</th>
                    <th className="hidden w-[60px] px-2 py-1.5 font-medium md:table-cell">est.</th>
                    <th className="w-[72px] px-2 py-1.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {DISCOVER_ROWS.map((r, i) => {
                    const lit = focus && "demo" in r;
                    return (
                      <Reveal as="tr" key={r.repo} at={4100 + i * 330} className={cn("border-b border-border-soft last:border-0 transition-colors duration-500", lit && "bg-signal/[0.08] shadow-[inset_3px_0_0_var(--color-signal)]")}>
                        <td className="truncate px-3 py-1.5 font-medium text-paper">{r.repo}</td>
                        <td className="truncate px-2 py-1.5 text-paper-dim"><span className="mr-1 text-paper-muted">#{r.number}</span>{r.title}</td>
                        <td className="px-2 py-1.5"><StatusChip tone={SCOPE_TONE[r.scope] ?? "muted"}>{r.scope}</StatusChip></td>
                        <td className="hidden px-2 py-1.5 md:table-cell"><StatusChip tone={SEVERITY_TONE[r.severity]}>{r.severity}</StatusChip></td>
                        <td className="hidden px-2 py-1.5 lg:table-cell"><Pips value={r.complexity} /></td>
                        <td className="hidden px-2 py-1.5 font-mono text-paper-muted md:table-cell">{r.estimate}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Press at={lit ? 9600 : null} className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] text-paper-dim">open →</Press>
                        </td>
                      </Reveal>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
    { at: 3800, text: "Every open issue is scored for scope, risk and complexity, with a time estimate, so you can see which ones an agent can realistically fix." },
    { at: 7400, text: "This one is a contained bug in a single file, which makes it a good fit. Open it to see the evidence." },
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
                  <span>Scope <StatusChip tone={SCOPE_TONE[issue.scope]}>{issue.scope}</StatusChip></span>
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
                        <p className="mt-0.5 text-[12.5px] font-semibold text-paper">Solve &amp; open PR</p>
                        <p className="text-[11px] leading-5 text-paper-muted">Explore the repository and generate a fix. A draft PR opens only after the configured checks pass.</p>
                      </Reveal>
                      <Reveal at={6000} className="text-[11px] leading-5 text-paper-muted">
                        <p className="mono-label">Scope evidence</p>
                        <p>Files: <code className="font-mono text-paper">{issue.files.join(", ")}</code> · Symbols: <code className="font-mono text-paper">{issue.symbols.join(", ")}</code></p>
                        <p>high confidence · complexity {issue.complexity}/5 · about 30m</p>
                      </Reveal>
                      <Reveal at={7600} className="flex flex-wrap gap-2">
                        <Press at={null} className="rounded-full border border-border px-3 py-1 text-[12px] text-paper-dim">Preview patch</Press>
                        <Press at={null} className="rounded-full border border-signal bg-signal/15 px-3 py-1 text-[12px] font-medium text-signal">
                          <span aria-hidden className="mr-1.5 size-1.5 rounded-full bg-signal" />Solve &amp; open PR
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

// The demo repository as the code graph draws it: its real modules, symbols
// and test cases (rahulp7801/opensrcer-demo), laid out by hand in a 600x400
// viewBox around the index.ts hub, one colour per community.
type GraphKind = "module" | "function" | "type" | "test";
type GraphGroup = "core" | "truncate" | "slugify" | "duration" | "csv" | "tests";
type GraphNode = { id: string; label: string; kind: GraphKind; group: GraphGroup; x: number; y: number; side: "below" | "left" | "right" | "above" | "none" };

const GROUP_COLOR: Record<GraphGroup, string> = {
  core: "#1d1d1f", truncate: "#0056ad", slugify: "#156534", duration: "#b45309", csv: "#6d28d9", tests: "#6e6e73",
};

const G_NODES: GraphNode[] = [
  { id: "index", label: "src/index.ts", kind: "module", group: "core", x: 300, y: 190, side: "below" },
  { id: "truncate.ts", label: "src/truncate.ts", kind: "module", group: "truncate", x: 432, y: 118, side: "above" },
  { id: "truncate", label: "truncate()", kind: "function", group: "truncate", x: 512, y: 182, side: "right" },
  { id: "TruncateOptions", label: "TruncateOptions", kind: "type", group: "truncate", x: 540, y: 66, side: "left" },
  { id: "slugify.ts", label: "src/slugify.ts", kind: "module", group: "slugify", x: 160, y: 270, side: "below" },
  { id: "slugify", label: "slugify()", kind: "function", group: "slugify", x: 70, y: 318, side: "above" },
  { id: "duration.ts", label: "src/duration.ts", kind: "module", group: "duration", x: 440, y: 268, side: "below" },
  { id: "parseDuration", label: "parseDuration()", kind: "function", group: "duration", x: 540, y: 300, side: "below" },
  { id: "UNIT_MS", label: "UNIT_MS", kind: "type", group: "duration", x: 548, y: 232, side: "below" },
  { id: "csv.ts", label: "src/csv.ts", kind: "module", group: "csv", x: 168, y: 112, side: "above" },
  { id: "splitCsvLine", label: "splitCsvLine()", kind: "function", group: "csv", x: 66, y: 70, side: "below" },
  { id: "test", label: "test/text.test.ts", kind: "module", group: "tests", x: 300, y: 318, side: "left" },
  { id: "t-slugify", label: "test: slugify", kind: "test", group: "tests", x: 232, y: 372, side: "none" },
  { id: "t-truncate", label: "test: truncate", kind: "test", group: "tests", x: 282, y: 384, side: "none" },
  { id: "t-duration", label: "test: parseDuration", kind: "test", group: "tests", x: 334, y: 384, side: "none" },
  { id: "t-csv", label: "test: splitCsvLine", kind: "test", group: "tests", x: 384, y: 372, side: "none" },
];

// from → to; "calls" edges are drawn dashed.
const G_EDGES: Array<{ from: string; to: string; kind: "contains" | "uses" | "imports" | "calls" }> = [
  { from: "index", to: "truncate.ts", kind: "imports" }, { from: "index", to: "slugify.ts", kind: "imports" },
  { from: "index", to: "duration.ts", kind: "imports" }, { from: "index", to: "csv.ts", kind: "imports" },
  { from: "truncate.ts", to: "truncate", kind: "contains" }, { from: "truncate.ts", to: "TruncateOptions", kind: "contains" },
  { from: "truncate", to: "TruncateOptions", kind: "uses" },
  { from: "slugify.ts", to: "slugify", kind: "contains" },
  { from: "duration.ts", to: "parseDuration", kind: "contains" }, { from: "duration.ts", to: "UNIT_MS", kind: "contains" },
  { from: "parseDuration", to: "UNIT_MS", kind: "uses" },
  { from: "csv.ts", to: "splitCsvLine", kind: "contains" },
  { from: "test", to: "index", kind: "imports" },
  { from: "test", to: "t-slugify", kind: "contains" }, { from: "test", to: "t-truncate", kind: "contains" },
  { from: "test", to: "t-duration", kind: "contains" }, { from: "test", to: "t-csv", kind: "contains" },
  { from: "t-slugify", to: "slugify", kind: "calls" }, { from: "t-truncate", to: "truncate", kind: "calls" },
  { from: "t-duration", to: "parseDuration", kind: "calls" }, { from: "t-csv", to: "splitCsvLine", kind: "calls" },
];
const COMMUNITIES = new Set(G_NODES.map((n) => n.group)).size - 1; // the hub is not a community

// What each query lights up, matching the query panel's answers. Edges as "from>to".
const QUERY_LIGHT = {
  impact: { focus: ["truncate"], nodes: ["truncate", "truncate.ts", "index", "test", "t-truncate"], edges: ["truncate.ts>truncate", "index>truncate.ts", "test>index", "test>t-truncate", "t-truncate>truncate"], badge: "RISK LOW · 2 dependents" },
  trace: { focus: ["truncate"], nodes: ["index", "truncate.ts", "truncate", "TruncateOptions", "t-truncate", "test"], edges: ["index>truncate.ts", "truncate.ts>truncate", "t-truncate>truncate", "test>t-truncate", "truncate>TruncateOptions"], badge: "trace · 3 hops" },
  ask: { focus: ["truncate", "TruncateOptions"], nodes: ["truncate", "TruncateOptions", "truncate.ts"], edges: ["truncate.ts>truncate", "truncate>TruncateOptions", "truncate.ts>TruncateOptions"], badge: "cited: src/truncate.ts" },
} as const;
const CITATIONS: Record<string, string> = { truncate: "truncate.ts:15", TruncateOptions: "truncate.ts:2" };

// Nodes pop in outward from the hub once the build finishes.
const HUB = G_NODES[0];
const APPEAR = new Map(
  [...G_NODES]
    .sort((a, b) => Math.hypot(a.x - HUB.x, a.y - HUB.y) - Math.hypot(b.x - HUB.x, b.y - HUB.y))
    .map((n, rank) => [n.id, 3700 + rank * 110]),
);

/** An overshooting ease, for nodes popping into place. */
function easeOutBack(p: number): number {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
}

function GraphPane() {
  const t = useT();
  // The graph lights up whatever the query panel's latest answer is about, from the moment it shows.
  const shown = QUERIES.reduce((last, q, i) => (t >= q.showAt ? i : last), -1);
  const queryAt = shown >= 0 ? QUERIES[shown].showAt : null;
  const query = shown >= 0 ? [QUERY_LIGHT.impact, QUERY_LIGHT.trace, QUERY_LIGHT.ask][shown] : null;
  const litNodes = new Set<string>(query?.nodes ?? []);
  const litEdges = new Set<string>(query?.edges ?? []);
  // A slow drift keeps the graph alive; edges follow the drifting nodes.
  const pos = new Map(G_NODES.map((n, i) => [n.id, { x: n.x + Math.sin(t / 1700 + i * 1.3) * 1.6, y: n.y + Math.cos(t / 1900 + i * 0.9) * 1.6 }]));
  const flow = -(t / 28) % 18;

  return (
    <svg viewBox="0 0 600 400" className="h-full w-full" role="img" aria-label="Code graph of the demo repository: modules, symbols and tests, grouped by community">
      <defs>
        <pattern id="graph-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="#d2d2d7" /></pattern>
        <filter id="graph-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        <marker id="graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#a1a1a6" /></marker>
        <marker id="graph-arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#0056ad" /></marker>
      </defs>
      <rect width="600" height="400" fill="url(#graph-dots)" opacity={progress(t, 3600, 4200)} />

      {G_EDGES.map((e) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const key = `${e.from}>${e.to}`;
        const lit = litEdges.has(key);
        // A gentle curve, bending to one side of the straight line.
        const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.12;
        const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.12;
        const drawn = progress(t, Math.max(APPEAR.get(e.from)!, APPEAR.get(e.to)!) + 150, Math.max(APPEAR.get(e.from)!, APPEAR.get(e.to)!) + 700);
        if (drawn === 0) return null;
        const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
        return (
          <g key={key} opacity={query && !lit ? 0.18 : 1}>
            {lit && <path d={d} fill="none" stroke="#0056ad" strokeWidth="7" opacity="0.18" filter="url(#graph-glow)" />}
            <path
              d={d} fill="none" pathLength={1}
              stroke={lit ? "#0056ad" : "#c7c7cc"} strokeWidth={lit ? 2.2 : e.kind === "calls" ? 1 : 1.3}
              strokeDasharray={drawn < 1 ? "1 1" : e.kind === "calls" && !lit ? "0.012 0.012" : undefined}
              strokeDashoffset={drawn < 1 ? 1 - drawn : undefined}
              markerEnd={drawn >= 1 && e.kind !== "contains" ? `url(#${lit ? "graph-arrow-lit" : "graph-arrow"})` : undefined}
            />
            {lit && drawn >= 1 && <path d={d} fill="none" stroke="#ffffff" strokeWidth="2.2" strokeDasharray="3 15" strokeDashoffset={flow} strokeLinecap="round" opacity="0.9" />}
          </g>
        );
      })}

      {G_NODES.map((n) => {
        const p = pos.get(n.id)!;
        const grow = easeOutBack(progress(t, APPEAR.get(n.id)!, APPEAR.get(n.id)! + 450));
        if (grow <= 0) return null;
        const color = GROUP_COLOR[n.group];
        const lit = litNodes.has(n.id);
        const focus = query?.focus.some((f) => f === n.id) ?? false;
        const size = n.kind === "module" ? (n.id === "index" ? 15 : 11) : n.kind === "function" ? 9 : n.kind === "type" ? 8 : 4.5;
        const labelY = n.side === "below" ? size + 13 : n.side === "above" ? -size - 7 : 4;
        const labelX = n.side === "left" ? -size - 6 : n.side === "right" ? size + 6 : 0;
        const anchor = n.side === "left" ? "end" : n.side === "right" ? "start" : "middle";
        return (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={query && !lit ? 0.28 : 1}>
            <g transform={`scale(${grow})`}>
              {focus && [0, 1].map((k) => {
                const ring = ((t + k * 800) % 1600) / 1600;
                return <circle key={k} r={size + 4 + ring * 18} fill="none" stroke={color} strokeWidth="1.5" opacity={(1 - ring) * 0.55} />;
              })}
              {lit && <circle r={size + 7} fill={color} opacity="0.16" filter="url(#graph-glow)" />}
              {n.kind === "module" && <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={size * 0.38} fill={lit ? color : "#ffffff"} stroke={color} strokeWidth={n.id === "index" ? 2.4 : 1.8} />}
              {n.kind === "module" && <rect x={-size * 0.45} y={-size * 0.45} width={size * 0.9} height={size * 0.9} rx={size * 0.2} fill={lit ? "#ffffff" : color} opacity={lit ? 0.9 : 0.85} />}
              {n.kind === "function" && <circle r={size} fill={color} stroke="#ffffff" strokeWidth="2" />}
              {n.kind === "type" && <rect x={-size * 0.75} y={-size * 0.75} width={size * 1.5} height={size * 1.5} transform="rotate(45)" fill={lit ? color : "#ffffff"} stroke={color} strokeWidth="1.8" />}
              {n.kind === "test" && <circle r={size} fill={lit ? color : "#ffffff"} stroke={color} strokeWidth="1.5" />}
            </g>
            {n.side !== "none" && (
              <text x={labelX} y={labelY} textAnchor={anchor} fontSize={n.kind === "module" ? 10 : 10.5} fontWeight={n.kind === "function" || lit ? 600 : 400} fill={lit ? "#1d1d1f" : "#424245"} fontFamily="var(--font-mono)" opacity={progress(t, APPEAR.get(n.id)! + 200, APPEAR.get(n.id)! + 500)}>
                {n.label}
              </text>
            )}
            {query === QUERY_LIGHT.ask && CITATIONS[n.id] && (
              <g transform={n.id === "truncate" ? "translate(-72 0)" : "translate(0 28)"} opacity={progress(t, (queryAt ?? 0) + 200, (queryAt ?? 0) + 600)}>
                <rect x={-50} y={-9} width={100} height={18} rx={9} fill="#0056ad" />
                <text textAnchor="middle" y={4} fontSize="10" fill="#ffffff" fontFamily="var(--font-mono)">{CITATIONS[n.id]}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* What the current query found, in the corner, clear of the nodes it describes. */}
      {query && queryAt !== null && (
        <g transform="translate(10 8)" opacity={progress(t, queryAt, queryAt + 400)}>
          <rect width="150" height="22" rx="11" fill="#1d1d1f" />
          <text x="75" y="15" textAnchor="middle" fontSize="10.5" fill="#ffffff" fontWeight="600" fontFamily="var(--font-sans)">{query.badge}</text>
        </g>
      )}

      <g transform="translate(10 386)" opacity={progress(t, 5200, 5800)} fontFamily="var(--font-sans)" fontSize="10" fill="#636366">
        <rect x="0" y="-7" width="8" height="8" rx="2" fill="#ffffff" stroke="#636366" strokeWidth="1.3" /><text x="12" y="0">module</text>
        <circle cx="62" cy="-3" r="4" fill="#636366" /><text x="70" y="0">function</text>
        <rect x="118" y="-7" width="7" height="7" transform="rotate(45 121.5 -3.5)" fill="#ffffff" stroke="#636366" strokeWidth="1.3" /><text x="130" y="0">type</text>
        <circle cx="160" cy="-3" r="3" fill="#ffffff" stroke="#636366" strokeWidth="1.3" /><text x="167" y="0">test</text>
      </g>
      <text x="590" y="18" textAnchor="end" fontSize="10.5" fill="#636366" fontFamily="var(--font-sans)" opacity={progress(t, 5200, 5800)}>
        {G_NODES.length} nodes · {G_EDGES.length} edges · {COMMUNITIES} communities
      </text>
    </svg>
  );
}

const PHASES = ["Cloning repository", "Parsing source files (tree-sitter AST)", "Writing output files", "Graph built"];

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
    { at: 12000, text: "Or ask in plain English. Answers cite the files and lines they come from, and show what they cost." },
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
