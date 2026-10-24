"use client";

// The stage demo's own screens and speaker notes. Everything shown here is what
// the app does today:
//   - the issue scanner's verdicts, with the reasons it gives verbatim
//     (lib/issues.ts, drawn as components/issue-scanner.tsx draws them);
//   - Explore's plain-English questions, which are answered from the repository's
//     code graph, cite file paths and show their cost (app/api/graph/query);
//   - the graph view, where clicking a node picks out its connections.
// The notes carry the pitch: the guided path for someone new to open source, and
// why maintainers can trust what it sends them.

import { ArrowUp, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, LogLine, Pips, Press, Reveal, SCOPE_TONE, SEVERITY_TONE, TimeContext, Typed, progress, useFollow, useT, type Caption, type Chapter } from "./kit";
import { CodeGraph, LIGHTS } from "./graph";
import { REVIEW_PUBLISHED_AT } from "./chapters-fix";
import { DEMO_REPO, RUN } from "./data";


/** A chapter with speaker notes added for the stage, merged in time order. */
export function withNotes(chapter: Chapter, notes: Caption[]): Chapter {
  return { ...chapter, captions: [...chapter.captions, ...notes].sort((a, b) => a.at - b.at) };
}

// ── Find: the issue scanner ──────────────────────────────────────────────────

type ScanRow = { number: number; title: string; category: string; labels: string[]; opened: string; scope?: string; risk?: "low" | "medium"; complexity?: number; estimate?: string; reason?: string };

// EXAMPLE repository: the verdicts and their reasons are the scanner's own wording.
const SCAN_REPO = "acme/ui-kit";
const SCAN: ScanRow[] = [
  { number: 2290, title: "Tooltip flickers when its trigger re-renders", category: "bug", labels: ["bug", "good first issue"], opened: "3d ago", scope: "leaf", risk: "medium", complexity: 2, estimate: "30m" },
  { number: 2288, title: "Select loses focus after clearing the value", category: "bug", labels: ["bug"], opened: "4d ago", reason: "Already assigned to @mira-dev — someone's on it. Skip." },
  { number: 2286, title: "Popover closes when clicking inside a portal", category: "bug", labels: ["bug"], opened: "5d ago", reason: "1 open PR already targets this issue. Review or help with it instead." },
  { number: 2284, title: "DatePicker ignores the locale prop for month names", category: "bug", labels: ["bug"], opened: "6d ago", scope: "leaf", risk: "low", complexity: 2, estimate: "45m" },
  { number: 2279, title: "Modal scroll lock leaks on iOS", category: "bug", labels: ["bug", "ios"], opened: "9d ago", reason: "Appears already resolved (comment by @acme-lead (maintainer) says \"fixed in #2281\"). Skip — the ticket is stale-open." },
  { number: 2271, title: "Docs: the Button size table lists the wrong default", category: "docs", labels: ["documentation", "good first issue"], opened: "12d ago", scope: "doc", risk: "low", complexity: 1, estimate: "15m" },
  { number: 2266, title: "How do I theme the Toast component?", category: "question", labels: ["question"], opened: "14d ago", reason: "Question, not an actionable issue." },
  { number: 2259, title: "Rewrite Table with virtualization", category: "refactor", labels: ["wontfix"], opened: "21d ago", reason: "Labeled as non-actionable." },
  { number: 2252, title: "Broken on Safari", category: "other", labels: [], opened: "25d ago", reason: "Unclear scope — issue body too sparse." },
];
const READY = SCAN.filter((r) => !r.reason);
const SHOW_ALL_AT = 2400; // the presenter switches the filter to All…
const SHOW_READY_AT = 13500; // …and back to Ready once every verdict has been seen

function ScanView() {
  const t = useT();
  const all = t >= SHOW_ALL_AT && t < SHOW_READY_AT;
  const rows = all ? SCAN : READY;
  let skipped = 0;
  return (
    <AppWindow path={`/issues?repo=${SCAN_REPO}`} section="Find" tab="Issues">
      <div className="h-full overflow-hidden px-4 py-3 sm:px-6">
        <div className="rounded-xl border border-border-soft bg-surface">
          <div className="flex items-end justify-between gap-4 border-b border-border-soft px-4 py-3">
            <div>
              <p className="text-[11px] font-medium text-signal">Scan complete</p>
              <p className="text-[16px] font-semibold text-paper">{SCAN_REPO}</p>
              <p className="text-[12px] text-paper-muted"><span className="font-medium text-paper">{SCAN.length}</span> open issues; <span className="font-medium text-signal">{READY.length}</span> ready for an automated attempt.</p>
            </div>
            <div className="text-[11px]">
              <p className="mb-1 text-paper-muted">Readiness</p>
              <div className="inline-flex overflow-hidden rounded-lg border border-border">
                <Press at={SHOW_READY_AT} className={cn("px-2.5 py-1", !all ? "bg-paper font-medium text-surface" : "text-paper-dim")}>Ready ({READY.length})</Press>
                <Press at={SHOW_ALL_AT} className={cn("border-l border-border px-2.5 py-1", all ? "bg-paper font-medium text-surface" : "text-paper-dim")}>All ({SCAN.length})</Press>
              </div>
            </div>
          </div>
          <div data-spot="scan-list" className="divide-y divide-border-soft">
            {rows.map((r) => {
              // Skipped issues arrive one by one after the switch to All, each with its reason.
              const at = r.reason ? SHOW_ALL_AT + 600 + skipped++ * 1200 : 0;
              return (
                <Reveal key={r.number} at={at} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5", r.reason && "opacity-70")}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-paper-muted">
                      <span className="text-paper-dim">#{r.number}</span><span>Opened {r.opened}</span>
                      <span className="tag" data-tone="info">{r.category}</span>
                      {r.labels.filter((l) => l !== r.category).map((l) => <span key={l} className="tag">{l}</span>)}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] font-medium text-paper">{r.title}</p>
                    {!r.reason && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-paper-muted">
                        <span className="inline-flex items-center gap-1"><span className="text-paper-faint">Scope</span><StatusChip tone={SCOPE_TONE[r.scope!] ?? "muted"}>{r.scope}</StatusChip></span>
                        <span className="inline-flex items-center gap-1"><span className="text-paper-faint">Risk</span><StatusChip tone={SEVERITY_TONE[r.risk!]}>{r.risk}</StatusChip></span>
                        <span className="inline-flex items-center gap-1"><span className="text-paper-faint">Complexity</span><Pips value={r.complexity!} /></span>
                        <span><span className="text-paper-faint">Estimate</span> ~{r.estimate}</span>
                        <StatusChip tone="ok">Ready</StatusChip>
                      </p>
                    )}
                    {r.reason && <p className="mt-1 text-[10.5px]"><StatusChip tone="muted">Needs review</StatusChip></p>}
                  </div>
                  {r.reason ? (
                    <p className="max-w-[300px] text-[11px] leading-[1.45] text-paper-dim">{r.reason}</p>
                  ) : (
                    <span className="flex gap-1.5 text-[11px]">
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-paper-dim">Preview patch</span>
                      <span className="rounded-full border border-signal/40 bg-signal/10 px-2.5 py-0.5 font-medium text-signal">Solve &amp; open PR</span>
                    </span>
                  )}
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export const stageScan: Chapter = {
  id: "scan",
  act: "Find",
  label: "Vet the issues",
  title: "Only issues that are open to you",
  duration: SHOW_READY_AT + 3000,
  source: "Example scan; the verdicts are the scanner's own",
  captions: [
    { at: 0, text: "This is where beginners get stuck, and where Claude Code can't help: Claude Code starts once you already have an issue. Here, a repository's newest open issues are read and vetted for you." },
    { at: SHOW_ALL_AT, text: "Show everything it found, including what it filtered out, and why." },
    { at: SHOW_ALL_AT + 600, spot: "scan-list", text: "Assigned to someone? Skip, they're on it. Someone already has a pull request open? Skip, help them instead. Already fixed but never closed? Skip. That one alone saves maintainers a pile of duplicate PRs." },
    { at: SHOW_ALL_AT + 4200, spot: "scan-list", text: "Questions, wontfix or duplicate labels, and issues too vague to act on are flagged too, with the reason spelled out, so you know to pass on them." },
    { at: SHOW_ALL_AT + 7200, text: "What's left is actually open to a newcomer, each with its scope, risk, complexity and a time estimate." },
    { at: SHOW_READY_AT, text: "Back to the ready ones. This is the contribution etiquette Claude Code assumes you already know." },
  ],
  View: ScanView,
};

// ── Understand: plain-English questions about the code ──────────────────────

type Turn = { prompt: string; answer: string; cites: string[]; cost?: string };
type TimedTurn = Turn & { typeAt: number; askAt: number; answerAt: number; doneAt: number };

const PROMPT_CPS = 26; // the presenter's question, typed into the box
const ANSWER_CPS = 75; // the answer, streamed
const THINK_MS = 900;

/** Times the turns one after another from `start`; returns them and when the last ends. */
function schedule(start: number, turns: Turn[]): { turns: TimedTurn[]; end: number } {
  let at = start;
  const timed = turns.map((turn) => {
    const typeAt = at;
    // The Ask stop comes due 600 ms early (kit.tsx Press), so typing must be done before then.
    const askAt = typeAt + Math.ceil((turn.prompt.length / PROMPT_CPS) * 1000) + 900;
    const answerAt = askAt + THINK_MS;
    const doneAt = answerAt + Math.ceil((turn.answer.length / ANSWER_CPS) * 1000);
    at = doneAt + 1400;
    return { ...turn, typeAt, askAt, answerAt, doneAt };
  });
  return { turns: timed, end: at };
}

/** The Explore page's question box as a conversation: each question is typed,
 *  sent (a stop for the presenter), and answered with its sources and cost. */
type PanelText = { title: string; subtitle: string; intro: string; placeholder: string };
const GRAPH_PANEL: PanelText = {
  title: "Ask in plain English",
  subtitle: "Answered from this repository's code graph",
  intro: "Ask any question in plain English about the codebase.",
  placeholder: `Ask about ${DEMO_REPO}…`,
};

function AskPanel({ turns, text = GRAPH_PANEL }: { turns: TimedTurn[]; text?: PanelText }) {
  const t = useT();
  const scrollRef = useFollow(Math.floor(t / 250));
  const typing = turns.find((turn) => t >= turn.typeAt && t < turn.askAt + 150);
  const costs = turns.every((turn) => turn.cost);
  const spent = turns.filter((turn) => t >= turn.doneAt).reduce((sum, turn) => sum + Number((turn.cost ?? "$0").slice(1)), 0);
  return (
    <section data-spot="ask" aria-label="Ask in plain English" className="flex h-full min-h-0 flex-col rounded-xl border border-border-soft bg-surface">
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-signal text-white"><Sparkle aria-hidden size={15} weight="fill" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-paper">{text.title}</p>
          <p className="text-[12px] leading-tight text-paper-muted">{text.subtitle}</p>
        </div>
        {costs && <span className="font-mono text-[12px] text-ok">${spent.toFixed(4)}</span>}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-3">
        <p className="rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5 text-[13.5px] leading-[1.45] text-paper-dim">{text.intro}</p>
        {turns.map((turn) => t >= turn.askAt + 150 && (
          <div key={turn.prompt} className="space-y-2">
            <Reveal at={turn.askAt + 150} className="ml-10 rounded-2xl rounded-tr-md bg-paper px-3 py-2 text-[14px] leading-[1.45] text-surface">{turn.prompt}</Reveal>
            {t < turn.answerAt ? (
              <div className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5" aria-label="Thinking">
                {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-paper-muted motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />)}
              </div>
            ) : (
              <div className="mr-4 rounded-2xl rounded-tl-md border border-border-soft bg-surface px-3 py-2.5 text-[14px] leading-[1.5] text-paper">
                <Typed text={turn.answer} at={turn.answerAt} cps={ANSWER_CPS} />
                <Reveal at={turn.doneAt} className="mt-2 flex flex-wrap items-center gap-1.5">
                  {turn.cites.map((c) => <span key={c} className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-[11.5px] text-signal">{c}</span>)}
                  {turn.cost && <span className="ml-auto font-mono text-[11.5px] text-paper-muted">{turn.cost}</span>}
                </Reveal>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border-soft p-3">
        <div className={cn("flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 transition-colors", typing ? "border-signal/60" : "border-border")}>
          <span className="min-w-0 flex-1 truncate text-[14px] text-paper">
            {typing ? <Typed text={typing.prompt} at={typing.typeAt} cps={PROMPT_CPS} /> : <span className="text-paper-muted">{text.placeholder}</span>}
          </span>
          {turns.map((turn) => turn === typing && (
            <Press key={turn.askAt} at={turn.askAt} label="Ask" className="grid size-7 shrink-0 place-items-center rounded-full bg-signal text-white">
              <ArrowUp aria-hidden size={14} weight="bold" />
            </Press>
          ))}
          {!typing && <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-paper-muted"><ArrowUp size={14} weight="bold" /></span>}
        </div>
      </div>
    </section>
  );
}

const BUILT_AT = 3600;
const FIRST = schedule(BUILT_AT + 800, [
  {
    prompt: "What does this repository do?",
    answer: "It's a small text-utilities library. Four helpers (slugify, truncate, parseDuration and splitCsvLine) each live in their own file under src/, are re-exported from src/index.ts, and are tested together in test/text.test.ts.",
    cites: ["src/index.ts", "test/text.test.ts"], cost: "$0.0021",
  },
  {
    prompt: "Where is truncate used, and what breaks if I change it?",
    answer: "truncate is defined in src/truncate.ts. Inside the repository it's only re-exported by src/index.ts and called by one test, so a change reaches the public API and that test, nothing else.",
    cites: ["src/truncate.ts", "src/index.ts", "test/text.test.ts"], cost: "$0.0028",
  },
]);
// Then the presenter clicks truncate() on the graph to see the same thing on the map.
const SELECT_AT = FIRST.end + 600;
// The graph knows the files, symbols and calls (not function bodies), so every
// question here is one it can answer from that.
const LAST = schedule(SELECT_AT + 2400, [
  {
    prompt: "What do the tests cover, and where would a test for this bug go?",
    answer: "test/text.test.ts has one test for each helper: slugify, truncate, parseDuration and splitCsvLine. A test for this truncate bug belongs next to the existing truncate test in that file.",
    cites: ["test/text.test.ts", "src/truncate.ts"], cost: "$0.0024",
  },
]);
const TURNS = [...FIRST.turns, ...LAST.turns];

// truncate() on the graph, as a share of its 600x400 viewBox, for the click target.
const TRUNCATE_NODE = { left: `${(512 / 600) * 100}%`, top: `${(182 / 400) * 100}%` };

function StageExploreView() {
  const t = useT();
  const built = t >= BUILT_AT;
  const pct = Math.round(progress(t, 700, BUILT_AT - 100) * 100);
  return (
    <AppWindow path={`/graph?repo=${DEMO_REPO}`} section="Explore">
      <div className="flex h-full flex-col overflow-hidden px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[12px] text-paper">{DEMO_REPO}</span>
          <Press at={650} className="rounded-full bg-paper px-3 py-1 text-[12px] font-medium text-surface">{t >= 700 && !built ? "building..." : built ? "Rebuild graph" : "Build graph"}</Press>
          {built && <span className="text-[11.5px] text-ok">● ready · parsed, no AI</span>}
        </div>
        {!built && t >= 700 && (
          <div className="mt-3 rounded-xl border border-border-soft bg-surface p-3">
            <div className="flex items-center justify-between text-[12px]"><span className="text-paper">Parsing source files (tree-sitter AST)</span><span className="font-mono text-signal">{pct}%</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-signal" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {built && (
          <div className="mt-3 grid min-h-0 flex-1 grid-cols-[57fr_43fr] gap-3">
            <div className="flex min-h-0 items-center overflow-hidden rounded-xl border border-border-soft bg-surface p-2">
              <div data-spot="graph" className="relative aspect-[3/2] w-full">
                <CodeGraph buildAt={BUILT_AT + 100} lights={[{ at: SELECT_AT + 200, light: LIGHTS.select }]} />
                <div className="absolute" style={TRUNCATE_NODE}>
                  <Press at={SELECT_AT} label="truncate() on the graph" className="size-8 -translate-x-1/2 -translate-y-1/2 rounded-full">
                    <span className="sr-only">truncate()</span>
                  </Press>
                </div>
              </div>
            </div>
            <AskPanel turns={TURNS} />
          </div>
        )}
      </div>
    </AppWindow>
  );
}

export const stageExplore: Chapter = {
  id: "understand",
  act: "Find",
  label: "Explore the code",
  title: "Ask the code in plain English",
  duration: LAST.end,
  source: "Example session on the real demo repository",
  captions: [
    { at: 0, text: "An unfamiliar repository is the next wall a beginner hits. With Claude Code you'd clone it, install it and start reading. Here nothing is cloned or installed: Explore builds a map of it, parsed straight from the source, no AI involved." },
    { at: BUILT_AT, text: "Then ask about it in plain English, still without having cloned anything. No grep, no knowing where to look, and every answer shows what it cost." },
    { at: FIRST.turns[0].typeAt, spot: "ask", text: `The big picture first: “${FIRST.turns[0].prompt}” The answer is built from the repository's own graph, cites the files it's based on, and shows what it cost.` },
    { at: FIRST.turns[1].typeAt, spot: "ask", text: `The question you'd normally answer by grepping around: “${FIRST.turns[1].prompt}”` },
    { at: SELECT_AT, spot: "graph", text: "Same thing on the map: click truncate() and its connections stand out. One file, its options type, and one test." },
    { at: LAST.turns[0].typeAt, spot: "ask", text: `And where your change would be tested: “${LAST.turns[0].prompt}” You know the shape of the fix before an agent writes a line.` },
  ],
  View: StageExploreView,
};

// ── Speaker notes for the tour's own screens ────────────────────────────────

/** Notes for the stage on top of the tour's narration: what sets opensrcer apart
 *  for someone new to open source, and why a maintainer can trust what it sends. */
export function stageNotes(base: { choose: Chapter; newRun: Chapter; run: Chapter; review: Chapter; pr: Chapter; respond: Chapter; reply: Chapter }) {
  // The review screens with the stage's own notes in place of the tour's narration.
  const ship = (chapter: Chapter, captions: Caption[]): Chapter => ({ ...chapter, captions });
  return {
    choose: withNotes(base.choose, [
      { at: 0, text: "Pick one that's ready. Everything happens in the browser: nothing to install, nothing to clone, no terminal, no build tools." },
      { at: 7600, text: "Preview is the default; opening a pull request is opt-in. Nothing reaches the project until you decide it should." },
    ]),
    newRun: withNotes(base.newRun, [
      { at: 0, text: "Paste the issue link. Notes steer the agent: keep the public API, add tests." },
    ]),
    run: withNotes(base.run, [
      { at: 0, spot: "log-guardrails", text: "One click on the issue started this run; there was nothing to set up. The agent works in a throwaway machine, so a hostile repository can never touch your laptop. There's a hard spend cap, a timeout, and one run at a time per account." },
      { at: 9000, spot: "log-tools", text: "It's told to read the contribution guide and PR template and match the project's conventions, keep the diff minimal, and stop and say so rather than guess when it can't find the root cause." },
      { at: 20000, spot: "log-preview", text: "And it's honest. This run is from before tests ran on the hosted site, so the log says verification: not run. Nothing has been published; you review it first." },
    ]),
    review: withNotes(base.review, [
      { at: 0, text: "This is where the maintainers' worry about AI pull requests is answered. Nothing is published until you've read the patch and confirmed you can explain it to reviewers." },
      { at: REVIEW_PUBLISHED_AT + 4500, spot: "next-steps", text: "It's a draft that can't be merged until you mark it ready. And it refuses to publish at all if someone else already has a pull request open on the issue, or if the project bans AI contributions." },
    ]),
    pr: withNotes(base.pr, [
      { at: 0, spot: "pr-facts", text: "Every GitHub step a beginner gets wrong is handled: it forks, branches, and commits under your private noreply email. It picks the base branch from where past PRs were actually merged, falling back to the default branch." },
      { at: 5000, text: "The pull request is always a draft, you are its author, and its description closes the issue. It refuses closed issues and won't open a second PR for the same one. @mentions are disabled, so its text can't ping strangers." },
      { at: 6200, spot: "pr-body", text: "And it discloses itself: an AI assistance section says who asked, which model, and exactly what was or wasn't tested. On projects that require a sign-off on every commit, it adds yours." },
    ]),
    respond: ship(base.respond, [
      { at: 0, text: "When a maintainer comments, it comes back to one inbox, with the file and line." },
      { at: 5600, text: "Ask for a quick fix. The agent reads the file and its callers and proposes the smallest change that answers the comment." },
      { at: 9800, spot: "verify-checks", text: "Before you push, the change is checked for size, secrets, syntax, and whether it touches the file the reviewer meant. It says plainly that tests weren't run." },
      { at: 15400, text: "You review the diff and push it to the same branch yourself. The comment is marked fixed." },
    ]),
    reply: ship(base.reply, [
      { at: 0, text: "Not every comment needs code. For a question, it can draft an answer." },
      { at: 5600, text: "It's a draft. You edit it, you send it: you stay the one talking to the maintainer." },
      { at: 15000, text: "Built so maintainers can trust it: a person is the author, it steers you to issues that are open to contribution, reads each project's contribution guide, and stays small and draft-first." },
      { at: 16000, text: "And it proves its fixes: the project's own tests run in a machine that holds none of your keys, and the pull request shows the exact commands and that the new test fails without the fix. On a real React bug, its fix matched the one the maintainers merged." },
      { at: 17500, text: "On your own machine it can run on your own Claude or ChatGPT subscription, so no API bill. Signing in with a subscription on the hosted site is coming; it isn't shipped yet." },
    ]),
  };
}

// ── Opening: the same contribution, by hand and with opensrcer ──────────────

// What a first contribution asks of you with a coding agent alone, and with opensrcer.
const BY_HAND = [
  "Find an issue nobody else is working on",
  "Check it isn't already fixed in a pull request",
  "Read CONTRIBUTING and the PR template",
  "Install the tools, clone, install dependencies",
  "Fork, add a remote, create a branch",
  "Fix it",
  "Commit with the right name and email",
  "Push and open a pull request",
  "Write a description that closes the issue",
];
const GUIDED = ["Pick an issue that's ready", "Review the patch", "Publish a draft pull request"];
const GUIDED_AT = 600 + BY_HAND.length * 450 + 700;

function CompareView() {
  return (
    <div className="grid h-full grid-cols-[1.25fr_1fr] gap-6 bg-ink p-10">
      <Reveal at={150} className="flex flex-col rounded-[24px] border border-border-soft bg-surface p-7">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-paper-muted">Contributing with Claude Code</p>
        <ol className="mt-4 space-y-2.5">
          {BY_HAND.map((step, i) => (
            <Reveal as="li" key={step} at={600 + i * 450} className="flex items-baseline gap-3 text-[17px] text-paper-dim">
              <span className="w-5 shrink-0 text-right font-mono text-[13px] text-paper-faint">{i + 1}</span>
              <span data-spot={step === "Fix it" ? "compare-fix" : undefined}>{step}{step === "Fix it" && <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-[12px] text-paper-muted">Claude Code helps here</span>}</span>
            </Reveal>
          ))}
        </ol>
      </Reveal>
      <Reveal at={GUIDED_AT} spot="compare-guided" className="flex flex-col justify-center rounded-[24px] bg-signal p-8 text-white shadow-[0_30px_80px_-30px_rgb(0_86_173/0.6)]">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/75">With opensrcer</p>
        <ol className="mt-5 space-y-5">
          {GUIDED.map((step, i) => (
            <Reveal as="li" key={step} at={GUIDED_AT + 400 + i * 600} className="flex items-center gap-4 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15 font-mono text-[16px]">{i + 1}</span>{step}
            </Reveal>
          ))}
        </ol>
      </Reveal>
    </div>
  );
}

export const stageCompare: Chapter = {
  id: "compare",
  act: "Start",
  label: "By hand, or guided",
  title: "Your first contribution, two ways",
  duration: GUIDED_AT + 400 + GUIDED.length * 600 + 1500,
  source: "What a first contribution asks of you",
  captions: [
    { at: 0, text: "Claude Code is a great power tool, for people who already know how to contribute. Here's what a first contribution actually asks of you." },
    { at: 600 + 5 * 450, spot: "compare-fix", text: "Only one of these nine steps is writing the fix. The rest is open-source etiquette and GitHub mechanics, and that's where beginners get stuck or get it wrong." },
    { at: GUIDED_AT, spot: "compare-guided", text: "opensrcer is the guided path: pick an issue that's ready, review the patch, publish a draft pull request. Everything else on that list is done for you, or checked for you. Let me show you." },
  ],
  View: CompareView,
};

// ── Ship: what it did on GitHub, as the real pull request shows it ──────────

// PR #6 on rahulp7801/opensrcer-demo, as GitHub reports it (gh pr view 6). No fork:
// the demo repository is the user's own; on someone else's, it forks first.
const PR_FACTS: Array<[string, string]> = [
  ["Branch", RUN.branch],
  ["Into", "main"],
  ["Commit author", "76501505+rahulp7801@users.noreply.github.com"],
  ["Status", "Draft, opened by rahulp7801"],
  ["Closes", "#2 (“Fixes #2” in the description)"],
];

// The card makes way before the notes reach the PR's AI-assistance section, which it would cover.
const FACTS_AT = 2200;
const FACTS_GONE_AT = 6600;

/** The pull request screen with the GitHub steps it took, read off the PR itself. */
export function withPrFacts(chapter: Chapter): Chapter {
  const Inner = chapter.View;
  function View() {
    const t = useT();
    return (
      <div className="relative h-full">
        <Inner />
        {t < FACTS_GONE_AT + 400 && <div style={{ opacity: 1 - progress(t, FACTS_GONE_AT, FACTS_GONE_AT + 400) }}><Reveal at={FACTS_AT} spot="pr-facts" className="absolute bottom-5 right-5 z-10 w-[400px] rounded-2xl border border-border-soft bg-surface/95 p-4 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.35)] backdrop-blur">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-signal">What it did on GitHub</p>
          <dl className="mt-2 space-y-1.5">
            {PR_FACTS.map(([k, v], i) => (
              <Reveal key={k} at={FACTS_AT + 300 + i * 450} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-[12.5px]">
                <dt className="text-paper-muted">{k}</dt>
                <dd className="break-all font-mono text-[11.5px] text-paper">{v}</dd>
              </Reveal>
            ))}
          </dl>
        </Reveal></div>}
      </div>
    );
  }
  return { ...chapter, View };
}

// ── Ship: "ask about this change", the PR page's chat ───────────────────────

// The PR page's chat (app/prs/[owner]/[repo]/[number]/page.tsx): once a fix is
// generated, "ask about this change" opens it, and Claude answers with the fix as
// context (via /api/prs/draft-reply). It stays open on the page, so it's there for
// the next comment too. The conversation here is an example.
const CHANGE_PANEL: PanelText = {
  title: "Ask about this change",
  subtitle: "Ask Claude to explain the reasoning, potential risks, or alternatives",
  intro: "Ask anything about the generated fix: why it chose this approach, what could go wrong, alternative approaches, etc.",
  placeholder: "Ask about this change…",
};
const FIX_QUESTIONS: Turn[] = [
  {
    prompt: "Explain this follow-up change in plain English.",
    answer: "Before, it only trimmed spaces from the end of the cut text before adding the ellipsis. Now it also trims a trailing comma, semicolon or colon, so “The quick, brown” cut at 11 becomes “The quick…” instead of “The quick,…”. It's one line, line 24 of src/truncate.ts.",
    cites: [],
  },
  {
    prompt: "Could this break anything?",
    answer: "Only results that end in one of those marks right at the cut change, and they get a character shorter. A trailing period or other punctuation is kept. The change adds no test and the project's tests weren't run, so say that in your reply.",
    cites: [],
  },
];
const SEGMENTER_QUESTION: Turn[] = [
  {
    prompt: "The reviewer asked why I didn't use Intl.Segmenter for the word boundary. What is it, and is my fix wrong without it?",
    answer: "Intl.Segmenter is built into JavaScript and splits text into words using each language's rules, so it works for languages like Japanese or Thai that don't put spaces between words. Your fix finds word boundaries at spaces, as the function already did, so it isn't wrong for text with spaces; text without them is cut the same way as before. Switching to Intl.Segmenter is a bigger change, which fits better as a follow-up.",
    cites: [],
  },
];

/** A PR-page chapter with the chat open beside it. At pauseAt the page holds
 *  while the questions are asked and answered, then carries on where it was. */
function withChangeChat(chapter: Chapter, o: { openAt: number; pauseAt: number; turns: Turn[]; before?: Turn[]; notes: Caption[] }): Chapter {
  const asked = schedule(o.pauseAt + 500, o.turns);
  const hold = asked.end - o.pauseAt;
  // Earlier questions on the same page, already answered.
  const before: TimedTurn[] = (o.before ?? []).map((turn) => ({ ...turn, typeAt: -1, askAt: -1, answerAt: -1, doneAt: -1 }));
  const Inner = chapter.View;
  function View() {
    const t = useT();
    const page = t < o.pauseAt ? t : t < o.pauseAt + hold ? o.pauseAt : t - hold;
    return (
      <div className="relative h-full [&_[data-chat-room]]:pr-[468px]">
        <TimeContext.Provider value={page}><Inner /></TimeContext.Provider>
        <Reveal at={o.openAt} spot="chat" className="absolute bottom-3 right-3 top-[112px] z-10 w-[450px] shadow-[0_20px_50px_-20px_rgb(0_0_0/0.3)]">
          <AskPanel turns={[...before, ...asked.turns]} text={CHANGE_PANEL} />
        </Reveal>
      </div>
    );
  }
  const shifted = chapter.captions.map((c) => (c.at >= o.pauseAt ? { ...c, at: c.at + hold } : c));
  return { ...chapter, duration: chapter.duration + hold, captions: [...shifted, ...o.notes].sort((a, b) => a.at - b.at), View };
}

/** Fix a comment: ask about the fix before pushing it. */
export function withFixChat(chapter: Chapter): Chapter {
  const pauseAt = 13000;
  const timed = schedule(pauseAt + 500, FIX_QUESTIONS).turns;
  return withChangeChat(chapter, {
    openAt: 3400, pauseAt, turns: FIX_QUESTIONS,
    notes: [
      { at: timed[0].typeAt, spot: "chat", text: "This is the point: it explains, it doesn't take over. Before you push anything, ask about the change in plain English, so you can explain it to the maintainer yourself." },
      { at: timed[1].typeAt, spot: "chat", text: "And what could go wrong. The answer is honest that nothing was tested." },
    ],
  });
}

/** Answer a question: understand it before drafting a reply. */
export function withQuestionChat(chapter: Chapter): Chapter {
  const pauseAt = 2000;
  const timed = schedule(pauseAt + 500, SEGMENTER_QUESTION).turns;
  return withChangeChat(chapter, {
    openAt: 0, pauseAt, turns: SEGMENTER_QUESTION, before: FIX_QUESTIONS,
    notes: [
      { at: timed[0].typeAt, spot: "chat", text: "A beginner may not even understand the question. Ask first, in plain English, then answer the maintainer as someone who knows what they're talking about." },
    ],
  });
}

// ── Fix: when it says no ────────────────────────────────────────────────────

// The run page's review panel when a blocker applies (components/publish-panel.tsx):
// the reason is shown and there is no confirm box and no Publish button. EXAMPLE:
// a fictional project and guide; the wording is lib/contrib-guard.ts's.
const BAN_REPO = "acme/forms";
const BAN_EXCERPT = "We don't accept pull requests written by AI tools.";

function RefusedView() {
  return (
    <AppWindow path={`/dispatches?dispatch=c_example`} section="Fix" tab="Runs">
      <div className="p-6">
        <div className="mx-auto max-w-[860px] overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="border-b border-border px-5 py-3">
            <p className="text-[13px] text-paper-muted">{BAN_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#412</span></p>
            <p className="mt-0.5 text-[17px] font-medium text-paper">Form reset doesn&apos;t clear validation errors</p>
          </div>
          <Reveal at={400} spot="refusal" className="px-5 py-4 text-[15px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[16px] font-medium text-paper">Review before publishing</p>
              <span className="text-alert">Verification: not verified (no code was run)</span>
            </div>
            <p className="mt-1.5 text-paper-muted">Nothing has been posted. Publishing opens a draft PR from your account with exactly this patch and text (1 file).</p>
            <p role="alert" className="mt-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2.5 text-alert">Blocked: this project does not accept AI-generated contributions (CONTRIBUTING.md: &quot;{BAN_EXCERPT}&quot;)</p>
          </Reveal>
        </div>
      </div>
    </AppWindow>
  );
}

export const stageRefused: Chapter = {
  id: "refused",
  act: "Fix",
  label: "When it says no",
  title: "When it says no",
  duration: 3000,
  source: "Example: a fictional project whose guide bans AI",
  captions: [
    { at: 0, spot: "refusal", text: "And it says no. This project's contribution guide bans AI-written pull requests, so publishing is refused, quoting the guide. There's no confirm box and no Publish button; the preview is still yours to learn from. Same when someone else already has a pull request open on the issue." },
  ],
  View: RefusedView,
};

// ── Close: why this isn't AI slop ───────────────────────────────────────────

// Each row is something opensrcer does today (on the hosted site unless it says otherwise).
const SLOP: Array<[string, string]> = [
  ["Nobody asked for it", "Steers you to issues that are open to you: it flags assigned, already-fixed and vague issues, and refuses projects whose guide bans AI."],
  ["Someone's already on it", "It won't publish while another pull request targets the issue."],
  ["The sender can't explain it", "Nothing publishes until you've read the patch and confirmed you can explain it. The chat helps you get there."],
  ["Hidden AI", "Every pull request says who asked, which model, and what was and wasn't tested."],
  ["Untested", "It runs the project's tests in a machine with no credentials and re-runs them on the final patch; when the fix adds a test, it checks that test fails without the fix. No test it can run? It says unverified."],
  ["Sent in bulk", "Always a draft, with you as the author. One open pull request per project per person, and at most three a day."],
];
const SLOP_STEP = 1600;

function SlopView() {
  return (
    <div className="flex h-full flex-col justify-center bg-ink px-12 py-10">
      <Reveal at={150}><p className="text-[30px] font-semibold tracking-[-0.02em] text-paper">What makes an AI pull request slop, and what opensrcer does about it</p></Reveal>
      <div className="mt-6 divide-y divide-border-soft rounded-[22px] border border-border-soft bg-surface">
        {SLOP.map(([problem, answer], i) => (
          <Reveal key={problem} at={700 + i * SLOP_STEP} className="grid grid-cols-[260px_minmax(0,1fr)] items-baseline gap-6 px-6 py-3.5">
            <p className="text-[18px] font-semibold text-alert">{problem}</p>
            <p className="text-[17px] leading-[1.4] text-paper">{answer}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

export const stageSlop: Chapter = {
  id: "slop",
  act: "Ship",
  label: "Not slop",
  title: "Why this isn't AI slop",
  duration: 700 + SLOP.length * SLOP_STEP + 1500,
  source: "What opensrcer does today",
  captions: [
    { at: 0, text: "The fair worry about a tool like this is AI slop: pull requests nobody asked for, from people who can't explain them. So here's what slop is made of, and what opensrcer does about each." },
    { at: 700 + 2 * SLOP_STEP, text: "The heart of it: you can't publish what you can't explain, and the chat is there so you can." },
    { at: 700 + 5 * SLOP_STEP, text: "It's built to make better contributors, not more pull requests. Thank you." },
  ],
  View: SlopView,
};

// ── Fix: a verified run, now that tests run on the hosted site ──────────────

// Verbatim from a real hosted run (rahulp7801/opensrcer-demo #3, a dry run, 2026-10-24),
// after hosted test runs shipped (OPENSRCER_HOSTED_EXEC=1). Its spend line and
// guardrails line are left out (that run used a test cap).
const VERIFIED_LOG = [
  "[exec] mode=remote (exec VM provided by the web app)",
  "[exec] box remote up, 0ab7ea99bc22 loaded as baseline 41db2904dcf2 in 0s",
  "[setup] no environment recipe for this repository; the agent installs what it needs",
  "[agentic-dispatcher] mcp: opensrcer-repo-tools=connected tools=12 model=claude-sonnet-5",
  "[exec] final patch = git diff of the workspace (1551 bytes)",
  "[verify] re-running 1 test and 0 lint command(s) on the final patch",
  "[verify] ─────────────────────────────",
  "[verify] status=verified regression=reproduced",
  "[verify] reason=declared tests pass, and fail with the source change reverted",
  "[verify] test: npm test",
  "[verify]   exit=0 · 0.3s",
  "[verify] fail-before: (source change reverted) npm test",
  "[verify]   exit=1 · 0.2s",
  "[verify] ─────────────────────────────",
  "[preview] ready for review: \"Fix parseDuration to sum compound durations like \"1h30m\"\" (2 file(s), sign-off=false, verification=verified)",
  "[preview] nothing has been published; review the patch and evidence, then use Publish on the run page",
];
const LINE_MS = 450;
const VERIFY_AT = 600 + 5 * LINE_MS; // when the [verify] block starts

function VerifiedView() {
  const t = useT();
  const shown = VERIFIED_LOG.filter((_l, i) => t >= 600 + i * LINE_MS);
  const verified = shown.length === VERIFIED_LOG.length;
  return (
    <AppWindow path="/dispatches" section="Fix" tab="Runs">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-border-soft bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#3</span> · dry run</p>
            <p className="mt-0.5 truncate text-[15px] font-medium text-paper">parseDuration returns NaN for compound durations like &quot;1h30m&quot;</p>
          </div>
          {verified ? <StatusChip tone="ok">verified</StatusChip> : <StatusChip tone="signal">live</StatusChip>}
        </div>
        <div className="term min-h-0 flex-1 overflow-hidden rounded-2xl px-4 py-3 font-mono text-[12.5px] leading-[1.6]">
          {shown.map((l) => <LogLine key={l} text={l} spot={l.startsWith("[verify]") ? "verify" : undefined} />)}
        </div>
      </div>
    </AppWindow>
  );
}

export const stageVerified: Chapter = {
  id: "verified",
  act: "Fix",
  label: "Tests, verified",
  title: "Tests that prove the fix",
  duration: 600 + VERIFIED_LOG.length * LINE_MS + 1500,
  source: "Real hosted run on opensrcer-demo #3 (dry run)",
  captions: [
    { at: 0, text: "Here's a run from now that tests run on the hosted site, on another issue. The agent edits the code and runs the project's tests in a second machine that holds no credentials." },
    { at: VERIFY_AT, spot: "verify", text: "Then opensrcer re-runs the tests itself on the final patch. When the fix comes with a new test, it puts the old code back to check that test fails without the fix. This run did: regression reproduced." },
    { at: VERIFY_AT + 9 * LINE_MS, spot: "verify", text: "And when a project has no test it can run, it says unverified instead of pretending. Maintainers get evidence, not promises." },
  ],
  View: VerifiedView,
};
