"use client";

// The stage demo's own screens and speaker notes. Everything shown here is what
// the app does today:
//   - the issue scanner's verdicts, with the reasons it gives verbatim
//     (lib/issues.ts, drawn as components/issue-scanner.tsx draws them);
//   - Explore's plain-English questions, which are answered from the repository's
//     code graph, point to the files involved and show their cost (app/api/graph/query);
//   - the real pydantic/pydantic graph and a real Explore answer, drawn on it for the stage
//     (repo-map.tsx; demo only: the hops are the graph's own relations).
// The notes carry the pitch: the guided path for someone new to open source, and
// why maintainers can trust what it sends them.

import { ArrowUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-dot";
import { AppWindow, Press, Reveal, SCOPE_LABEL, Typed, progress, useFollow, useT, type Caption, type Chapter } from "./kit";
import { MAP_FOCUS_LENGTH, RepoMap } from "./repo-map";
import { PrDataContext, PrRailContext } from "./chapters-fix";
import { useEffect, useState, type ReactNode } from "react";
import { Doodle } from "@/components/brand/doodles";
import { check, circle, o, pass } from "@/components/brand/doodle-data";
import { Wordmark } from "@/components/brand/wordmark";
import { STORY_DIAGNOSIS as DIAGNOSIS, STORY_DIFF, STORY_ISSUE, STORY_PATCH_STATS as PATCH_STATS, STORY_PR_BODY, STORY_REPO, STORY_RISK as RISK, STORY_RUN as RUN, STORY_TEST_COMMAND } from "./stage-story";
import { PRACTICE_INTRO } from "@/components/own-words";
import { Inline } from "./kit";

// The stage tells one story on Pydantic: the scanned issue, the code the map traces, the run that fixes it.
const DEMO_REPO = STORY_REPO;
const ISSUE_TAG = `#${STORY_ISSUE.number}`;
/** The PR page and the published panel, showing the Pydantic pull request. */
// The PR page scrolls slowly on stage, so each point can be made while its part is in view.
const PR_SCROLL: [number, number] = [4000, 20000];
const STORY_PR = { repo: STORY_REPO, pr: RUN.pr, title: RUN.prTitle, base: RUN.base, head: RUN.head, issue: STORY_ISSUE.number, body: STORY_PR_BODY, stats: PATCH_STATS, scroll: PR_SCROLL };


/** A chapter with speaker notes added for the stage, merged in time order. */
export function withNotes(chapter: Chapter, notes: Caption[]): Chapter {
  return { ...chapter, captions: [...chapter.captions, ...notes].sort((a, b) => a.at - b.at) };
}

// ── Find: the issue scanner ──────────────────────────────────────────────────

type ScanRow = { number: number; title: string; category: string; labels: string[]; opened: string; scope?: string; risk?: "low" | "medium"; complexity?: number; estimate?: string; reason?: string };

// The verdicts and their reasons are the scanner's own wording; the first ready issue is the one the stage fixes.
const SCAN_REPO = STORY_REPO;
const SCAN: ScanRow[] = [
  { number: STORY_ISSUE.number, title: STORY_ISSUE.title, category: "bug", labels: ["bug"], opened: "3d ago", scope: "leaf", risk: "medium", complexity: 2, estimate: "30m" },
  { number: 12468, title: "model_json_schema drops descriptions on nested Annotated fields", category: "bug", labels: ["bug V2"], opened: "4d ago", reason: "Already assigned to @mira-dev — someone's on it. Skip." },
  { number: 12465, title: "TypeAdapter ignores strict=True for nested dataclasses", category: "bug", labels: ["bug V2"], opened: "5d ago", reason: "1 open PR already targets this issue. Review or help with it instead." },
  { number: 12462, title: "field_validator error names the alias instead of the field", category: "bug", labels: ["bug V2"], opened: "6d ago", scope: "leaf", risk: "low", complexity: 2, estimate: "45m" },
  { number: 12458, title: "computed_field loses its alias in model_dump(by_alias=True)", category: "bug", labels: ["bug V2"], opened: "9d ago", reason: "Appears already resolved (comment by @core-dev (maintainer) says \"fixed in #12460\"). Skip — the ticket is stale-open." },
  { number: 12455, title: "Docs: the serialization page shows an old model_dump signature", category: "docs", labels: ["documentation"], opened: "12d ago", scope: "doc", risk: "low", complexity: 1, estimate: "15m" },
  { number: 12451, title: "How do I validate a dict with dynamic keys?", category: "question", labels: ["question"], opened: "14d ago", reason: "Question, not an actionable issue." },
  { number: 12446, title: "Rewrite the validation core in pure Python", category: "refactor", labels: ["wontfix"], opened: "21d ago", reason: "Labeled as non-actionable." },
  { number: 12440, title: "Doesn't work with my settings", category: "other", labels: [], opened: "25d ago", reason: "Unclear scope — issue body too sparse." },
];
const READY = SCAN.filter((r) => !r.reason);
const SHOW_ALL_AT = 2400; // the presenter switches the filter to All…
// …each skipped issue then arrives slowly enough to talk over (the list scrolls to it)…
const SKIPPED = SCAN.filter((r) => r.reason);
const SKIP_STEP = 1100;
// The first two (assigned, PR already open) stay in view for a moment before the list scrolls on.
const skipAt = (i: number) => SHOW_ALL_AT + 600 + i * SKIP_STEP + (i >= 2 ? 2600 : 0);
const SHOW_READY_AT = skipAt(SKIPPED.length) + 2500; // …and back to Ready once every verdict has been seen

function ScanView() {
  const t = useT();
  const all = t >= SHOW_ALL_AT && t < SHOW_READY_AT;
  const rows = all ? SCAN : READY;
  let skipped = 0;
  // All nine rows don't fit: the page scrolls gently to each skipped issue as it arrives.
  const followRef = useFollow(t >= skipAt(2) ? Math.floor(t / 250) : -1);
  return (
    <AppWindow path={`/issues?repo=${SCAN_REPO}`} section="Find" tab="Issues">
      <div ref={followRef} data-spot="scan-list" className="h-full overflow-hidden scroll-smooth px-4 py-3 sm:px-6">
        <div className="rounded-xl border border-border-soft bg-surface">
          <div className="flex items-end justify-between gap-4 border-b border-border-soft px-4 py-3">
            <div>
              <p className="text-[13px] font-medium text-signal">Scan complete</p>
              <p className="text-[16px] font-semibold text-paper">{SCAN_REPO}</p>
              <p className="text-[13px] text-paper-muted"><span className="font-medium text-paper">{SCAN.length}</span> open issues; <span className="font-medium text-signal">{READY.length}</span> ready for an automated attempt.</p>
            </div>
            <div className="text-[13px]">
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
              const at = r.reason ? skipAt(skipped++) : 0;
              return (
                <Reveal key={r.number} at={at} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5", r.reason && "opacity-70")}>
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] text-paper-muted">{[`#${r.number}`, r.category, ...r.labels.filter((l) => l !== r.category), `opened ${r.opened}`].join(" · ")}</p>
                    <p className="mt-0.5 truncate text-[15px] font-medium text-paper">{r.title}</p>
                    {r.reason
                      ? <p className="mt-0.5 font-mono text-[13px] text-paper-muted">needs review</p>
                      : <p className="mt-0.5 font-mono text-[13px] text-paper-muted">{[SCOPE_LABEL[r.scope!] ?? r.scope, `risk ${r.risk}`, `${r.complexity}/5`, `~${r.estimate}`].join(" · ")} · <span className="text-ok">ready</span></p>}
                  </div>
                  {r.reason ? (
                    <p className="max-w-[300px] text-[13px] leading-[1.45] text-paper-dim">{r.reason}</p>
                  ) : (
                    <span className="flex items-center gap-4 text-[14px]">
                      <span className="text-paper-dim underline decoration-border-strong underline-offset-4">Preview patch</span>
                      <span className="rounded-[10px] border border-border px-2.5 py-0.5 font-medium text-paper">Fix it (you review first)</span>
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
  source: "The scan of Pydantic's open issues; the verdicts are the scanner's own",
  headlines: [{ at: 0, text: "It only picks issues that are open to you." }],
  captions: [
    { at: 0, text: "Step one: an issue that's actually open to a newcomer. Claude Code assumes you already have one." },
    { at: SHOW_ALL_AT, text: "Show everything it found, including what it filtered out, and why." },
    { at: SHOW_ALL_AT + 600, spot: "scan-list", text: "Assigned? Skip. A pull request already open? Skip, help them instead. Already fixed? Skip. Questions, wontfix and vague ones are flagged too, each with the reason. That alone saves maintainers duplicate PRs." },
    { at: SHOW_READY_AT, text: "Back to the ready ones. This is the contribution etiquette Claude Code assumes you already know. We'll take the first: to_pascal leaves double underscores in the names it generates." },
  ],
  View: ScanView,
};

// ── Understand: plain-English questions about the code ──────────────────────

type Turn = { prompt: string; answer: string; cites: string[]; cost?: string; lesson?: Lesson };
/** An answer in the product's lesson shape: [label, text] lines. */
type Lesson = Array<[string, string]>;
/** The plain text of a lesson, which sets how long it takes to type. */
const lessonText = (lesson: Lesson) => lesson.map(([label, text]) => `${label} ${text}`).join("\n");

/** A lesson typed in, line by line, with its labels in bold. */
function LessonTyped({ lesson, at, cps }: { lesson: Lesson; at: number; cps: number }) {
  const t = useT();
  let left = Math.max(0, Math.floor(((t - at) / 1000) * cps));
  const total = lessonText(lesson).length;
  return (
    <div className="space-y-1 text-[13.5px] leading-[1.42]">
      {lesson.map(([label, text]) => {
        const line = `${label} ${text}`;
        const shown = Math.min(line.length, left);
        left = Math.max(0, left - line.length - 1);
        if (shown === 0) return null;
        return (
          <p key={label}>
            <strong className="font-semibold">{line.slice(0, Math.min(shown, label.length))}</strong>
            {line.slice(label.length, shown)}
          </p>
        );
      })}
      {t >= at && Math.floor(((t - at) / 1000) * cps) < total && <span aria-hidden className="inline-block h-[1em] w-px bg-current" />}
    </div>
  );
}
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
  const beat = Math.floor(t / 250);
  const scrollRef = useFollow(beat);
  // Once the conversation has scrolled, what leaves at the top fades out instead of being sliced.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const pane = scrollRef.current;
    const answer = pane?.querySelector<HTMLElement>("[data-spot=answer]");
    if (pane && answer && answer.offsetTop - pane.offsetTop < pane.scrollTop) pane.scrollTop = answer.offsetTop - pane.offsetTop - 8;
    // A pixel or two of overflow slices nothing; fading then would hide the question for no reason.
    setScrolled((pane?.scrollTop ?? 0) > 16);
  }, [beat, scrollRef]);
  const typing = turns.find((turn) => t >= turn.typeAt && t < turn.askAt + 150);
  return (
    <section data-spot="ask" aria-label="Ask in plain English" className="flex h-full min-h-0 flex-col rounded-xl border border-border-soft bg-surface">
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5">
        <Doodle doodle={o} className="size-6 shrink-0 text-signal" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-paper">{text.title}</p>
          <p className="text-[13px] leading-tight text-paper-muted">{text.subtitle}</p>
        </div>
      </div>
      <div ref={scrollRef} className={cn("min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-3", scrolled && "[mask-image:linear-gradient(to_bottom,transparent_0,transparent_20px,#000_72px)]")}>
        {/* The intro gives way once a question is asked, as in a chat, so the answer has the room. */}
        {!turns.some((turn) => t >= turn.askAt + 150) && <p className="rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5 text-[13.5px] leading-[1.45] text-paper-dim">{text.intro}</p>}
        {turns.map((turn) => t >= turn.askAt + 150 && (
          <div key={turn.prompt} className="space-y-2">
            <Reveal at={turn.askAt + 150} className="ml-10 rounded-2xl rounded-tr-md bg-paper px-3 py-2 text-[14px] leading-[1.45] text-surface">{turn.prompt}</Reveal>
            {t < turn.answerAt ? (
              <div className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5" aria-label="Thinking">
                {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-paper-muted motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />)}
              </div>
            ) : (
              <div data-spot="answer" className="text-[14px] leading-[1.5] text-paper">
                {turn.lesson ? <LessonTyped lesson={turn.lesson} at={turn.answerAt} cps={ANSWER_CPS} /> : <Typed text={turn.answer} at={turn.answerAt} cps={ANSWER_CPS} />}
                <Reveal at={turn.doneAt} className="mt-2 flex flex-wrap items-center gap-1.5">
                  {turn.cites.map((c) => <span key={c} className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-[13px] text-signal">{c}</span>)}
                  {turn.cost && <span className="ml-auto font-mono text-[13px] text-paper-muted">AI answer · {turn.cost}</span>}
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

// Explore on a large real repository: pydantic/pydantic, mapped by the site's own graph builder.
const MAP_REPO = "pydantic/pydantic";
const MAP_PANEL: PanelText = { ...GRAPH_PANEL, placeholder: `Ask about ${MAP_REPO}…` };
const BUILT_AT = 2600;
// Asked on the real Explore page against the real graph (public/demo/pydantic-graph.json has the
// full answer). The lesson's lines verbatim, trimmed with "…"; the cites and cost are the run's.
const MAP_LESSON: Lesson = [
  ["In short:", "to_pascal() converts snake_case strings to PascalCase and is used by to_camel(), model creation, and deprecated decorator code to generate field aliases automatically."],
  ["If you change it:", "Any model using alias_generator=to_pascal will generate different field names in JSON/dict output … Run these first: pytest tests/test_utils.py tests/test_computed_fields.py tests/test_deprecated.py"],
  ["Try this:", "Open tests/test_utils.py and find test_snake2pascal() to see exactly what transformation is expected, then run that one test to confirm your understanding."],
];
const FIRST = schedule(BUILT_AT + 900, [
  {
    prompt: "Where is to_pascal used, and what breaks if I change it?",
    answer: lessonText(MAP_LESSON), lesson: MAP_LESSON,
    cites: ["pydantic/alias_generators.py", "tests/test_utils.py", "tests/test_deprecated.py"], cost: "$0.0204",
  },
]);
// The stage draws the answer on the map while it streams in, so both play at once.
const FOCUS_AT = FIRST.turns[0].answerAt;
const EXPLORE_END = Math.max(FIRST.end, FOCUS_AT + MAP_FOCUS_LENGTH);
const TURNS = FIRST.turns;

function StageExploreView() {
  const t = useT();
  const built = t >= BUILT_AT;
  const pct = Math.round(progress(t, 700, BUILT_AT - 100) * 100);
  return (
    <AppWindow path={`/graph?repo=${MAP_REPO}`} section="Explore">
      <div className="flex h-full flex-col overflow-hidden px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[13px] text-paper">{MAP_REPO}</span>
          <Press at={650} className="rounded-[10px] bg-paper px-3 py-1 text-[13px] font-medium text-surface">{t >= 700 && !built ? "building..." : built ? "Rebuild graph" : "Build graph"}</Press>
          {built && <span className="text-[13px] text-ok">● map ready · parsed, no AI</span>}
        </div>
        {!built && t >= 700 && (
          <div className="mt-3 rounded-xl border border-border-soft bg-surface p-3">
            <div className="flex items-center justify-between text-[13px]"><span className="text-paper">Reading the source files</span><span className="font-mono text-signal">{pct}%</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-signal" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {built && (
          <div className="mt-3 grid min-h-0 flex-1 grid-cols-[52fr_48fr] gap-3">
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
  duration: EXPLORE_END + 2500,
  source: "The real pydantic/pydantic graph and a real Explore answer; the zoom is drawn for the stage",
  provenance: [{ at: 0, text: "real answer · zoom drawn for the talk" }],
  headlines: [
    { at: 0, text: "Understand the code before you change it." },
    { at: FIRST.turns[0].typeAt, text: "Ask about it in plain English." },
    { at: FOCUS_AT, text: "Know what your change touches before you touch it." },
  ],
  captions: [
    { at: 0, text: "Before changing anything, understand the code. Explore maps the repository straight from its source code: no AI, and nothing to install on your machine." },
    { at: BUILT_AT, spot: "graph", text: "This is Pydantic: 6,907 nodes (the files, functions and classes of its main package and tests) in 330 communities, and the links between them, mapped by the site's own graph builder. (The layout was computed for this talk from that real graph.)" },
    { at: FIRST.turns[0].typeAt, spot: "ask", text: `Then ask the question you'd normally grep for: “${FIRST.turns[0].prompt}” The answer comes from the map and points to the files involved.` },
    { at: FOCUS_AT, spot: "graph", text: "As the answer streams in, the map zooms from all of Pydantic down to to_pascal(), then lights everything that depends on it, one and two hops out." },
    { at: FIRST.turns[0].doneAt, spot: "answer", text: "The answer teaches: what it does in one line, where it lives, what to run if you change it, and one thing to try yourself. Know what your change touches before you touch it." },
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
  // Each note comes due as the slow scroll (PR_SCROLL) brings its part of the page into view.
  const at = (p: number) => Math.round(PR_SCROLL[0] + p * (PR_SCROLL[1] - PR_SCROLL[0]));
  return {
    pr: { ...withProvenance(staged(base.pr, [{ at: 0, text: "Every GitHub step, done right." }, { at: at(0.55), text: "The maintainer always knows AI helped." }], [
      { at: 0, spot: "pr-facts", text: "Every GitHub step done right: its own branch, your private noreply email, the right base branch, and a description that closes the issue." },
      { at: at(0.32), spot: "pr-verified", text: "The description shows the tests it ran and the result: verified." },
      { at: at(0.55), spot: "pr-ai", text: "And it discloses itself: who asked, which model, what was and wasn't tested, plus an Assisted-by trailer and a sign-off where the project asks." },
      { at: at(0.85), text: "It stays a draft until you mark it ready. The maintainer always knows." },
    ]), []), source: "The Pydantic pull request", duration: PR_SCROLL[1] + 3000 },
  };
}

// ── Ship: what it did on GitHub, as the pull request shows it ───────────────

// Pydantic isn't the contributor's own repository, so it forks first and opens the PR from the fork.
const PR_FACTS: Array<[string, string]> = [
  ["Fork", "rahulp7801/pydantic"],
  ["Branch", RUN.head.split(":")[1]],
  ["Into", `${STORY_REPO} · ${RUN.base}`],
  ["Commit author", "…@users.noreply.github.com"],
  ["Status", "Draft, opened by rahulp7801"],
  ["Commit", "1, with “Assisted-by: claude-sonnet-5 via opensrcer”"],
  ["Closes", `${ISSUE_TAG} (“fix ${ISSUE_TAG}” in the description)`],
];

const FACTS_AT = 2200;

/** The pull request screen with the GitHub steps it took, read off the PR itself, in the PR's right rail. */
export function withPrFacts(chapter: Chapter): Chapter {
  const Inner = chapter.View;
  const facts = (
    <Reveal at={FACTS_AT} spot="pr-facts" className="border-t border-border-soft pt-3">
      <p className="text-[15px] font-medium text-paper">What it did on GitHub</p>
      <dl className="mt-2 space-y-2">
        {PR_FACTS.map(([k, v], i) => (
          <Reveal key={k} at={FACTS_AT + 300 + i * 450}>
            <dt className="text-[13px] text-paper-muted">{k}</dt>
            <dd className="break-words font-mono text-[13px] text-paper">{v}</dd>
          </Reveal>
        ))}
      </dl>
    </Reveal>
  );
  function View() {
    return <PrDataContext.Provider value={STORY_PR}><PrRailContext.Provider value={facts}><Inner /></PrRailContext.Provider></PrDataContext.Provider>;
  }
  return { ...chapter, View };
}

// ── Fix: when it says no ────────────────────────────────────────────────────

// Publishing to pallets/flask: Flask has no guide of its own, so its organization's default
// (pallets/.github CONTRIBUTING.md) applies, and it closes AI-generated PRs on sight.
// lib/publish.ts liveGuards refuses with lib/contrib-guard.ts orgAiBanReason's words (checked
// against GitHub on 2026-10-26).
const BAN_REPO = "pallets/flask";
const BAN_REFUSAL = 'Refused: this project does not accept AI-generated contributions (pallets/.github CONTRIBUTING.md: "AI-generated PRs and issues are closed on sight, without review or discussion.").';
const BAN_PRESS_AT = 1600;
const BAN_REFUSED_AT = 2300;
// lib/agentic-dispatcher.ts refuses before any model spend with these words, then the hint below.
const BAN_HINT = "A preview (dry run) is still possible.";

// The guard's own words (lib/contrib-guard.ts maintainerObjectionReason), with the name and
// the quote withheld. A REAL issue in a major open-source project; who and where stay hidden.
const MAINT_AT = 5500;


function MaintainerView() {
  return (
    <AppWindow path="/dispatches" section="Fix" tab="Runs">
      <div className="flex h-full justify-center px-6 pb-6 pt-[6%]">
        <div className="w-full max-w-[820px]">
        <Reveal at={MAINT_AT + 600} spot="maint" className="rounded-2xl border border-border bg-surface px-6 py-5">
          <p className="text-[19px] font-medium text-paper">Review before publishing</p>
          <p role="alert" className="mt-3 rounded-lg border border-alert/30 bg-alert/5 px-4 py-3 text-[19px] leading-relaxed text-alert">
            Blocked: a maintainer asked for human-written work on this issue <span className="text-paper-muted">(their name and words are withheld here)</span>. opensrcer won&apos;t open an AI-assisted pull request here; you can still use this preview to write the fix yourself
          </p>
        </Reveal>
        </div>
      </div>
    </AppWindow>
  );
}

function RefusedView() {
  const t = useT();
  if (t >= MAINT_AT) return <MaintainerView />;
  return (
    <AppWindow path={`/dispatches?dispatch=c_example`} section="Fix" tab="Runs">
      <div className="p-6">
        <div data-spot="refusal" className="mx-auto max-w-[860px] overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="border-b border-border px-5 py-3">
            <p className="text-[13px] text-paper-muted">{BAN_REPO}</p>
            <p className="mt-0.5 text-[17px] font-medium text-paper">Start a run on an open issue</p>
          </div>
          <Reveal at={400} className="px-5 py-4 text-[15px]">
            <div className="flex items-center gap-3">
              <span className={cn("rounded-[10px] border border-border px-3 py-1 font-medium text-paper transition-transform", t >= BAN_PRESS_AT && t < BAN_PRESS_AT + 250 && "scale-[0.96]", t >= BAN_REFUSED_AT && "opacity-40")}>Fix it (you review first)</span>
              {t >= BAN_PRESS_AT && t < BAN_REFUSED_AT && <span className="text-paper-muted">Reading the project&apos;s rules…</span>}
            </div>
            {t >= BAN_REFUSED_AT && <p role="alert" className="stage-settle mt-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2.5 text-alert">{BAN_REFUSAL} {BAN_HINT}</p>}
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
  holds: [MAINT_AT],
  source: "Flask's real policy (its organization's guide) refused before the run starts; then a real issue, names hidden",
  headlines: [{ at: 0, text: "And when a project says no, it stops before writing any code." }, { at: MAINT_AT, text: "It listens to maintainers, even in the comments." }],
  provenance: [{ at: 0, text: "Flask's real policy" }, { at: MAINT_AT, text: "Real issue · names hidden" }],
  captions: [
    { at: 0, spot: "refusal", text: "Not every project wants AI help, and it respects that. Flask's organization closes AI-generated pull requests on sight. So when you start a run on Flask, it refuses before writing any code, quoting their guide. Nothing is spent and nothing is posted. Same when someone else already has a pull request open." },
    { at: MAINT_AT, spot: "maint", text: "And it listens to maintainers in the issue itself. On a real project, a maintainer asked for a human-written pull request, so opensrcer refused to publish. Name and quote withheld; the preview still helps you write the fix yourself." },
  ],
  View: RefusedView,
};

// ── Close: why this isn't AI slop ───────────────────────────────────────────

// Each row is something opensrcer does today (on the hosted site unless it says otherwise).
// The three the talk has shown; the notes window carries the rest if asked.
const SLOP: Array<[string, string]> = [
  ["Nobody asked for it", "It steers you to issues that are open to you, and refuses where the guide bans AI or a maintainer asks for human-written work."],
  ["The sender can't explain it", "Nothing publishes until you explain the change in your own words and answer a practice review."],
  ["Untested", "It runs the project's tests on the final patch, and checks the new test fails without the fix."],
];
const SLOP_STEP = 500;
const SLOP_LINE_AT = 700 + SLOP.length * SLOP_STEP + 400; // after the last row

// The closing line, inked in word by word once the rows have had their moment.
const CLOSE_AT = SLOP_LINE_AT + 2600;
const CLOSE_LINES = ["Not more pull requests.", "Better ones."];
const CLOSE_REST = "Tested in a locked box, explained in your words, following each project's rules.";

function SlopView() {
  const t = useT();
  if (t >= CLOSE_AT) return <CloseView />;
  return (
    <div className="flex h-full flex-col justify-start bg-ink pt-4">
      <div className="divide-y divide-border">
        {SLOP.map(([problem, answer], i) => (
          <Reveal key={problem} at={700 + i * SLOP_STEP} className="grid grid-cols-[320px_minmax(0,1fr)] items-baseline gap-10 py-7">
            <p className="relative w-fit text-[22px] font-medium text-paper">
              {problem}
              {t >= 700 + i * SLOP_STEP + 600 && <Doodle doodle={pass} draw="load" duration={600} stretch className="absolute left-[-3%] top-[50%] h-[0.28em] w-[106%] text-signal" />}
            </p>
            <p className="text-[20px] leading-[1.4] text-paper">{answer}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function CloseView() {
  let i = 0;
  const ink = (text: string) => text.split(" ").map((word) => <span key={word + i} className="stage-ink" style={{ "--d": `${300 + i++ * 140}ms` } as React.CSSProperties}>{word} </span>);
  return (
    <div className="stage-enter relative flex h-full flex-col justify-end bg-ink pb-8">
      {/* The code map's lit path ends at the wordmark's "o". */}
      <span className="absolute left-0 top-6 inline-block">
        <Wordmark className="text-[40px] text-paper" />
        <CodeMap variant="close" className="absolute w-[300px]" style={{ left: -5, top: 5 }} />
      </span>
      <p className="display text-[96px] leading-[1] tracking-[-0.025em]">
        <span className="block text-paper-muted [--ink-to:var(--color-paper-muted)]">{ink(CLOSE_LINES[0])}</span>
        <span className="block text-paper">{ink(CLOSE_LINES[1])}</span>
      </p>
      <p className="stage-rise mt-5 text-[20px] text-paper-muted" style={{ animationDelay: "1500ms" }}>{CLOSE_REST}</p>
      <figure className="stage-rise absolute right-0 top-6 flex items-center gap-4" style={{ animationDelay: "1800ms" }}>
        <figcaption className="text-right"><span className="block text-[16px] text-paper-muted">Try it</span><span className="block font-mono text-[17px] text-paper">opensrced.vercel.app/join</span></figcaption>
        <svg viewBox="0 0 29 29" className="size-[120px] rounded-md bg-surface p-2" role="img" aria-label="QR code for opensrced.vercel.app/join"><path d="M0,0H1V1H0zM1,0H2V1H1zM2,0H3V1H2zM3,0H4V1H3zM4,0H5V1H4zM5,0H6V1H5zM6,0H7V1H6zM9,0H10V1H9zM10,0H11V1H10zM12,0H13V1H12zM14,0H15V1H14zM18,0H19V1H18zM19,0H20V1H19zM22,0H23V1H22zM23,0H24V1H23zM24,0H25V1H24zM25,0H26V1H25zM26,0H27V1H26zM27,0H28V1H27zM28,0H29V1H28zM0,1H1V2H0zM6,1H7V2H6zM8,1H9V2H8zM11,1H12V2H11zM12,1H13V2H12zM13,1H14V2H13zM17,1H18V2H17zM18,1H19V2H18zM19,1H20V2H19zM20,1H21V2H20zM22,1H23V2H22zM28,1H29V2H28zM0,2H1V3H0zM2,2H3V3H2zM3,2H4V3H3zM4,2H5V3H4zM6,2H7V3H6zM9,2H10V3H9zM15,2H16V3H15zM19,2H20V3H19zM20,2H21V3H20zM22,2H23V3H22zM24,2H25V3H24zM25,2H26V3H25zM26,2H27V3H26zM28,2H29V3H28zM0,3H1V4H0zM2,3H3V4H2zM3,3H4V4H3zM4,3H5V4H4zM6,3H7V4H6zM10,3H11V4H10zM11,3H12V4H11zM12,3H13V4H12zM13,3H14V4H13zM16,3H17V4H16zM18,3H19V4H18zM19,3H20V4H19zM22,3H23V4H22zM24,3H25V4H24zM25,3H26V4H25zM26,3H27V4H26zM28,3H29V4H28zM0,4H1V5H0zM2,4H3V5H2zM3,4H4V5H3zM4,4H5V5H4zM6,4H7V5H6zM8,4H9V5H8zM11,4H12V5H11zM13,4H14V5H13zM16,4H17V5H16zM17,4H18V5H17zM18,4H19V5H18zM19,4H20V5H19zM22,4H23V5H22zM24,4H25V5H24zM25,4H26V5H25zM26,4H27V5H26zM28,4H29V5H28zM0,5H1V6H0zM6,5H7V6H6zM9,5H10V6H9zM12,5H13V6H12zM14,5H15V6H14zM15,5H16V6H15zM16,5H17V6H16zM17,5H18V6H17zM18,5H19V6H18zM19,5H20V6H19zM22,5H23V6H22zM28,5H29V6H28zM0,6H1V7H0zM1,6H2V7H1zM2,6H3V7H2zM3,6H4V7H3zM4,6H5V7H4zM5,6H6V7H5zM6,6H7V7H6zM8,6H9V7H8zM10,6H11V7H10zM12,6H13V7H12zM14,6H15V7H14zM16,6H17V7H16zM18,6H19V7H18zM20,6H21V7H20zM22,6H23V7H22zM23,6H24V7H23zM24,6H25V7H24zM25,6H26V7H25zM26,6H27V7H26zM27,6H28V7H27zM28,6H29V7H28zM9,7H10V8H9zM10,7H11V8H10zM12,7H13V8H12zM15,7H16V8H15zM17,7H18V8H17zM0,8H1V9H0zM2,8H3V9H2zM4,8H5V9H4zM6,8H7V9H6zM10,8H11V9H10zM11,8H12V9H11zM12,8H13V9H12zM16,8H17V9H16zM17,8H18V9H17zM18,8H19V9H18zM24,8H25V9H24zM27,8H28V9H27zM1,9H2V10H1zM3,9H4V10H3zM4,9H5V10H4zM5,9H6V10H5zM7,9H8V10H7zM8,9H9V10H8zM9,9H10V10H9zM12,9H13V10H12zM13,9H14V10H13zM15,9H16V10H15zM16,9H17V10H16zM20,9H21V10H20zM22,9H23V10H22zM25,9H26V10H25zM28,9H29V10H28zM0,10H1V11H0zM2,10H3V11H2zM5,10H6V11H5zM6,10H7V11H6zM8,10H9V11H8zM10,10H11V11H10zM14,10H15V11H14zM15,10H16V11H15zM16,10H17V11H16zM17,10H18V11H17zM22,10H23V11H22zM26,10H27V11H26zM27,10H28V11H27zM28,10H29V11H28zM7,11H8V12H7zM12,11H13V12H12zM13,11H14V12H13zM14,11H15V12H14zM16,11H17V12H16zM17,11H18V12H17zM19,11H20V12H19zM20,11H21V12H20zM22,11H23V12H22zM24,11H25V12H24zM27,11H28V12H27zM1,12H2V13H1zM2,12H3V13H2zM6,12H7V13H6zM7,12H8V13H7zM8,12H9V13H8zM11,12H12V13H11zM12,12H13V13H12zM14,12H15V13H14zM15,12H16V13H15zM16,12H17V13H16zM17,12H18V13H17zM20,12H21V13H20zM21,12H22V13H21zM22,12H23V13H22zM25,12H26V13H25zM27,12H28V13H27zM28,12H29V13H28zM1,13H2V14H1zM2,13H3V14H2zM4,13H5V14H4zM8,13H9V14H8zM10,13H11V14H10zM11,13H12V14H11zM14,13H15V14H14zM15,13H16V14H15zM17,13H18V14H17zM20,13H21V14H20zM22,13H23V14H22zM25,13H26V14H25zM28,13H29V14H28zM0,14H1V15H0zM4,14H5V15H4zM5,14H6V15H5zM6,14H7V15H6zM7,14H8V15H7zM8,14H9V15H8zM13,14H14V15H13zM16,14H17V15H16zM18,14H19V15H18zM20,14H21V15H20zM22,14H23V15H22zM23,14H24V15H23zM24,14H25V15H24zM25,14H26V15H25zM27,14H28V15H27zM28,14H29V15H28zM0,15H1V16H0zM1,15H2V16H1zM4,15H5V16H4zM8,15H9V16H8zM9,15H10V16H9zM10,15H11V16H10zM11,15H12V16H11zM16,15H17V16H16zM17,15H18V16H17zM18,15H19V16H18zM20,15H21V16H20zM21,15H22V16H21zM22,15H23V16H22zM25,15H26V16H25zM27,15H28V16H27zM0,16H1V17H0zM4,16H5V17H4zM5,16H6V17H5zM6,16H7V17H6zM9,16H10V17H9zM10,16H11V17H10zM11,16H12V17H11zM15,16H16V17H15zM16,16H17V17H16zM17,16H18V17H17zM21,16H22V17H21zM22,16H23V17H22zM25,16H26V17H25zM27,16H28V17H27zM28,16H29V17H28zM1,17H2V18H1zM2,17H3V18H2zM5,17H6V18H5zM8,17H9V18H8zM9,17H10V18H9zM10,17H11V18H10zM11,17H12V18H11zM12,17H13V18H12zM13,17H14V18H13zM16,17H17V18H16zM17,17H18V18H17zM18,17H19V18H18zM20,17H21V18H20zM21,17H22V18H21zM22,17H23V18H22zM25,17H26V18H25zM26,17H27V18H26zM28,17H29V18H28zM0,18H1V19H0zM4,18H5V19H4zM6,18H7V19H6zM9,18H10V19H9zM12,18H13V19H12zM14,18H15V19H14zM18,18H19V19H18zM20,18H21V19H20zM22,18H23V19H22zM24,18H25V19H24zM27,18H28V19H27zM28,18H29V19H28zM1,19H2V20H1zM3,19H4V20H3zM4,19H5V20H4zM5,19H6V20H5zM7,19H8V20H7zM8,19H9V20H8zM10,19H11V20H10zM13,19H14V20H13zM14,19H15V20H14zM15,19H16V20H15zM17,19H18V20H17zM20,19H21V20H20zM22,19H23V20H22zM23,19H24V20H23zM25,19H26V20H25zM27,19H28V20H27zM0,20H1V21H0zM4,20H5V21H4zM5,20H6V21H5zM6,20H7V21H6zM7,20H8V21H7zM9,20H10V21H9zM10,20H11V21H10zM11,20H12V21H11zM14,20H15V21H14zM15,20H16V21H15zM16,20H17V21H16zM17,20H18V21H17zM19,20H20V21H19zM20,20H21V21H20zM21,20H22V21H21zM22,20H23V21H22zM23,20H24V21H23zM24,20H25V21H24zM8,21H9V22H8zM9,21H10V22H9zM11,21H12V22H11zM12,21H13V22H12zM14,21H15V22H14zM16,21H17V22H16zM17,21H18V22H17zM18,21H19V22H18zM19,21H20V22H19zM20,21H21V22H20zM24,21H25V22H24zM26,21H27V22H26zM27,21H28V22H27zM28,21H29V22H28zM0,22H1V23H0zM1,22H2V23H1zM2,22H3V23H2zM3,22H4V23H3zM4,22H5V23H4zM5,22H6V23H5zM6,22H7V23H6zM9,22H10V23H9zM10,22H11V23H10zM11,22H12V23H11zM13,22H14V23H13zM18,22H19V23H18zM19,22H20V23H19zM20,22H21V23H20zM22,22H23V23H22zM24,22H25V23H24zM25,22H26V23H25zM27,22H28V23H27zM28,22H29V23H28zM0,23H1V24H0zM6,23H7V24H6zM9,23H10V24H9zM11,23H12V24H11zM12,23H13V24H12zM16,23H17V24H16zM17,23H18V24H17zM19,23H20V24H19zM20,23H21V24H20zM24,23H25V24H24zM25,23H26V24H25zM0,24H1V25H0zM2,24H3V25H2zM3,24H4V25H3zM4,24H5V25H4zM6,24H7V25H6zM8,24H9V25H8zM10,24H11V25H10zM15,24H16V25H15zM16,24H17V25H16zM17,24H18V25H17zM18,24H19V25H18zM20,24H21V25H20zM21,24H22V25H21zM22,24H23V25H22zM23,24H24V25H23zM24,24H25V25H24zM28,24H29V25H28zM0,25H1V26H0zM2,25H3V26H2zM3,25H4V26H3zM4,25H5V26H4zM6,25H7V26H6zM9,25H10V26H9zM11,25H12V26H11zM16,25H17V26H16zM19,25H20V26H19zM24,25H25V26H24zM26,25H27V26H26zM27,25H28V26H27zM28,25H29V26H28zM0,26H1V27H0zM2,26H3V27H2zM3,26H4V27H3zM4,26H5V27H4zM6,26H7V27H6zM8,26H9V27H8zM9,26H10V27H9zM10,26H11V27H10zM12,26H13V27H12zM13,26H14V27H13zM14,26H15V27H14zM16,26H17V27H16zM17,26H18V27H17zM19,26H20V27H19zM20,26H21V27H20zM23,26H24V27H23zM24,26H25V27H24zM25,26H26V27H25zM28,26H29V27H28zM0,27H1V28H0zM6,27H7V28H6zM10,27H11V28H10zM17,27H18V28H17zM18,27H19V28H18zM19,27H20V28H19zM20,27H21V28H20zM24,27H25V28H24zM27,27H28V28H27zM0,28H1V29H0zM1,28H2V29H1zM2,28H3V29H2zM3,28H4V29H3zM4,28H5V29H4zM5,28H6V29H5zM6,28H7V29H6zM8,28H9V29H8zM9,28H10V29H9zM10,28H11V29H10zM12,28H13V29H12zM14,28H15V29H14zM15,28H16V29H15zM16,28H17V29H16zM17,28H18V29H17zM19,28H20V29H19zM20,28H21V29H20zM21,28H22V29H21zM22,28H23V29H22zM23,28H24V29H23zM27,28H28V29H27zM28,28H29V29H28z" fill="currentColor" className="text-paper" /></svg>
      </figure>
      <div className="mt-8 flex items-baseline gap-8 border-t border-border pt-4 font-mono text-[15px] text-paper-dim">
        <span>opensrced.vercel.app/join</span>
        <span className="ml-auto font-sans text-[18px] text-paper">Rahul Puritipati <span className="font-mono text-[15px] text-paper-muted">· @rahulp7801</span></span>
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
  holds: [CLOSE_AT],
  source: "What opensrcer does today",
  poster: true,
  headlines: [{ at: 0, text: "What slop is made of, and what opensrcer does instead." }, { at: CLOSE_AT, text: "" }],
  captions: [
    { at: 0, text: "Back to where we started: what slop is made of, and what opensrcer does about each." },
    { at: 700 + 1 * SLOP_STEP, text: "The heart of it: you can't publish what you can't explain, and the chat is there so you can. (The rest, if asked: one pull request per project, drafts only, and every PR says what was and wasn't tested.)" },
    { at: CLOSE_AT, text: "It's built to make better contributors, not more pull requests. Thank you." },
  ],
  View: SlopView,
};

// ── Fix: the proof, on one screen ───────────────────────────────────────────

// Bug, fix, and the regression test failing without the fix and passing with it, all from the
// real run against Pydantic's pydantic/alias_generators.py and its alias-generator tests
// (pytest output copied as printed; test file shortened to tests/test_utils.py).
const BUG_AT = 600, FIX_AT = 2200, VERIFY_AT = 3800, PASS_AT = 5800;
const TICK_AT = PASS_AT + 1400;
const PROOF_DONE_AT = 8000;
const WITHOUT = [
  "FAILED tests/test_utils.py::test_to_pascal_repeated_underscores[my__field-MyField]",
  "    assert 'My__Field' == 'MyField'",
  "FAILED tests/test_utils.py::test_to_pascal_repeated_underscores[user___id-UserId]",
  "2 failed, 43 passed",
];

function ProofRow({ at, label, tone, children, spot }: { at: number; label: string; tone?: "alert" | "ok"; children: ReactNode; spot?: string }) {
  return (
    <Reveal at={at} spot={spot} className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 border-b border-border-soft px-4 py-2.5 last:border-b-0">
      <p className={cn("pt-0.5 text-[14px] font-medium", tone === "alert" ? "text-alert" : tone === "ok" ? "text-ok" : "text-paper")}>{label}</p>
      <div className="min-w-0 font-mono text-[13px] leading-[1.55] text-paper [font-variant-ligatures:none]">{children}</div>
    </Reveal>
  );
}

function VerifiedView() {
  const t = useT();
  const verified = t >= PROOF_DONE_AT;
  return (
    <AppWindow path="/dispatches" section="Fix" tab="Runs">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-border-soft bg-surface px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[13px] text-info">{ISSUE_TAG}</span> · tests run in a locked box: no keys, only package registries and GitHub</p>
            <p className="mt-0.5 truncate text-[18px] font-medium text-paper">{STORY_ISSUE.title}</p>
          </div>
          {verified ? <span className="stage-settle"><StatusChip tone="ok">verified</StatusChip></span> : <StatusChip tone="signal">testing</StatusChip>}
        </div>
        <div className="relative rounded-2xl border border-border-soft bg-surface">
          <ProofRow at={BUG_AT} label="The bug" spot="bug">
            <p>to_pascal(&apos;my__field&apos;) <span className="text-paper-muted">returns</span> <span className="text-alert">&apos;My__Field&apos;</span> <span className="text-paper-muted">· expected</span> <span className="text-ok">&apos;MyField&apos;</span></p>
          </ProofRow>
          <ProofRow at={FIX_AT} label="The fix" spot="change">
            <p className="text-paper-muted">{STORY_DIFF.file}</p>
            <p className="whitespace-pre-wrap break-all bg-alert/10 px-1 text-alert">- {STORY_DIFF.removed.trim()}</p>
            <p className="whitespace-pre-wrap break-all bg-ok/10 px-1 text-ok">+ {STORY_DIFF.added.trim()}</p>
            <p className="mt-1 text-paper-muted">repeated underscores between letters collapse first; &apos;__private&apos; still gives &apos;__Private&apos;</p>
          </ProofRow>
          <ProofRow at={VERIFY_AT} label="Without the fix" tone="alert" spot="verify">
            {WITHOUT.map((l) => <p key={l} className={cn("whitespace-pre-wrap break-all", l.startsWith("FAILED") || l.includes("failed") ? "text-alert" : "text-paper-dim")}>{l}</p>)}
          </ProofRow>
          <ProofRow at={PASS_AT} label="With the fix" tone="ok" spot="verify">
            <p className="text-ok">45 passed <span className="text-paper-muted">· Pydantic&apos;s 42 alias-generator tests + the 3 new cases</span></p>
          </ProofRow>
          {t >= TICK_AT && <Doodle doodle={check} draw="load" duration={800} className="absolute bottom-2 right-5 h-[52px] w-[66px] text-signal" />}
        </div>
      </div>
    </AppWindow>
  );
}

export const stageVerified: Chapter = {
  id: "verified",
  act: "Fix",
  label: "Tests, verified",
  title: "The bug, the fix, the proof",
  duration: PROOF_DONE_AT + 2500,
  source: "The run's verification: real results on Pydantic's alias-generator tests",
  headlines: [{ at: 0, text: "The bug, the fix, and the proof. Judge it yourself." }],
  captions: [
    { at: 0, spot: "bug", text: "This is the part maintainers care about. Here's the bug: to_pascal turns my__field into My__Field." },
    { at: FIX_AT, spot: "change", text: "Here's the change itself: one line in to_pascal." },
    { at: VERIFY_AT, spot: "verify", text: "In a locked box with no keys, it undoes the fix and runs Pydantic's own tests: the new test fails, on exactly the bug. With the fix, all 45 pass. So it really catches the bug." },
    { at: VERIFY_AT + 2600, spot: "verify", text: `For maintainers who ask: ${STORY_TEST_COMMAND}; exit 1 without the fix (2 failed, 43 passed), exit 0 with it (45 passed). With no runnable test it says unverified, and CI on the pull request is still the project's own.` },
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
    <div className="flex h-full flex-col justify-center bg-ink py-6">
      <div className="relative rounded-[22px] border border-border bg-surface">
        <p className="border-b border-border-soft px-6 py-4 text-[16px] font-semibold text-paper">Pull requests <span className="ml-2 font-normal text-paper-muted">214 open</span></p>
        <ul className="divide-y divide-border-soft">
          {SLOP_PRS.map((pr, i) => (
            <Reveal as="li" key={pr.title} at={400 + i * 700} className="flex items-center justify-between gap-6 px-6 py-4">
              <div className="min-w-0">
                <p className="truncate text-[22px] font-medium text-paper">{pr.title}</p>
                <p className="mt-1 text-[16px] text-alert">{pr.flags.join(" · ")}</p>
              </div>
              <span className="shrink-0 text-right font-mono text-[18px] text-paper-muted">{pr.size}</span>
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
  provenance: [{ at: 0, text: "Illustration" }],
  poster: true,
  headlines: [{ at: 0, text: "Maintainers are drowning in AI pull requests nobody understood.", mark: "nobody understood" }],
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
    <div className="flex h-full flex-col justify-center bg-ink">
      <p className="kicker text-[16px] text-paper-muted">A contribution a maintainer would actually want</p>
      <div className="mt-4 divide-y divide-border">
        {PILLARS.map(([title, text], i) => (
          <Reveal key={title} at={150 + i * 600} className="grid grid-cols-[minmax(0,1fr)_360px] items-end gap-10 py-5">
            <p className="display text-[80px] leading-none tracking-[-0.025em] text-paper">{title}{i === PILLARS.length - 1 ? <span className="text-signal">.</span> : "."}</p>
            <p className="pb-[0.55em] text-[19px] leading-snug text-paper-dim">{text}</p>
          </Reveal>
        ))}
      </div>
      <Reveal at={150 + PILLARS.length * 600 + 300} className="mt-6">
        <p className="text-[19px] text-paper-muted">Every run stops for your review. Nothing posts until you confirm.</p>
      </Reveal>
    </div>
  );
}

export const stagePromise: Chapter = {
  id: "promise",
  act: "Start",
  label: "The promise",
  title: "Contributions a maintainer would want",
  duration: 150 + PILLARS.length * 600 + 2150,
  source: "What opensrcer is for",
  poster: true,
  captions: [
    { at: 0, text: "opensrcer helps a beginner make the contribution a maintainer would actually want: tested, explained, and following the project's rules." },
    { at: 150 + PILLARS.length * 600, text: "Everything from here is the real product, on one Pydantic issue from start to finish. Nothing posts until you confirm." },
  ],
  View: PromiseView,
};

// ── It reads the rules first ─────────────────────────────────────────────────

// The run, in plain words: Pydantic's contributing guide (its AI policy) and PR template, then the cause.
const RULES_FEED: Array<{ at: number; text: string; rules?: true; points?: string[] }> = [
  { at: 600, text: "Started a throwaway machine with a spend cap and a time limit." },
  { at: 2200, text: "Read Pydantic's contributing guide and pull request template.", rules: true },
  { at: 3800, text: "It follows what they ask for:", rules: true, points: ["AI help is welcome if you fully understand the code", "unit tests for the change", "the PR template's checklist"] },
  { at: 6600, text: "Read to_pascal, to_camel and their tests, and found what else calls to_pascal." },
  { at: 8600, text: "Found the cause: to_pascal only removes an underscore with a letter or digit on both sides, so a double underscore survives." },
];
const RULES_DONE_AT = 8600;

function RulesView() {
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="rounded-2xl border border-border bg-surface px-5 py-3">
          <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[13px] text-info">{ISSUE_TAG}</span></p>
          <p className="mt-0.5 truncate text-[18px] font-medium text-paper">{STORY_ISSUE.title}</p>
        </div>
        <ol className="border-t border-border-soft">
          <RulesStep {...RULES_FEED[0]} />
          <li data-spot="rules">
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
    <Reveal at={at} className="flex items-start gap-3 border-b border-border-soft py-3 text-[17px] leading-snug text-paper">
      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-border-strong" />
      <span>
        {text}
        {points && <span className="mt-1 block text-[15px] text-paper-dim">{points.join(" · ")}</span>}
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
  source: "The run, in plain words",
  headlines: [{ at: 0, text: "It reads the project's rules first." }],
  captions: [
    { at: 0, text: "Now fix it. One click starts the run on the to_pascal issue, on your own Anthropic API key (about ten cents for a fix like this), in a throwaway machine with a spend cap." },
    { at: 2200, spot: "rules", text: "It reads the project's rules first: contribution guide, PR template, AI policy, sign-off. Pydantic welcomes AI help if you fully understand the code, and asks for tests and its PR checklist, so that's what it does." },
    { at: 6600, text: "Then it reads the code around the bug and writes down the cause before the fix. If it can't find the root cause, it says so rather than guess." },
  ],
  View: RulesView,
};
// ── Review: the change explained, the rules, the chat, your own words ───────

// What the review screen's AI calls return for this change, in the product's shapes:
// the change chat teaches and ends with a "Check yourself" question.
const CHAT_QUESTION = "Explain this fix like I'm new to the project";
const CHAT_ANSWER = `This fix makes to_pascal clean up double underscores.

It title-cases the name, then removes an underscore only when a letter or digit sits on both sides. In my__field each underscore has another underscore beside it, so both survived: My__Field.

Now it first squeezes repeated underscores between letters into one, so you get MyField, while __private keeps its leading underscores.

Check yourself: why does the pattern need a letter or digit on both sides?`;

// The own-words check and the practice review, as the product's real checker answered them
// (lib/understanding.ts handleUnderstand on this diff and its test results, 2026-10-26): a first
// explanation that misreads the fix is caught, then the rewrite passes. Replies trimmed with "…".
const ATTEMPTS = [
  {
    text: "The fix strips every underscore out of the name before title-casing it, so my__field now becomes MyField instead of My__Field.",
    rootCause: true, change: false, evidence: false, passed: false,
    mistake: "The fix does not strip every underscore out; it only collapses repeated underscores between alphanumeric characters into a single underscore.",
    tip: "The explanation should say that repeated underscores between letters/digits are collapsed to a single underscore (not removed entirely), and that leading/trailing underscores are preserved.",
  },
  {
    text: "to_pascal left double underscores in names, so my__field became My__Field. Now it collapses repeated underscores between letters before title-casing, and leading ones like __private stay. The new test fails without the fix and passes with it.",
    rootCause: true, change: true, evidence: true, passed: true, mistake: null,
    tip: "Great explanation! You clearly identified the bug, the fix, and verified it with tests.",
  },
];
const PRACTICE = {
  q: "Does this change what to_camel returns?",
  answers: [
    { a: "No, the change is only in to_pascal.", feedback: "The answer is incorrect. The change to `to_pascal` will also affect `to_camel`, since `to_camel` calls `to_pascal` internally …", followUp: "… would test cases like `to_camel('my__field')` now return `'myField'` instead of `'my__Field'`?" },
    { a: "Yes. to_camel calls to_pascal, so my__field now gives myField. Same fix.", feedback: "The answer correctly identifies that to_camel will be affected since it calls to_pascal. …", followUp: null },
  ],
};

// When each section is on screen (one at a time, as a presenter walks the real page).
const R = {
  chat: 6500, own: 15500, practice: 37500,
  chatPress: 7800, answerAt: 9000,
  type: [16500, 26500], check: [20300, 33200], results: [21000, 33900],
  confirm: 50500, publishAt: 52000,
};
const PUBLISHED_AT = R.publishAt + 500;
const PRACTICE_TIMES = [{ type: 38800, send: 40500, fb: 41100 }, { type: 44500, send: 46800, fb: 47400 }];

function Section({ title, children, spot }: { title: string; children: ReactNode; spot?: string }) {
  return (
    <div data-spot={spot} className="animate-fade-rise rounded-xl border border-border-soft bg-ink px-4 py-2.5 text-[15px] motion-reduce:animate-none">
      <p className="text-[15px] font-medium text-paper">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** The own-words results, worded as components/own-words.tsx words them. */
function CheckResult({ a, at }: { a: (typeof ATTEMPTS)[number]; at: number }) {
  const line = (ok: boolean, what: string, optional = false) => <p className={ok ? "text-ok" : optional ? "text-paper-muted" : "text-alert"}>{what}: {ok ? "covered" : optional ? "not mentioned (optional)" : "missing"}</p>;
  return (
    <div className="mt-2 space-y-0 text-[13px] leading-[1.45]">
      <Reveal at={at}>{line(a.rootCause, "What was wrong")}</Reveal>
      <Reveal at={at + 250}>{line(a.change, "What the change did")}</Reveal>
      <Reveal at={at + 500}>{line(a.evidence, "How you know it works", true)}</Reveal>
      {a.mistake && <Reveal at={at + 750}><p className="text-alert">That&apos;s not quite it: {a.mistake}</p></Reveal>}
      <Reveal at={at + 1000}><p className="text-paper-dim">Tip: {a.tip}</p></Reveal>
      <Reveal at={at + 1250}><p className={cn("font-semibold", a.passed ? "text-ok" : "text-paper")}>{a.passed ? "Your explanation covers the change." : "Not there yet: fix what's above, then check again."}</p></Reveal>
    </div>
  );
}

function StageReviewView() {
  const t = useT();
  const section = t < R.chat ? "found" : t < R.own ? "chat" : t < R.practice ? "own" : "practice";
  const attempt = t >= R.type[1] ? 1 : 0;
  const draft = ATTEMPTS[attempt].text;
  const typed = draft.slice(0, Math.max(0, Math.min(draft.length, Math.floor(((t - R.type[attempt]) / 1000) * 40))));
  const checked = t >= R.results[attempt];
  const answer = t >= PRACTICE_TIMES[1].type ? 1 : 0;
  const pt = PRACTICE_TIMES[answer];
  const checksLeft = 5 - (t >= R.check[1] ? 2 : t >= R.check[0] ? 1 : 0);
  // If a section is still taller than the window, the body follows it down, like the chat panel.
  // The own-words step fits its panel; following it down would clip its title as the results appear.
  const bodyRef = useFollow(section === "own" ? -1 : Math.floor(t / 250));
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="absolute inset-0 bg-ink p-3">
        <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="border-b border-border px-4 py-2.5">
            <p className="truncate text-[15px] font-medium text-paper">{RUN.prTitle}</p>
            <p className="text-[13px] text-paper-muted">{PATCH_STATS.files} files changed · <span className="text-ok">+{PATCH_STATS.additions}</span> · <span className="text-alert">-{PATCH_STATS.deletions}</span> · <span className="text-ok">verified</span></p>
          </div>
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden px-4 py-3">
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
            {section === "chat" && (
              <Section title="Ask about this change">
                <p className="text-paper-muted">Not sure what the change does or why? Ask about it here.</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
                  <Press at={R.chatPress} label={CHAT_QUESTION} className="text-paper underline decoration-border-strong underline-offset-4">→ {CHAT_QUESTION}</Press>
                  {["What could this break?", "How do I explain this to a reviewer?"].map((q) => <span key={q} className="text-paper-dim">→ {q}</span>)}
                </div>
                {t >= R.chatPress + 400 && <p className="mt-2.5 text-paper"><span className="font-medium text-signal">You:</span> {CHAT_QUESTION}</p>}
                {t >= R.answerAt && (
                  <div data-spot="chat-answer" className="mt-1.5 rounded-lg border border-border-soft bg-surface px-3 py-2">
                    <p className="text-[13px] text-info">AI answer (not verified)</p>
                    <p className="mt-1 whitespace-pre-line text-[14px] leading-6 text-paper"><Typed text={CHAT_ANSWER} at={R.answerAt} cps={80} /></p>
                  </div>
                )}
              </Section>
            )}
            {section === "own" && (
              <Section title="Explain it in your own words" spot="own-words">
                {!checked && <p className="text-paper-muted">Maintainers want to know the person sending a change understands it. Say what was wrong, what the change did, and how you know it works.</p>}
                <p className="mt-1 min-h-[52px] rounded-lg border border-border bg-surface px-3 py-2 text-[14px] leading-6 text-paper">{typed}&nbsp;</p>
                <div className="mt-2 flex items-center gap-3">
                  <Press at={R.check[0]} label="Check my explanation" className={cn("rounded-[10px] border border-border px-3 py-1 font-medium text-paper", attempt === 1 && "hidden")}>Check my explanation</Press>
                  <Press at={R.check[1]} label="Check my explanation" className={cn("rounded-[10px] border border-border px-3 py-1 font-medium text-paper", attempt === 0 && "hidden")}>Check my explanation</Press>
                  <span key={checksLeft} className="stage-tick font-mono text-[12px] text-paper-muted">{checksLeft} checks left</span>
                </div>
                {checked && <CheckResult key={attempt} a={ATTEMPTS[attempt]} at={R.results[attempt]} />}
              </Section>
            )}
            {section === "practice" && (
              <Section title="Practice review" spot="practice">
                <p className="text-paper-muted">{PRACTICE_INTRO}</p>
                <p className="mt-2 text-paper"><span className="font-medium">Reviewer:</span> {PRACTICE.q}</p>
                <p className="mt-1 min-h-[30px] rounded-lg border border-border bg-surface px-3 py-1.5 text-[13.5px] text-paper"><Typed key={answer} text={PRACTICE.answers[answer].a} at={pt.type} cps={45} />&nbsp;</p>
                <div className="mt-1 flex items-center gap-3 text-[13px]">
                  <Press at={PRACTICE_TIMES[0].send} label="Send answer" className={cn("rounded-[10px] border border-border px-3 py-0.5 text-paper", answer === 1 && "hidden")}>Send answer</Press>
                  <Press at={PRACTICE_TIMES[1].send} label="Send again" className={cn("rounded-[10px] border border-border px-3 py-0.5 text-paper", answer === 0 && "hidden")}>Send again</Press>
                </div>
                {t >= pt.fb && (
                  <Reveal key={answer} at={pt.fb} spot="practice-feedback">
                    <p className="mt-1.5 text-paper-dim"><span className="font-medium text-paper">Feedback:</span> <Inline text={PRACTICE.answers[answer].feedback} /></p>
                    {PRACTICE.answers[answer].followUp && <p className="mt-0.5 text-paper-muted">A reviewer might follow up: <Inline text={PRACTICE.answers[answer].followUp} /></p>}
                  </Reveal>
                )}
              </Section>
            )}
          </div>
          <div className="min-h-[64px] border-t border-border px-4 py-2 text-[14px]">
            <div className="flex flex-wrap items-center gap-2">
              <Press at={R.confirm} label="I've read this change" className="flex items-center gap-1.5 text-paper">
                <span aria-hidden className={cn("grid h-4 w-4 place-items-center rounded-[3px] border text-[10px]", t >= R.confirm ? "border-ok bg-ok/15 text-ok" : "border-border")}>{t >= R.confirm ? "✓" : ""}</span>
                I&apos;ve read this change and can explain it to reviewers.
              </Press>
              <span className="relative ml-auto">
                <Press at={R.publishAt} label="Publish draft PR" className={cn("rounded-[10px] px-3 py-1 font-medium", t >= R.confirm ? "bg-paper text-ink" : "bg-paper/35 text-ink")}>
                  {t >= R.publishAt ? `Draft PR #${RUN.pr} opened` : "Publish draft PR"}
                </Press>
              </span>
            </div>
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
  title: "Explain it, then publish",
  duration: PUBLISHED_AT + 2500,
  holds: [R.chat, R.own, R.practice],
  source: "The review screen for the run; the own-words and practice replies are the real checker's",
  headlines: [
    { at: 0, text: "It explains every change in plain English." },
    { at: R.chat, text: "It teaches you the change…" },
    { at: R.own, text: "Then it checks you learned it, in your own words." },
    { at: R.results[0], text: "You can't publish what you can't explain.", mark: "can't explain" },
    { at: R.type[1], text: "So you rewrite it, properly." },
    { at: R.results[1], text: "Now it passes, in your own words." },
    { at: R.practice, text: "Then a practice review, before the real one." },
    { at: R.publishAt, text: "A human publishes. Nothing is hidden." },
  ],
  captions: [
    { at: 0, spot: "review-found", text: "It explains every change: what was wrong and what changed, in plain words, and what to double-check." },
    { at: R.chat, spot: "chat-answer", text: "Not sure what it does? Ask, in plain English. Answers are labeled not verified, so you check them against the code." },
    { at: R.own, spot: "own-words", text: "Before you can publish, you explain it in your own words. Here the first try gets it wrong: it says every underscore is stripped." },
    { at: R.results[0], spot: "own-words", text: "The check catches it: what the change did is missing, and it says exactly what's not right. Not there yet." },
    { at: R.type[1], spot: "own-words", text: "So you rewrite it, properly this time, and say how you know it works." },
    { at: R.results[1], spot: "own-words", text: "Now it passes. It goes into the pull request under “In the author's words”, so the maintainer reads your explanation, not the AI's." },
    { at: R.practice, spot: "practice", text: "Then a practice question, the kind a maintainer would ask. A half answer gets feedback and a follow-up; the corrected one passes." },
    { at: R.confirm, text: "Then you confirm you understand it, and publish." },
    { at: R.publishAt, text: "It's scanned for leaked secrets and opened, as a draft, in your name." },
  ],
  View: StageReviewView,
};

// ── The title slide (before the first step) ─────────────────────────────────

/** The title: the wordmark, who it's for, the promise in two plain lines, and the code map
 *  (mapping code is what opensrcer does), whose one lit path ends in the wordmark's ring. */
export function StageTitle() {
  return (
    <div className="relative flex h-full flex-col justify-end bg-ink pb-10">
      <Wordmark draw className="absolute left-0 top-6 text-[40px] text-paper" />
      <p className="absolute right-0 top-9 font-mono text-[14px] tracking-[0.02em] text-paper-faint">Demo · opensrced.vercel.app</p>
      <p className="text-[20px] text-paper-muted">Your first open-source contribution, guided.</p>
      <p className="display mt-4 text-[104px] leading-[0.98] tracking-[-0.025em] text-paper">
        <span className="rise block">Issues in.</span>
        <span className="rise block" style={{ "--delay": "120ms" } as React.CSSProperties}>
          Pull requests{" "}
          <span className="relative inline-block text-signal">
            out.
            {/* The code map's lit path arrives here and rings the word. */}
            <Doodle doodle={circle} draw="load" delay={1700} duration={700} stretch className="absolute -left-[0.1em] -top-[0.02em] h-[calc(100%+0.06em)] w-[calc(100%+0.2em)] text-signal" />
            <CodeMap variant="title" className="absolute w-[280px]" style={{ left: "calc(100% - 31px)", top: -153 }} />
          </span>
        </span>
      </p>
    </div>
  );
}

// ── The code map: the posters' motif ────────────────────────────────────────

// A small code graph in the product's own language: a handful of nodes, hairline calls, and one
// path lit in cobalt, drawn from the far side toward the thing it annotates. Decorative.
// Each variant's lit path ends at its first node, which the caller places on that thing: on the
// title (end bottom-left) the ring around "out."; on the close (end top-left) the wordmark's "o".
const MAPS = {
  title: {
    nodes: [[40, 196, 6], [112, 122, 7], [176, 206, 5], [236, 92, 6], [300, 176, 7], [204, 34, 5], [326, 54, 5]],
    edges: [[0, 1], [1, 2], [1, 3], [3, 5], [3, 4], [4, 6], [2, 4], [5, 6]],
    path: [4, 3, 1, 0],
  },
  close: {
    nodes: [[20, 20, 6], [80, 100, 7], [40, 190, 5], [190, 130, 6], [300, 200, 7], [180, 222, 5], [314, 92, 5]],
    edges: [[0, 1], [1, 2], [1, 3], [3, 5], [3, 4], [4, 6], [2, 5], [6, 3]],
    path: [4, 3, 1, 0],
  },
} as const;
const MAP_VIEW = { w: 360, h: 240 };

function CodeMap({ variant, className, style }: { variant: keyof typeof MAPS; className?: string; style?: React.CSSProperties }) {
  const { nodes, edges, path } = MAPS[variant];
  const points = path.map((i) => `${nodes[i][0]},${nodes[i][1]}`).join(" ");
  return (
    <svg aria-hidden viewBox={`0 0 ${MAP_VIEW.w} ${MAP_VIEW.h}`} className={cn("block overflow-visible", className)} style={style} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <g stroke="var(--color-border)" strokeWidth="1">
        {edges.map(([a, b], i) => <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} />)}
      </g>
      {nodes.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={i === path[path.length - 1] ? 0 : r} fill="var(--color-border-strong)" className="stage-node" style={{ "--d": `${80 + i * 60}ms` } as React.CSSProperties} />)}
      <polyline points={points} stroke="var(--color-signal)" strokeWidth="2.5" pathLength={1} className="stage-draw" style={{ "--d": "500ms", animationDuration: "1.2s" } as React.CSSProperties} />
    </svg>
  );
}
