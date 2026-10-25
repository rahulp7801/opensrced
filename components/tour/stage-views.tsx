"use client";

// The stage demo's own screens and speaker notes. Everything shown here is what
// the app does today:
//   - the issue scanner's verdicts, with the reasons it gives verbatim
//     (lib/issues.ts, drawn as components/issue-scanner.tsx draws them);
//   - Explore's plain-English questions, which are answered from the repository's
//     code graph, point to the files involved and show their cost (app/api/graph/query);
//   - the real pallets/flask graph and a real Explore answer, drawn on it for the stage
//     (repo-map.tsx; demo only: the hops are the graph's own relations).
// The notes carry the pitch: the guided path for someone new to open source, and
// why maintainers can trust what it sends them.

import { ArrowUp, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, Pips, Press, Reveal, SCOPE_LABEL, SCOPE_TONE, SEVERITY_TONE, TimeContext, Typed, progress, useFollow, useT, type Caption, type Chapter } from "./kit";
import { MAP_FOCUS_LENGTH, RepoMap } from "./repo-map";
import { DEMO_PUBLISH_STEPS, Published, Term } from "./chapters-fix";
import type { ReactNode } from "react";
import { DIAGNOSIS, PATCH_STATS, RISK } from "./data";
import { projectRules, RULE_STATUS_LABEL, type RuleStatus } from "@/lib/project-rules";
import { PRACTICE_INTRO } from "@/components/own-words";
import { Inline } from "./kit";
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
  provenance: [{ at: 0, text: "Example scan · the scanner's own verdicts" }],
  headlines: [{ at: 0, text: "It only picks issues that are open to you." }],
  captions: [
    { at: 0, text: "Step one: an issue that's actually open to a newcomer. Claude Code assumes you already have one." },
    { at: SHOW_ALL_AT, text: "Show everything it found, including what it filtered out, and why." },
    { at: SHOW_ALL_AT + 600, spot: "scan-list", text: "Assigned? Skip. A pull request already open? Skip, help them instead. Already fixed but still open? Skip. That alone saves maintainers duplicate PRs." },
    { at: SHOW_ALL_AT + 4200, spot: "scan-list", text: "Questions, wontfix and vague issues are flagged too, with the reason." },
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
              <div data-spot="answer" className="mr-4 rounded-2xl rounded-tl-md border border-border-soft bg-surface px-3 py-2.5 text-[14px] leading-[1.5] text-paper">
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

// Explore on a large real repository: pallets/flask, mapped by the site's own graph builder.
const MAP_REPO = "pallets/flask";
const MAP_PANEL: PanelText = { ...GRAPH_PANEL, placeholder: `Ask about ${MAP_REPO}…` };
const BUILT_AT = 3600;
const FIRST = schedule(BUILT_AT + 1600, [
  {
    // Asked on the real Explore page against the real graph (public/demo/flask-graph.json has the
    // full answer). Shown as a verbatim excerpt, trimmed with "…"; the cites and cost are the run's.
    prompt: "Where is render_template used, and what breaks if I change it?",
    answer: "render_template is defined in src/flask/templating.py:L136 (rationale at L140). … Breaking Changes Would Affect: All view functions that use render_template() to return HTML responses",
    cites: ["src/flask/templating.py", "tests/test_basic.py", "tests/test_signals.py", "examples/tutorial/flaskr/auth.py", "src/flask/sansio/app.py", "src/flask/app.py"], cost: "$0.0206",
  },
]);
// Then the stage draws that answer on the map.
const FOCUS_AT = FIRST.end;
const TURNS = FIRST.turns;

function StageExploreView() {
  const t = useT();
  const built = t >= BUILT_AT;
  const pct = Math.round(progress(t, 700, BUILT_AT - 100) * 100);
  return (
    <AppWindow path={`/graph?repo=${MAP_REPO}`} section="Explore">
      <div className="flex h-full flex-col overflow-hidden px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[12px] text-paper">{MAP_REPO}</span>
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
            <div data-spot="graph" className="relative min-h-0 overflow-hidden rounded-xl border border-border-soft">
              <RepoMap buildAt={BUILT_AT + 100} focusAt={FOCUS_AT} />
            </div>
            <AskPanel turns={TURNS} text={MAP_PANEL} />
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
  duration: FOCUS_AT + MAP_FOCUS_LENGTH + 2500,
  source: "The real pallets/flask graph and a real Explore answer; the zoom is drawn for the stage",
  provenance: [{ at: 0, text: "Real repository: pallets/flask · real answer" }],
  headlines: [
    { at: 0, text: "Understand the code before you change it." },
    { at: FIRST.turns[0].typeAt, text: "Ask about it in plain English." },
    { at: FOCUS_AT, text: "Know what your change touches before you touch it." },
  ],
  captions: [
    { at: 0, text: "Before changing anything, understand the code. Explore maps the repository straight from its source code: no AI, and nothing to install on your machine." },
    { at: BUILT_AT, spot: "graph", text: "This is Flask: 2,169 nodes (files, functions, classes and their docstring notes) in 201 communities, and the links between them, mapped by the site's own graph builder. (The layout was computed for this talk from that real graph.)" },
    { at: FIRST.turns[0].typeAt, spot: "ask", text: `Then ask the question you'd normally grep for: “${FIRST.turns[0].prompt}” The answer comes from the map and points to the files involved.` },
    { at: FIRST.turns[0].doneAt, spot: "answer", text: "A real answer from the Explore page, trimmed for the slide: where it lives, and what breaks if you change it." },
    { at: FOCUS_AT, spot: "graph", text: "Drawn on the map for the talk: from all of Flask down to render_template(), then everything that depends on it in the graph, one, two and three hops out. Know what your change touches before you touch it." },
  ],
  View: StageExploreView,
};

// ── Speaker notes and headlines for the tour's review and pull request ──────

/** A chapter with its provenance label for the stage. */
function withProvenance(chapter: Chapter, provenance: Caption[]): Chapter {
  return { ...chapter, provenance };
}

/** A chapter with the stage's own notes in place of the tour's narration, and its headlines. */
function staged(chapter: Chapter, headlines: Caption[], captions: Caption[]): Chapter {
  return { ...chapter, headlines, captions };
}

/** The review and the pull request as the stage tells them. */
export function stageNotes(base: { pr: Chapter }) {
  return {
    pr: withProvenance(staged(base.pr, [{ at: 0, text: "The maintainer always knows AI helped." }], [
      { at: 0, spot: "pr-facts", text: "Every GitHub step done right: its own branch, your private noreply email, the right base branch, and a description that closes the issue." },
      { at: 5800, spot: "pr-verified", text: "The description shows the tests it ran and the result: verified." },
      { at: 7400, spot: "pr-ai", text: "And it discloses itself: who asked, which model, what was and wasn't tested, plus an Assisted-by trailer and a sign-off where the project asks." },
      { at: 9000, text: "It stays a draft until you mark it ready. The maintainer always knows." },
    ]), [{ at: 0, text: "Real pull request #7 · Oct 24" }]),
  };
}

// ── Ship: what it did on GitHub, as the real pull request shows it ──────────

// PR #7 on rahulp7801/opensrcer-demo, as GitHub reports it (gh pr view 7). No fork:
// the demo repository is the user's own; on someone else's, it forks first.
const PR_FACTS: Array<[string, string]> = [
  ["Branch", RUN.branch],
  ["Into", "main"],
  ["Commit author", "76501505+rahulp7801@users.noreply.github.com"],
  ["Status", "Draft, opened by rahulp7801"],
  ["Commit", "1, with “Assisted-by: claude-sonnet-5 via opensrcer”"],
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

// The guard's own words (lib/contrib-guard.ts maintainerObjectionReason), with the name and
// the quote replaced. A REAL issue in a major open-source project; who and where stay hidden.
const NAME_HIDDEN = "name hidden";
const QUOTE_HIDDEN = "quote hidden";
const MAINT_AT = 5500;

/** A visibly redacted span: what was there is hidden on purpose. */
function Redacted({ children }: { children: string }) {
  return <span className="rounded bg-paper/80 px-1.5 text-[0.9em] font-medium text-surface">[{children}]</span>;
}

function MaintainerView() {
  return (
    <AppWindow path="/dispatches" section="Fix" tab="Runs">
      <div className="flex h-full justify-center px-6 pb-6 pt-[9%]">
        <div className="w-full max-w-[860px] space-y-4">
        <Reveal at={MAINT_AT + 300}>
          <p className="text-[18px] leading-snug text-paper">On a real issue in a major open-source project, a maintainer replied asking for a human-written pull request. opensrcer read the thread and refused to publish.</p>
        </Reveal>
        <Reveal at={MAINT_AT + 1800} spot="maint" className="rounded-2xl border border-border-soft bg-surface px-5 py-4 text-[15px] shadow-[0_18px_40px_-24px_rgb(0_0_0/0.35)]">
          <p className="text-[16px] font-medium text-paper">Review before publishing</p>
          <p role="alert" className="mt-2 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2.5 leading-relaxed text-alert">
            Blocked: a maintainer asked for human-written work on this issue (@<Redacted>{NAME_HIDDEN}</Redacted>: &quot;<Redacted>{QUOTE_HIDDEN}</Redacted>&quot;). opensrcer won&apos;t open an AI-assisted pull request here; you can still use this preview to write the fix yourself
          </p>
        </Reveal>
        </div>
      </div>
    </AppWindow>
  );
}

function RefusedView() {
  if (useT() >= MAINT_AT) return <MaintainerView />;
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
  duration: MAINT_AT + 7500,
  source: "Example: a fictional project whose guide bans AI; then a real issue, names hidden",
  headlines: [{ at: 0, text: "And when the rules say no, it stops." }, { at: MAINT_AT, text: "It listens to maintainers, even in the comments." }],
  provenance: [{ at: 0, text: "Example project" }, { at: MAINT_AT, text: "Real issue · names hidden" }],
  captions: [
    { at: 0, spot: "refusal", text: "And it says no. This guide bans AI-written pull requests, so publishing is refused, quoting the guide, with no Publish button. Same when someone else already has a pull request open." },
    { at: MAINT_AT, spot: "maint", text: "And it listens to maintainers in the issue itself. On a real project, a maintainer asked for a human-written pull request, so opensrcer refused to publish. Name and quote hidden; the preview still helps you write the fix yourself." },
  ],
  View: RefusedView,
};

// ── Close: why this isn't AI slop ───────────────────────────────────────────

// Each row is something opensrcer does today (on the hosted site unless it says otherwise).
const SLOP: Array<[string, string]> = [
  ["Nobody asked for it", "Steers you to issues that are open to you: it flags assigned, already-fixed and vague issues, and refuses where the guide bans AI or a maintainer on the issue asks for human-written work."],
  ["Someone's already on it", "It won't publish while another pull request targets the issue."],
  ["The sender can't explain it", "Nothing publishes until you explain the change in your own words, checked against the diff, and answer a practice review. The chat helps you get there."],
  ["Hidden AI", "Every pull request says who asked, which model, and what was and wasn't tested."],
  ["Untested", "It runs the project's tests in a machine with no credentials and re-runs them on the final patch; when the fix adds a test, it checks that test fails without the fix. No test it can run? It says unverified."],
  ["Sent in bulk", "Always a draft, with you as the author. One open pull request per project per person, and at most three a day."],
];
const SLOP_STEP = 500;
const SLOP_LINE_AT = 700 + 6 * SLOP_STEP + 400; // after the last row

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
  duration: SLOP_LINE_AT + 7500,
  source: "What opensrcer does today",
  headlines: [{ at: SLOP_LINE_AT, text: "Not more pull requests. Better ones." }],
  captions: [
    { at: 0, text: "Back to where we started: what slop is made of, and what opensrcer does about each." },
    { at: 700 + 2 * SLOP_STEP, text: "The heart of it: you can't publish what you can't explain, and the chat is there so you can." },
    { at: 700 + 5 * SLOP_STEP, text: "It's built to make better contributors, not more pull requests. Thank you." },
  ],
  View: SlopView,
};

// ── Fix: a verified run, now that tests run on the hosted site ──────────────

// The same real run (opensrcer-demo #2 -> PR #7, 2026-10-24), in plain words. Its log, for
// questions: "[verify] re-running 1 test and 0 lint command(s) on the final patch",
// "status=verified regression=reproduced", node --test exit=0 (6 pass), and with the source
// change reverted exit=1 (2 fail: "The quick br…" instead of "The quick…").
const PROOF = [
  { at: 600, text: "Started a separate test machine with no passwords or keys. It can only reach package registries and GitHub." },
  { at: 2200, text: "Installed what the project needs." },
  { at: 3800, text: "Ran the project's own tests on the fix: they pass.", verify: true },
  { at: 5800, text: "Undid the fix and ran them again: the new tests fail. So they really catch the bug.", verify: true },
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
            <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[11px] text-info">#2</span></p>
            <p className="mt-0.5 truncate text-[18px] font-medium text-paper">truncate cuts mid-word and returns more than max characters</p>
          </div>
          {verified ? <span className="stage-settle"><StatusChip tone="ok">verified</StatusChip></span> : <StatusChip tone="signal">testing</StatusChip>}
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
  source: "The real run behind pull request #7",
  provenance: [{ at: 0, text: "Real run · Oct 24 · verified" }],
  headlines: [{ at: 0, text: "It proves the fix works, in a locked box." }],
  captions: [
    { at: 0, text: "The centerpiece: it proves the fix works before you ever see it. Same issue, same real run, on the hosted site." },
    { at: 600, text: "In a second machine with no passwords or keys, that only reaches package registries and GitHub." },
    { at: VERIFY_AT, spot: "verify", text: "It runs the project's own tests on the final patch: all six pass. Then it undoes the fix: the two new tests fail. So they really catch the bug." },
    { at: VERIFY_AT + 2600, spot: "verify", text: "For maintainers who ask: node --test on the final patch, exit 0, 6 of 6; with the fix reverted, exit 1, the two new tests failing. With no runnable test it says unverified, and CI on the pull request is still the project's own." },
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
    { at: 0, text: "Start with the worry in this room: maintainers are drowning in AI pull requests. Huge diffs, no tests, rules ignored, from people who can't answer one review question." },
    { at: 400 + 2 * 700, text: "Illustrations, but every maintainer here has seen them. The problem isn't AI; it's contributions nobody understood." },
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
    { at: 300 + PILLARS.length * 600, text: "Everything from here is the real product, and a real run. Nothing posts until you confirm." },
  ],
  View: PromiseView,
};

// ── It reads the rules first ─────────────────────────────────────────────────

// The real run on opensrcer-demo #2 that became PR #7, in plain words. Its log, for
// questions: "[profile] dco=false cla=none template=no agent-rules=no ai-policy=unknown",
// then "## Conventions: No contribution guide (CONTRIBUTING, PR template) found… tests live
// in test/text.test.ts… No lint/format config files are present."
const RULES_FEED: Array<{ at: number; text: string; rules?: true; points?: string[] }> = [
  { at: 600, text: "Started a throwaway machine with a spend cap and a time limit." },
  { at: 2200, text: "Looked for the project's contribution guide and pull request template.", rules: true },
  { at: 3800, text: "None here, so it follows what the code already does:", rules: true, points: ["new tests go in the project's existing test file", "the project's own test runner", "no lint or format rules to follow"] },
  { at: 6600, text: "Read the code around the bug and its tests, and checked nothing else calls it." },
  { at: 8600, text: "Found the cause: truncate cuts at a fixed point and then adds “…”, so the result can be longer than allowed and can split a word." },
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
  source: "The real run behind pull request #7, in plain words",
  provenance: [{ at: 0, text: "Real run · Oct 24" }],
  headlines: [{ at: 0, text: "It reads the project's rules first." }],
  captions: [
    { at: 0, text: "One click starts the run, in a throwaway machine with a spend cap and a time limit." },
    { at: 2200, spot: "rules", text: "It reads the project's rules first: contribution guide, PR template, AI policy, sign-off. This repo has none, so it follows what the code already does." },
    { at: 6600, text: "Then it reads the code around the bug and writes down the cause before the fix. If it can't find the root cause, it says so rather than guess." },
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
    provenance: [{ at: 0, text: "The sign-in step, as the site shows it" }, ...(chapter.provenance ?? []).map(later)],
    captions: [
      { at: 0, text: "Back to our small demo repository, where the real run behind pull request #7 happened. One click starts the run. It runs on the Claude plan you already pay for, so there's no API bill." },
      { at: SIGN_IN_PANEL_AT, spot: "sign-in", text: "You sign in on Claude's own page, inside the run's machine; opensrcer never sees your login. Hit your plan's limit? The run stops. It switches to an API key only if you've turned that on." },
      ...chapter.captions.map(later),
    ],
    View,
  };
}

// ── Review: the change explained, the rules, the chat, your own words ───────

// "This project's rules" for the PR #7 run, computed by lib/project-rules.ts itself.
// The run predates the checklist, so its preview lacks `rules`; these are the fields a
// run records today for this repository: no PR template, no discuss-first signal, no
// other open PR (true at publish), the AI note added. Profile and tests are the run's own.
const DEMO_RULES = projectRules({
  profile: { dco: false, cla: null, aiPolicy: { stance: "unknown", source: null, excerpt: null }, aiTrailer: null, sources: [] },
  signoff: false,
  executed: true,
  verification: { status: "verified", reason: "declared tests pass, and fail with the source change reverted", plan: { setup: ["node --version"], test: ["node --experimental-strip-types --test \"test/**/*.test.ts\""], lint: [] }, regression: "reproduced", evidence: [] },
  blockers: [],
  warnings: [],
  body: "",
  rules: { pr_template: false, template_headings: null, agent_instructions: false, notes: 0, discuss_first: null, competing_prs: "none", disclosed: true },
});
const RULE_TONE: Record<RuleStatus, string> = { done: "border-ok/40 text-ok", action: "border-signal/40 text-signal", blocked: "border-alert/40 text-alert", check: "border-info/40 text-info", unknown: "border-border text-paper-muted", none: "border-border text-paper-muted" };

// EXAMPLE answers: what the review screen's AI calls return, written here for this
// change and checked against PR #7's diff. Labeled as examples in the notes.
const CHAT_QUESTION = "Explain this fix like I'm new to the project";
const CHAT_ANSWER = "truncate shortens text to fit a maximum length and adds “…” at the end. Before, it cut at exactly max characters and then added the “…”, so the result came out too long, and it could stop in the middle of a word. Now it saves room for the “…” first, and if the cut lands inside a word, it backs up to the last space. Two new tests: the example from the issue, and a cut that already lands on a space.";
const OWN_WORDS_TEXT = "truncate added the … after cutting at max, so the result was too long and could split a word. Now it leaves room for the … and backs up to the last space. The two new tests pass, and they fail without the fix.";
const PRACTICE = [
  { q: "What happens when there's no space before the cut, like one very long word?", a: "Then there's nothing to back up to, so it keeps the cut and adds the …: it splits that word but stays within max.", feedback: "That answers it and matches the diff.", followUp: "Should that case get its own test?" },
  { q: "Why check for a space at the cut instead of any whitespace?", a: "It only looks for a plain space, so a tab or newline counts as part of a word. That's worth saying in the PR.", feedback: "That answers it and matches the diff.", followUp: "Should the description say spaces rather than whitespace?" },
];

// When each section is on screen (one at a time, as a presenter walks the real page).
const R = {
  rules: 6500, chat: 13500, own: 22500, practice: 34500, publish: 45500,
  chatPress: 14800, answerAt: 16000, ownTypeAt: 23500, check: 30500, results: 31200,
  confirm: 48500, publishAt: 50000,
};
const PUBLISHED_AT = R.publishAt + 500;
const PRACTICE_TIMES = [{ q: 35000, type: 35800, send: 38600, fb: 39200 }, { q: 40300, type: 40800, send: 44200, fb: 44700 }];

function Section({ title, children, spot }: { title: string; children: ReactNode; spot?: string }) {
  return (
    <div data-spot={spot} className="animate-fade-rise rounded-xl border border-border-soft bg-ink px-4 py-2.5 text-[13px] motion-reduce:animate-none">
      <p className="text-[15px] font-medium text-paper">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function StageReviewView() {
  const t = useT();
  const section = t < R.rules ? "found" : t < R.chat ? "rules" : t < R.own ? "chat" : t < R.practice ? "own" : t < R.publish ? "practice" : "publish";
  const typed = OWN_WORDS_TEXT.slice(0, Math.max(0, Math.min(OWN_WORDS_TEXT.length, Math.floor(((t - R.ownTypeAt) / 1000) * 40))));
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="absolute inset-0 bg-ink/80 p-3 backdrop-blur-sm">
        <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="border-b border-border px-4 py-2.5">
            <p className="truncate text-[15px] font-medium text-paper">{RUN.prTitle}</p>
            <p className="text-[12px] text-paper-muted">{PATCH_STATS.files} files changed · <span className="text-ok">+{PATCH_STATS.additions}</span> · <span className="text-alert">-{PATCH_STATS.deletions}</span> · <span className="text-ok">verified</span></p>
          </div>
          {t >= PUBLISHED_AT ? <Published /> : (
            <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
              {section === "found" && (
                <div className="space-y-3">
                  <Reveal at={300} spot="review-found">
                    <p className="mono-label">What was found</p>
                    <p className="mt-1 text-[14px] leading-6 text-paper-dim"><Inline text={DIAGNOSIS} /></p>
                  </Reveal>
                  <Reveal at={2800} spot="review-risk">
                    <p className="mono-label">Risk &amp; testing</p>
                    <ul className="mt-1 space-y-1 text-[13.5px] leading-6 text-paper-dim">{RISK.map((r) => <li key={r}>· <Inline text={r} /></li>)}</ul>
                  </Reveal>
                </div>
              )}
              {section === "rules" && (
                <Section title="This project's rules" spot="rules-list">
                  <p className="text-paper-muted">Why this matters: maintainers set these rules, and following them is what makes a contribution welcome.</p>
                  <ul className="mt-1 space-y-0.5">
                    {DEMO_RULES.map((row, i) => (
                      <Reveal as="li" key={row.id} at={R.rules + 300 + i * 80} className="rounded-lg border border-border-soft bg-surface px-3 py-0.5 text-[12.5px] leading-snug">
                        <p className="flex flex-wrap items-baseline gap-2"><span className={cn("rounded-full border px-2 text-[11.5px]", RULE_TONE[row.status])}>{RULE_STATUS_LABEL[row.status]}</span><span className="font-medium text-paper">{row.label}:</span><span className="text-paper-dim">{row.text}</span></p>
                        {row.detail && <p className="text-[11.5px] leading-snug text-paper-muted">{row.detail}</p>}
                      </Reveal>
                    ))}
                  </ul>
                </Section>
              )}
              {section === "chat" && (
                <Section title="Ask about this change">
                  <p className="text-paper-muted">Not sure what the change does or why? Ask about it here.</p>
                  <p className="mt-1 text-[12px] text-paper-muted">Answers are based on this change and the project&apos;s rules; check them against the code. Each answer comes from one AI call that reads only what is shown here; it does not run the code.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
                    <Press at={R.chatPress} label={CHAT_QUESTION} className="rounded-full border border-info/50 px-3 py-1 text-info">{CHAT_QUESTION}</Press>
                    {["What could this break?", "Which of the project's rules apply, and did it follow them?", "How do I explain this to a reviewer?"].map((q) => <span key={q} className="rounded-full border border-border px-3 py-1 text-paper-dim">{q}</span>)}
                  </div>
                  {t >= R.chatPress + 400 && <p className="mt-2.5 text-paper"><span className="font-medium text-signal">You:</span> {CHAT_QUESTION}</p>}
                  {t >= R.answerAt && (
                    <div data-spot="chat-answer" className="mt-1.5 rounded-lg border border-border-soft bg-surface px-3 py-2">
                      <p className="text-[12px] text-info">AI answer (not verified)</p>
                      <p className="mt-1 text-[14px] leading-6 text-paper"><Typed text={CHAT_ANSWER} at={R.answerAt} cps={80} /></p>
                    </div>
                  )}
                </Section>
              )}
              {section === "own" && (
                <Section title="Explain it in your own words" spot="own-words">
                  <p className="text-paper-muted">Maintainers want to know the person sending a change understands it. In a few sentences, answer:</p>
                  <ul className="mt-1 list-disc pl-5 text-paper-dim"><li>What was wrong?</li><li>What did the change do?</li><li>How do you know it works?</li></ul>
                  <p className="mt-2 text-paper">Your explanation</p>
                  <p className="mt-1 min-h-[64px] rounded-lg border border-border bg-surface px-3 py-2 text-[14px] leading-6 text-paper">{typed}&nbsp;</p>
                  <p className="mt-1 text-[12px] text-paper-muted">At least 80 characters ({typed.length}/2000). It goes into the pull request under &quot;In the author&apos;s words&quot;.</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Press at={R.check} label="Check my explanation" className="rounded-full border border-signal/50 bg-signal/10 px-3 py-1 font-medium text-signal">Check my explanation</Press>
                    <span key={t >= R.check ? "4" : "5"} className="stage-tick text-paper-muted">{t >= R.check ? "4 checks left" : "5 checks left"}</span>
                  </div>
                  {t >= R.results && (
                    <div className="mt-2 space-y-0.5">
                      <Reveal at={R.results}><p className="text-ok">What was wrong: covered</p></Reveal>
                      <Reveal at={R.results + 300}><p className="text-ok">What the change did: covered</p></Reveal>
                      <Reveal at={R.results + 600}><p className="text-ok">How you know it works: covered</p></Reveal>
                      <Reveal at={R.results + 900}><p className="text-paper-dim">Tip: Clear and complete; saying what the new tests check helps reviewers.</p></Reveal>
                      <Reveal at={R.results + 1200}><p className="font-medium text-ok">Your explanation covers the change.</p></Reveal>
                    </div>
                  )}
                </Section>
              )}
              {section === "practice" && (
                <Section title="Practice review" spot="practice">
                  <p className="text-paper-muted">{PRACTICE_INTRO}</p>
                  <div className="mt-2 space-y-3">
                    {PRACTICE.map((p, i) => {
                      const at = PRACTICE_TIMES[i];
                      return (
                        <Reveal key={p.q} at={at.q}>
                          <p className="text-paper"><span className="font-medium">Reviewer:</span> {p.q}</p>
                          <p className="mt-1 min-h-[30px] rounded-lg border border-border bg-surface px-3 py-1.5 text-[13.5px] text-paper"><Typed text={p.a} at={at.type} cps={45} />&nbsp;</p>
                          <div className="mt-1 flex items-center gap-3 text-[12.5px]">
                            <Press at={at.send} label="Send answer" className="rounded-full border border-info/50 px-3 py-0.5 text-info">{t >= at.send ? "Send again" : "Send answer"}</Press>
                            <span className="text-paper-muted">At least 20 characters.</span>
                          </div>
                          {t >= at.fb && <p className="mt-1 text-paper-dim"><span className="font-medium text-paper">Feedback:</span> {p.feedback}</p>}
                          {t >= at.fb && <p className="mt-0.5 text-paper-muted">A reviewer might follow up: {p.followUp}</p>}
                        </Reveal>
                      );
                    })}
                  </div>
                </Section>
              )}
              {section === "publish" && (
                <Section title="What happens when you publish" spot="publish-steps">
                  <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-6 text-paper-dim">{DEMO_PUBLISH_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
                  <p data-spot="glossary" className="mt-2 flex flex-wrap gap-x-3 text-paper-muted">Words used here: <Term>fork</Term><Term>branch</Term><Term>draft PR</Term><Term>AI disclosure</Term></p>
                </Section>
              )}
            </div>
          )}
          <div className="border-t border-border px-4 py-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Press at={R.confirm} label="I've read this change" className="flex items-center gap-1.5 text-paper">
                <span aria-hidden className={cn("grid h-4 w-4 place-items-center rounded-[3px] border text-[10px]", t >= R.confirm ? "border-ok bg-ok/15 text-ok" : "border-border")}>{t >= R.confirm ? "✓" : ""}</span>
                I&apos;ve read this change and can explain it to reviewers.
              </Press>
              <Press at={R.publishAt} label="Publish draft PR" className={cn("ml-auto rounded-full border px-3 py-0.5 font-medium", t >= R.confirm ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-paper-faint")}>
                {t >= R.publishAt ? `Draft PR #${RUN.pr} opened ↗` : "Publish draft PR"}
              </Press>
            </div>
            {t < R.confirm && <p className="mt-1 text-[12px] text-paper-muted">To publish: explain the change in your own words, answer the practice review, and tick the box.</p>}
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export const stageReview: Chapter = {
  id: "review",
  act: "Fix",
  label: "Review",
  title: "Review, explain, publish",
  duration: PUBLISHED_AT + 8500,
  source: "The review screen for the PR #7 run; the chat and check answers are examples; the rules as a run records them today",
  provenance: [{ at: 0, text: "Real run · Oct 24" }, { at: R.chat, text: "Real run · Oct 24 · example answers" }],
  headlines: [
    { at: 0, text: "It explains every change in plain English." },
    { at: R.rules, text: "It checks the project's rules, one by one." },
    { at: R.chat, text: "It teaches you the change…" },
    { at: R.own, text: "…and checks that you learned it. In your words." },
    { at: R.practice, text: "Then a practice review, before the real one." },
    { at: R.publish, text: "You confirm you understand it." },
    { at: R.publishAt, text: "A human publishes. Nothing is hidden." },
  ],
  captions: [
    { at: 0, spot: "review-found", text: "It explains every change: what was wrong and what changed, in plain words." },
    { at: 2800, spot: "review-risk", text: "And what to double-check." },
    { at: R.rules, spot: "rules-list", text: "Then this project's rules, one by one, and how each was handled. (For maintainers: this run predates the checklist, so it's shown as a run records it today.)" },
    { at: R.chat, spot: "chat-answer", text: "Not sure what it does? Ask, in plain English. Answers are labeled not verified, so you check them against the code. (Example answer.)" },
    { at: R.own, spot: "own-words", text: "Before you can publish, you explain it in your own words. The AI checks it against the actual change; pasting the AI's own text is rejected." },
    { at: R.results, spot: "own-words", text: "It goes into the pull request under “In the author's words”, so the maintainer reads the human's explanation, not the AI's." },
    { at: R.practice, spot: "practice", text: "Then two practice questions, the kind a maintainer would ask about this exact change. (Example questions and answers.)" },
    { at: R.publish, spot: "publish-steps", text: "Then exactly what publishing does, and your confirmation. Publish stays locked until all of that is done." },
    { at: R.publishAt, text: "Only then is it scanned for leaked secrets and opened, as a draft, in your name." },
    { at: R.publish + 2500, spot: "glossary", text: "Terms a beginner trips on are explained on tap: fork, branch, draft PR." },
    { at: PUBLISHED_AT + 600, spot: "next-steps", text: "And it coaches what happens next: don't chase people, answer every review comment." },
  ],
  View: StageReviewView,
};
