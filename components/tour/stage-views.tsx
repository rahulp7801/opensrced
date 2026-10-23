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
import { AppWindow, Pips, Press, Reveal, SCOPE_TONE, SEVERITY_TONE, Typed, progress, useFollow, useT, type Caption, type Chapter } from "./kit";
import { CodeGraph, LIGHTS } from "./graph";
import { DEMO_REPO } from "./data";

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
          <div className="divide-y divide-border-soft">
            {rows.map((r) => {
              // Skipped issues arrive one by one after the switch to All, each with its reason.
              const at = r.reason ? SHOW_ALL_AT + 600 + skipped++ * 1200 : 0;
              return (
                <Reveal key={r.number} at={at} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5", r.reason && "opacity-70")}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-paper-muted">
                      <span className="text-paper-dim">#{r.number}</span><span>Opened {r.opened}</span>
                      <span className="tag" data-tone="info">{r.category}</span>
                      {r.labels.map((l) => <span key={l} className="tag">{l}</span>)}
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
    { at: SHOW_ALL_AT + 600, text: "Assigned to someone? Skip, they're on it. Already fixed in a PR but never closed? Skip. That one alone saves maintainers a pile of duplicate PRs." },
    { at: SHOW_ALL_AT + 4200, text: "Questions, wontfix or duplicate labels, and issues too vague to act on are skipped too, with the reason spelled out." },
    { at: SHOW_ALL_AT + 7200, text: "What's left is actually open to a newcomer, each with its scope, risk, complexity and a time estimate." },
    { at: SHOW_READY_AT, text: "Back to the ready ones. This is the contribution etiquette Claude Code assumes you already know." },
  ],
  View: ScanView,
};

// ── Understand: plain-English questions about the code ──────────────────────

type Turn = { prompt: string; answer: string; cites: string[]; cost: string };
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
function AskPanel({ turns }: { turns: TimedTurn[] }) {
  const t = useT();
  const scrollRef = useFollow(Math.floor(t / 250));
  const typing = turns.find((turn) => t >= turn.typeAt && t < turn.askAt + 150);
  const spent = turns.filter((turn) => t >= turn.doneAt).reduce((sum, turn) => sum + Number(turn.cost.slice(1)), 0);
  return (
    <section aria-label="Ask in plain English" className="flex h-full min-h-0 flex-col rounded-xl border border-border-soft bg-surface">
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-signal text-white"><Sparkle aria-hidden size={15} weight="fill" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-tight text-paper">Ask in plain English</p>
          <p className="text-[11px] leading-tight text-paper-muted">Answered from this repository&apos;s code graph</p>
        </div>
        <span className="font-mono text-[11px] text-ok">${spent.toFixed(4)}</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-3">
        <p className="rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-paper-dim">
          Ask any question in plain English about the codebase. Graph commands like <code className="font-mono">impact truncate</code> answer for free.
        </p>
        {turns.map((turn) => t >= turn.askAt + 150 && (
          <div key={turn.prompt} className="space-y-2">
            <Reveal at={turn.askAt + 150} className="ml-10 rounded-2xl rounded-tr-md bg-paper px-3 py-2 text-[12.5px] leading-5 text-surface">{turn.prompt}</Reveal>
            {t < turn.answerAt ? (
              <div className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5" aria-label="Thinking">
                {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-paper-muted motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />)}
              </div>
            ) : (
              <div className="mr-6 rounded-2xl rounded-tl-md border border-border-soft bg-surface px-3 py-2.5 text-[12.5px] leading-[1.55] text-paper">
                <Typed text={turn.answer} at={turn.answerAt} cps={ANSWER_CPS} />
                <Reveal at={turn.doneAt} className="mt-2 flex flex-wrap items-center gap-1.5">
                  {turn.cites.map((c) => <span key={c} className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-[10.5px] text-signal">{c}</span>)}
                  <span className="ml-auto font-mono text-[10.5px] text-paper-muted">{turn.cost}</span>
                </Reveal>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border-soft p-3">
        <div className={cn("flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 transition-colors", typing ? "border-signal/60" : "border-border")}>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-paper">
            {typing ? <Typed text={typing.prompt} at={typing.typeAt} cps={PROMPT_CPS} /> : <span className="text-paper-muted">Ask about {DEMO_REPO}…</span>}
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
              <div className="relative aspect-[3/2] w-full">
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
    { at: 0, text: "An unfamiliar repository is the next wall a beginner hits. Explore builds a map of it, parsed straight from the source, no AI involved: files, functions and the calls between them." },
    { at: BUILT_AT, text: "And then you just ask, in plain English. No grep, no knowing where to look." },
    { at: FIRST.turns[0].typeAt, text: `The big picture first: “${FIRST.turns[0].prompt}” The answer is built from the repository's own graph, cites the files it's based on, and shows what it cost.` },
    { at: FIRST.turns[1].typeAt, text: `The question you'd normally answer by grepping around: “${FIRST.turns[1].prompt}”` },
    { at: SELECT_AT, text: "Same thing on the map: click truncate() and its connections stand out. One file, its options type, and one test." },
    { at: LAST.turns[0].typeAt, text: `And where your change would be tested: “${LAST.turns[0].prompt}” You know the shape of the fix before an agent writes a line.` },
  ],
  View: StageExploreView,
};

// ── Speaker notes for the tour's own screens ────────────────────────────────

/** Notes for the stage on top of the tour's narration: what sets opensrcer apart
 *  for someone new to open source, and why a maintainer can trust what it sends. */
export function stageNotes(base: { find: Chapter; choose: Chapter; newRun: Chapter; run: Chapter; review: Chapter; pr: Chapter; respond: Chapter; reply: Chapter }) {
  // The review screens with the stage's own notes in place of the tour's narration.
  const ship = (chapter: Chapter, captions: Caption[]): Chapter => ({ ...chapter, captions });
  return {
    find: withNotes(base.find, [
      { at: 0, text: "Claude Code is a power tool for people who already know how to contribute. opensrcer is the guided path from “I want to contribute” to a clean draft pull request. And it starts before Claude Code would: finding something to work on." },
    ]),
    choose: withNotes(base.choose, [
      { at: 0, text: "Pick one that's ready. Everything happens in the browser: nothing to install, nothing to clone, no terminal, no build tools." },
      { at: 7600, text: "Preview is the default; opening a pull request is opt-in. Nothing reaches the project until you decide it should." },
    ]),
    newRun: withNotes(base.newRun, [
      { at: 0, text: "Paste the issue link. Notes steer the agent: keep the public API, add tests." },
    ]),
    run: withNotes(base.run, [
      { at: 0, text: "The agent runs read-only in a throwaway machine, so a hostile repository can never touch your laptop. There's a hard spend cap, a timeout, and one run at a time per account." },
      { at: 9000, text: "It's told to read the contribution guide and PR template and match the project's conventions, keep the diff minimal, and stop and say so rather than guess when it can't find the root cause." },
      { at: 20000, text: "Before anything is published, the patch gets a secret scan. And it's honest: the log says tests weren't run, so the patch is marked unverified. You review it." },
    ]),
    review: withNotes(base.review, [
      { at: 0, text: "This is where the maintainers' worry about AI pull requests comes in. In preview, nothing is published. In live mode the pull request opens as a draft that can't be merged until you mark it ready." },
    ]),
    pr: withNotes(base.pr, [
      { at: 0, text: "Every GitHub step a beginner gets wrong is handled: it forks, branches, and commits under your private noreply email. It picks the base branch from where past PRs were actually merged, falling back to the default branch." },
      { at: 5000, text: "The pull request is always a draft, you are its author, and its description closes the issue. It refuses closed issues and won't open a second PR for the same one. @mentions are disabled, so its text can't ping strangers." },
    ]),
    respond: ship(base.respond, [
      { at: 0, text: "When a maintainer comments, it comes back to one inbox, with the file and line." },
      { at: 5600, text: "Ask for a quick fix. The agent reads the file and its callers and proposes the smallest change that answers the comment." },
      { at: 9800, text: "Before you push, the change is checked for size, secrets, syntax, and whether it touches the file the reviewer meant. It says plainly that tests weren't run." },
      { at: 15400, text: "You review the diff and push it to the same branch yourself. The comment is marked fixed." },
    ]),
    reply: ship(base.reply, [
      { at: 0, text: "Not every comment needs code. For a question, it can draft an answer." },
      { at: 5600, text: "It's a draft. You edit it, you send it: you stay the one talking to the maintainer." },
      { at: 15000, text: "Built so maintainers can trust it: a person is the author, it steers you to issues that are open to contribution, reads each project's contribution guide, and stays small and draft-first." },
      { at: 17000, text: "Coming (not shipped yet): an AI-assisted disclosure in every PR, respecting each project's AI-contribution policy, running the project's tests as evidence, a publish gate where you read it before it's published, flagging issues that already have someone else's open PR, caps on open PRs per repo, and using your Claude or ChatGPT subscription." },
    ]),
  };
}
