"use client";

// The stage demo's own screens and speaker notes. Everything shown here is what
// the app does today:
//   - the issue scanner's verdicts, with the reasons it gives verbatim
//     (lib/issues.ts, drawn as components/issue-scanner.tsx draws them);
//   - Explore's plain-English questions, which are answered from the repository's
//     code graph, point to the files involved and show their cost (app/api/graph/query);
//   - the graph view, where clicking a node picks out its connections.
// The notes carry the pitch: the guided path for someone new to open source, and
// why maintainers can trust what it sends them.

import { ArrowUp, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, Pips, Press, Reveal, SCOPE_LABEL, SCOPE_TONE, SEVERITY_TONE, TimeContext, Typed, progress, useFollow, useT, type Caption, type Chapter } from "./kit";
import { CodeGraph, LIGHTS } from "./graph";
import { REVIEW_CONFIRM_AT, REVIEW_PUBLISH_AT, REVIEW_PUBLISHED_AT } from "./chapters-fix";
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
                        <span className="inline-flex items-center gap-1"><span className="text-paper-faint">Likely change</span><StatusChip tone={SCOPE_TONE[r.scope!] ?? "muted"}>{SCOPE_LABEL[r.scope!] ?? r.scope}</StatusChip></span>
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
                      <span className="rounded-full border border-signal/40 bg-signal/10 px-2.5 py-0.5 font-medium text-signal">Fix it (you review first)</span>
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
  headlines: [{ at: 0, text: "It only picks issues that are open to you." }],
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
const FIRST = schedule(BUILT_AT + 1600, [
  {
    prompt: "Where is truncate used, and what breaks if I change it?",
    answer: "truncate is defined in src/truncate.ts. Inside the repository it's only re-exported by src/index.ts and called by one test, so a change reaches the public API and that test, nothing else.",
    cites: ["src/truncate.ts", "src/index.ts", "test/text.test.ts"], cost: "$0.0028",
  },
]);
// Then the presenter clicks truncate() on the graph to see the same thing on the map.
const SELECT_AT = FIRST.end + 600;
const TURNS = FIRST.turns;

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
            <div className="flex items-center justify-between text-[12px]"><span className="text-paper">Reading the source files</span><span className="font-mono text-signal">{pct}%</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-signal" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {built && (
          <div className="mt-3 grid min-h-0 flex-1 grid-cols-[57fr_43fr] gap-3">
            <div className="flex min-h-0 items-center overflow-hidden rounded-xl border border-border-soft bg-surface p-2">
              <div data-spot="graph" className="relative aspect-[3/2] w-full">
                <CodeGraph buildAt={BUILT_AT + 100} lights={[{ at: SELECT_AT + 200, light: LIGHTS.select }]} />
                <div className="absolute" style={TRUNCATE_NODE}>
                  <Press at={SELECT_AT} label="truncate() on the graph" className="h-8 w-[104px] -translate-x-4 -translate-y-1/2 rounded-full">
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
  duration: SELECT_AT + 3500,
  source: "Example session on the real demo repository",
  headlines: [
    { at: 0, text: "Understand the code before you change it." },
    { at: FIRST.turns[0].typeAt, text: "Ask about it in plain English." },
  ],
  captions: [
    { at: 0, text: "Before changing anything, understand the code. Explore maps the repository straight from the source: no AI, nothing cloned, nothing installed." },
    { at: BUILT_AT, spot: "graph", text: "Files, functions, and the calls between them. (For the curious: it's parsed with tree-sitter.)" },
    { at: FIRST.turns[0].typeAt, spot: "ask", text: `Then ask the question you'd normally grep for: “${FIRST.turns[0].prompt}” The answer comes from the map and points to the files involved.` },
    { at: SELECT_AT, spot: "graph", text: "Same thing on the map: click truncate() and its connections light up. One file, its options type, one test. You know the shape of the fix before an agent writes a line." },
  ],
  View: StageExploreView,
};

// ── Speaker notes and headlines for the tour's review and pull request ──────

/** A chapter with the stage's own notes in place of the tour's narration, and its headlines. */
function staged(chapter: Chapter, headlines: Caption[], captions: Caption[]): Chapter {
  return { ...chapter, headlines, captions };
}

/** The review and the pull request as the stage tells them. */
export function stageNotes(base: { review: Chapter; pr: Chapter }) {
  return {
    review: staged(base.review, [
      { at: 0, text: "It explains every change in plain English." },
      { at: REVIEW_CONFIRM_AT - 1500, text: "You confirm you understand it." },
      { at: REVIEW_PUBLISH_AT, text: "A human publishes. Nothing is hidden." },
    ], [
      { at: 0, spot: "review-found", text: "It explains every change: what was wrong, what changed and why, and what to double-check, in plain words." },
      { at: 4300, spot: "review-risk", text: "And what to double-check, including what it deliberately left alone." },
      { at: 7600, text: "Then the patch itself: the one broken line out, a small commented fix in, and new tests." },
      { at: 13800, spot: "ask-first", text: "Not sure the maintainers even want this? It drafts a short comment for you to post on the issue first. It never posts anything for you." },
      { at: 15000, spot: "publish-steps", text: "Before you confirm, it says exactly what publishing does: one commit on a new branch, a draft pull request that says an AI tool helped, nothing merged." },
      { at: REVIEW_CONFIRM_AT - 600, text: "And you confirm you've read it and can explain it to reviewers. Maintainers review people, not tools: if you can't explain a change, you shouldn't send it." },
      { at: REVIEW_PUBLISH_AT, text: "Only then is it scanned for leaked secrets and opened, as a draft, in your name." },
      { at: REVIEW_PUBLISHED_AT + 600, spot: "next-steps", text: "And it tells you what happens next, etiquette included: mark it ready, give it time, don't chase people, answer every review comment." },
    ]),
    pr: staged(base.pr, [{ at: 0, text: "The maintainer always knows AI helped." }], [
      { at: 0, spot: "pr-facts", text: "Every GitHub step done right: its own branch, commits under your private noreply email, the base branch past PRs were merged into, and a description that closes the issue." },
      { at: 6200, spot: "pr-body", text: "And it discloses itself: an AI assistance section says who asked, which model, and what was and wasn't tested. Commits carry an Assisted-by trailer, and a sign-off where the project asks for one." },
      { at: 9000, text: "It stays a draft until you mark it ready. The maintainer always knows." },
    ]),
  };
}

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
        <div data-spot="refusal" className="mx-auto max-w-[860px] overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="border-b border-border px-5 py-3">
            <p className="text-[13px] text-paper-muted">{BAN_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#412</span></p>
            <p className="mt-0.5 text-[17px] font-medium text-paper">Form reset doesn&apos;t clear validation errors</p>
          </div>
          <Reveal at={400} className="px-5 py-4 text-[15px]">
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
  headlines: [{ at: 0, text: "And when the rules say no, it stops." }],
  captions: [
    { at: 0, spot: "refusal", text: "And it says no. This project's contribution guide bans AI-written pull requests, so publishing is refused, quoting the guide. There's no confirm box and no Publish button; the preview is still yours to learn from. Same when someone else already has a pull request open on the issue. A project's rules are enforced, not left to the contributor to notice." },
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
  headlines: [{ at: 0, text: "Not more pull requests. Better ones." }],
  captions: [
    { at: 0, text: "Back to where we started. Here's what slop is made of, and what opensrcer does about each, all of it in the product today." },
    { at: 700 + 2 * SLOP_STEP, text: "The heart of it: you can't publish what you can't explain, and the chat is there so you can." },
    { at: 700 + 5 * SLOP_STEP, text: "It's built to make better contributors, not more pull requests. Thank you." },
  ],
  View: SlopView,
};

// ── Fix: a verified run, now that tests run on the hosted site ──────────────

// A real hosted run (rahulp7801/opensrcer-demo #3, a preview, 2026-10-24), in plain words.
// Its log, for questions: "[verify] re-running 1 test and 0 lint command(s) on the final patch",
// "status=verified regression=reproduced", "test: npm test exit=0 · 0.3s",
// "fail-before: (source change reverted) npm test exit=1 · 0.2s".
const PROOF = [
  { at: 600, text: "Started a separate test machine with no passwords or keys. It can only reach package registries and GitHub." },
  { at: 2200, text: "Installed what the project needs." },
  { at: 3800, text: "Ran the project's own tests on the fix: they pass.", verify: true },
  { at: 5800, text: "Undid the fix and ran them again: they fail. So the new test really catches the bug.", verify: true },
  { at: 8000, text: "Ready for your review. Nothing has been published." },
];
const VERIFY_AT = 3800;
const PROOF_DONE_AT = 8000;

function VerifiedView() {
  const t = useT();
  const verified = t >= PROOF_DONE_AT;
  return (
    <AppWindow path="/dispatches" section="Fix" tab="Runs">
      <div className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-border-soft bg-surface px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#3</span> · preview</p>
            <p className="mt-0.5 truncate text-[18px] font-medium text-paper">parseDuration returns NaN for compound durations like &quot;1h30m&quot;</p>
          </div>
          {verified ? <StatusChip tone="ok">verified</StatusChip> : <StatusChip tone="signal">testing</StatusChip>}
        </div>
        <ol className="space-y-3">
          {PROOF.filter((p) => !p.verify).slice(0, 2).map((p) => <ProofStep key={p.text} {...p} />)}
          <li data-spot="verify" className="space-y-3">
            {PROOF.filter((p) => p.verify).map((p) => <ProofStep key={p.text} {...p} />)}
          </li>
          <ProofStep {...PROOF[PROOF.length - 1]} />
        </ol>
      </div>
    </AppWindow>
  );
}

function ProofStep({ at, text }: { at: number; text: string }) {
  return (
    <Reveal at={at} className="flex items-start gap-3 rounded-xl border border-border-soft bg-surface px-4 py-3 text-[17px] leading-snug text-paper">
      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ok/15 text-[13px] font-semibold text-ok">✓</span>
      <span>{text}</span>
    </Reveal>
  );
}

export const stageVerified: Chapter = {
  id: "verified",
  act: "Fix",
  label: "Tests, verified",
  title: "Tests that prove the fix",
  duration: PROOF_DONE_AT + 2500,
  source: "Real hosted run on opensrcer-demo #3 (preview)",
  headlines: [{ at: 0, text: "It proves the fix works, in a locked box." }],
  captions: [
    { at: 0, text: "The centerpiece: it proves the fix works before you ever see it. This is a real run on the hosted site, on another issue." },
    { at: 600, text: "The tests run in a second machine with no passwords or keys, that can only reach package registries and GitHub. Whatever the repository's code does, it can't touch anything of yours." },
    { at: VERIFY_AT, spot: "verify", text: "It runs the project's own declared tests on the final patch: they pass. Then it undoes the fix and runs them again: they fail. So the new test really catches the bug; it isn't decorative." },
    { at: VERIFY_AT + 2600, spot: "verify", text: "For maintainers who ask: it re-ran npm test on the final patch, exit 0; with the source change reverted, exit 1. Status verified, regression reproduced. With no runnable test it says unverified instead, and CI on the pull request is still the project's own." },
  ],
  View: VerifiedView,
};

// ── The problem: what maintainers are drowning in ───────────────────────────

// An ILLUSTRATION (labeled on screen), not real pull requests.
const SLOP_PRS: Array<{ title: string; size: string; flags: string[] }> = [
  { title: "Rewrite the entire parser for performance", size: "+4,812 −3,907", flags: ["No tests", "Ignores CONTRIBUTING.md"] },
  { title: "Fix #482", size: "+36 −2", flags: ["Issue was already taken", "Skips the PR template"] },
  { title: "Update dependencies, fix typos, refactor utils", size: "+1,203 −998", flags: ["Unrelated changes", "Can't answer review questions"] },
  { title: "Add caching layer", size: "+2,640 −12", flags: ["Nobody asked for it", "Tests not run"] },
];

function ProblemView() {
  return (
    <div className="flex h-full flex-col justify-center bg-ink px-14 py-10">
      <div className="relative rounded-[22px] border border-border-soft bg-surface">
        <p className="absolute right-5 top-4 text-[12px] font-medium uppercase tracking-[0.08em] text-paper-faint">Illustration</p>
        <p className="border-b border-border-soft px-6 py-4 text-[16px] font-semibold text-paper">Pull requests <span className="ml-2 font-normal text-paper-muted">214 open</span></p>
        <ul className="divide-y divide-border-soft">
          {SLOP_PRS.map((pr, i) => (
            <Reveal as="li" key={pr.title} at={400 + i * 700} className="flex items-center justify-between gap-6 px-6 py-4">
              <div className="min-w-0">
                <p className="truncate text-[18px] font-medium text-paper">{pr.title}</p>
                <p className="mt-1.5 flex flex-wrap gap-2">
                  {pr.flags.map((f) => <span key={f} className="rounded-full bg-alert/10 px-2.5 py-0.5 text-[13px] font-medium text-alert">{f}</span>)}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[14px] text-paper-muted">{pr.size}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const stageProblem: Chapter = {
  id: "problem",
  act: "Start",
  label: "The problem",
  title: "What maintainers are drowning in",
  duration: 400 + SLOP_PRS.length * 700 + 1500,
  source: "An illustration of AI pull requests maintainers describe",
  headlines: [{ at: 0, text: "Maintainers are drowning in AI pull requests nobody understood." }],
  captions: [
    { at: 0, text: "Start with the worry in this room. AI tools made it easy to open a pull request, and maintainers are drowning in them: huge diffs, no tests, the project's rules ignored, opened by people who can't answer a single review question." },
    { at: 400 + 2 * 700, text: "These are illustrations, but every maintainer here has seen them. The problem isn't AI. It's contributions nobody understood, tested, or checked against the project's rules." },
  ],
  View: ProblemView,
};

// ── The promise ──────────────────────────────────────────────────────────────

const PILLARS: Array<[string, string]> = [
  ["Tested", "It runs the project's own tests, and proves the new test catches the bug."],
  ["Explained", "Every change in plain English, and you confirm you understand it."],
  ["Follows the rules", "It reads each project's contribution rules and respects them."],
];

function PromiseView() {
  return (
    <div className="flex h-full flex-col justify-center bg-ink px-14 py-10">
      <div className="grid grid-cols-3 gap-6">
        {PILLARS.map(([title, text], i) => (
          <Reveal key={title} at={300 + i * 600} className="rounded-[24px] bg-signal p-7 text-white shadow-[0_30px_80px_-30px_rgb(0_86_173/0.6)]">
            <p className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">{title}</p>
            <p className="mt-3 text-[18px] leading-snug text-white/85">{text}</p>
          </Reveal>
        ))}
      </div>
      <Reveal at={300 + PILLARS.length * 600 + 300}>
        <p className="mt-8 text-center text-[19px] text-paper-muted">Every run stops for your review. Nothing posts until you confirm.</p>
      </Reveal>
    </div>
  );
}

export const stagePromise: Chapter = {
  id: "promise",
  act: "Start",
  label: "The promise",
  title: "Contributions a maintainer would want",
  duration: 300 + PILLARS.length * 600 + 2000,
  source: "What opensrcer is for",
  headlines: [{ at: 0, text: "A contribution a maintainer would actually want." }],
  captions: [
    { at: 0, text: "opensrcer helps a beginner make the contribution a maintainer would actually want: tested, explained, and following the project's rules." },
    { at: 300 + PILLARS.length * 600, text: "Everything from here is the real product; the run and the pull request are real. Every run stops for your review, and nothing posts until you confirm." },
  ],
  View: PromiseView,
};

// ── It reads the rules first ─────────────────────────────────────────────────

// Run #2 on opensrcer-demo (the one that became PR #6), in plain words. Its log, for
// questions: "[tool] list_files CONTRIBUTING*", "[tool] list_files .github/**", then
// "## Conventions: No contribution guide found…; matched what the repo already does".
const RULES_FEED: Array<{ at: number; text: string; rules?: true; points?: string[] }> = [
  { at: 600, text: "Started a throwaway machine with a spend cap and a time limit." },
  { at: 2200, text: "Looked for the project's contribution guide and pull request template.", rules: true },
  { at: 3800, text: "None here, so it follows what the code already does:", rules: true, points: ["commit messages written as “area: summary”", "an example in the docs for every helper", "the project's own test suite"] },
  { at: 6600, text: "Read the code around the bug, and everything that calls it." },
  { at: 8600, text: "Found the cause: truncate cuts at a fixed point and then adds “…”, so the result is one character too long and can split a word." },
];
const RULES_DONE_AT = 8600;

function RulesView() {
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="flex h-full flex-col gap-4 p-5">
        <div className="rounded-2xl border border-border-soft bg-surface px-5 py-4">
          <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#2</span></p>
          <p className="mt-0.5 truncate text-[18px] font-medium text-paper">truncate cuts mid-word and returns more than max characters</p>
        </div>
        <ol className="space-y-3">
          <RulesStep {...RULES_FEED[0]} />
          <li data-spot="rules" className="space-y-3">
            {RULES_FEED.filter((s) => s.rules).map((s) => <RulesStep key={s.text} {...s} />)}
          </li>
          {RULES_FEED.slice(3).map((s) => <RulesStep key={s.text} {...s} />)}
        </ol>
      </div>
    </AppWindow>
  );
}

function RulesStep({ at, text, points }: { at: number; text: string; points?: string[] }) {
  return (
    <Reveal at={at} className="flex items-start gap-3 rounded-xl border border-border-soft bg-surface px-4 py-3 text-[17px] leading-snug text-paper">
      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ok/15 text-[13px] font-semibold text-ok">✓</span>
      <span>
        {text}
        {points && <span className="mt-1.5 block text-[15px] text-paper-dim">{points.map((p) => <span key={p} className="block">· {p}</span>)}</span>}
      </span>
    </Reveal>
  );
}

export const stageRules: Chapter = {
  id: "rules",
  act: "Fix",
  label: "Rules first",
  title: "It reads the project's rules first",
  duration: RULES_DONE_AT + 2500,
  source: "The real run behind pull request #6, in plain words",
  headlines: [{ at: 0, text: "It reads the project's rules first." }],
  captions: [
    { at: 0, text: "One click on the issue started a run, in a throwaway machine with a hard spend cap and a time limit. The first thing it does is read the project's rules." },
    { at: 2200, spot: "rules", text: "It looks for the contribution guide and the pull request template. This repo has none, so it matches what the code already does: commit style, docs, the project's own tests. A maintainer gets a patch that looks like their project." },
    { at: 6600, text: "Then it reads the code around the bug and everything that calls it, and writes down the cause before the fix. Where it can't find the root cause, it stops and says so rather than guess." },
  ],
  View: RulesView,
};

// ── Starting the run: Sign in with Claude ───────────────────────────────────

// components/trigger-form.tsx and components/dispatch-list.tsx, verbatim. The click on
// the start button is made by the stage itself (stage.tsx SKIP), so no new stop.
const SIGN_IN_PRESS_AT = 900;
const SIGN_IN_PANEL_AT = 1800;
const SIGN_IN_SENT_AT = 3600;
const SIGN_IN_LENGTH = 6000;

function SignInView() {
  const t = useT();
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border-soft bg-surface px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#2</span></p>
            <p className="mt-0.5 truncate text-[18px] font-medium text-paper">truncate cuts mid-word and returns more than max characters</p>
          </div>
          <Press at={SIGN_IN_PRESS_AT} className="shrink-0 rounded-full border border-signal/50 bg-signal/10 px-4 py-1.5 text-[14px] font-medium text-signal">Sign in with Claude &amp; start</Press>
        </div>
        {t >= SIGN_IN_PRESS_AT && t < SIGN_IN_PANEL_AT && <p className="text-[15px] text-paper-muted">Starting your run… Claude&apos;s sign-in page opens here in a moment.</p>}
        <Reveal at={SIGN_IN_PANEL_AT} spot="sign-in" className="rounded-2xl border border-signal/40 bg-signal/[0.05] p-5">
          <p className="text-[18px] font-medium text-signal">Sign in to Claude to start this run</p>
          <p className="mt-1.5 text-[16px] leading-snug text-paper-dim">This run uses your own Claude subscription. Sign in on Claude&apos;s page, then paste the code it shows you here.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
            <span className="rounded-full border border-signal/40 px-3.5 py-1.5 text-signal">Open Claude sign-in ↗</span>
            <span className="min-w-[220px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-paper-faint">{t >= SIGN_IN_SENT_AT ? "••••••••" : "Paste code"}</span>
            <span className="rounded-full bg-signal px-3.5 py-1.5 font-medium text-white">Send code</span>
          </div>
          {t >= SIGN_IN_SENT_AT && <p className="mt-3 text-[15px] text-ok">Code sent. The run starts once Claude confirms the sign-in.</p>}
        </Reveal>
      </div>
    </AppWindow>
  );
}

/** The rules stop, opened by the run's start: Sign in with Claude, then the run itself. */
export function withSignInStart(chapter: Chapter): Chapter {
  const Inner = chapter.View;
  function View() {
    const t = useT();
    return t < SIGN_IN_LENGTH ? <SignInView /> : <TimeContext.Provider value={t - SIGN_IN_LENGTH}><Inner /></TimeContext.Provider>;
  }
  const later = (c: Caption): Caption => ({ ...c, at: c.at + SIGN_IN_LENGTH });
  return {
    ...chapter,
    duration: chapter.duration + SIGN_IN_LENGTH,
    headlines: [{ at: 0, text: "No API bill: it runs on the Claude plan you already pay for." }, ...(chapter.headlines ?? []).map(later)],
    captions: [
      { at: 0, text: "One click starts the run. It runs on the Claude plan you already pay for, so there's no API bill." },
      { at: SIGN_IN_PANEL_AT, spot: "sign-in", text: "You sign in on Claude's own page, inside the run's isolated machine. opensrcer never sees or keeps your Claude login; the session goes away with the machine. Hit your plan's limit? The run stops and says so. It switches to your API key only if you've turned that on, and that's off by default." },
      ...chapter.captions.map(later),
    ],
    View,
  };
}
