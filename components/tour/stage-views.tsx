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
import { AppWindow, Press, Reveal, SCOPE_LABEL, TimeContext, Typed, progress, useFollow, useT, type Caption, type Chapter } from "./kit";
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
const skipAt = (i: number) => SHOW_ALL_AT + 600 + i * SKIP_STEP;
const SHOW_READY_AT = skipAt(SKIPPED.length) + 2500; // …and back to Ready once every verdict has been seen

function ScanView() {
  const t = useT();
  const all = t >= SHOW_ALL_AT && t < SHOW_READY_AT;
  const rows = all ? SCAN : READY;
  let skipped = 0;
  // All nine rows don't fit: the page scrolls gently to each skipped issue as it arrives.
  const followRef = useFollow(Math.floor(t / 250));
  return (
    <AppWindow path={`/issues?repo=${SCAN_REPO}`} section="Find" tab="Issues">
      <div ref={followRef} className="h-full overflow-hidden scroll-smooth px-4 py-3 sm:px-6">
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
          <div data-spot="scan-list" className="divide-y divide-border-soft">
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
                  {turn.cost && <span className="ml-auto font-mono text-[13px] text-paper-muted">{turn.cost}</span>}
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
          {built && <span className="text-[13px] text-ok">● ready · parsed, no AI</span>}
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
    pr: { ...withProvenance(staged(base.pr, [{ at: 0, text: "The maintainer always knows AI helped." }], [
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
  ["Closes", `${ISSUE_TAG} (“fixes ${ISSUE_TAG}” in the description)`],
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
      <div className="flex h-full justify-center px-6 pb-6 pt-[6%]">
        <div className="w-full max-w-[820px]">
        <Reveal at={MAINT_AT + 600} spot="maint" className="rounded-2xl border border-border bg-surface px-6 py-5">
          <p className="text-[19px] font-medium text-paper">Review before publishing</p>
          <p role="alert" className="mt-3 rounded-lg border border-alert/30 bg-alert/5 px-4 py-3 text-[19px] leading-relaxed text-alert">
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
            <p className="text-[13px] text-paper-muted">{BAN_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[13px] text-info">#412</span></p>
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
  holds: [MAINT_AT],
  source: "Example: a fictional project whose guide bans AI; then a real issue, names hidden",
  headlines: [{ at: 0, text: "And when the rules say no, it stops." }, { at: MAINT_AT, text: "It listens to maintainers, even in the comments." }],
  provenance: [{ at: 0, text: "Example project" }, { at: MAINT_AT, text: "Real issue · names hidden" }],
  captions: [
    { at: 0, spot: "refusal", text: "Not every project wants AI help, and it respects that. On a project whose guide bans AI-written pull requests, publishing is refused, quoting the guide, with no Publish button. Same when someone else already has a pull request open." },
    { at: MAINT_AT, spot: "maint", text: "And it listens to maintainers in the issue itself. On a real project, a maintainer asked for a human-written pull request, so opensrcer refused to publish. Name and quote hidden; the preview still helps you write the fix yourself." },
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
      <div className="mt-8 flex items-baseline gap-8 border-t border-border pt-4 font-mono text-[15px] text-paper-dim">
        <span>opensrced.vercel.app</span>
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
    { at: 0, text: "Now fix it. One click starts the run on the to_pascal issue, on the Claude plan you already pay for, in a throwaway machine with a spend cap." },
    { at: 2200, spot: "rules", text: "It reads the project's rules first: contribution guide, PR template, AI policy, sign-off. Pydantic welcomes AI help if you fully understand the code, and asks for tests and its PR checklist, so that's what it does." },
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
            <p className="truncate text-[13px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[13px] text-info">{ISSUE_TAG}</span></p>
            <p className="mt-0.5 truncate text-[18px] font-medium text-paper">{STORY_ISSUE.title}</p>
          </div>
          <Press at={SIGN_IN_PRESS_AT} className="shrink-0 rounded-[10px] bg-paper px-4 py-1.5 text-[14px] font-medium text-ink">Sign in with Claude &amp; start</Press>
        </div>
        {t >= SIGN_IN_PRESS_AT && t < SIGN_IN_PANEL_AT && <p className="text-[15px] text-paper-muted">Starting your run… Claude&apos;s sign-in page opens here in a moment.</p>}
        <Reveal at={SIGN_IN_PANEL_AT} spot="sign-in" className="rounded-2xl border border-signal/30 bg-surface p-5">
          <p className="text-[18px] font-medium text-signal">Sign in to Claude to start this run</p>
          <p className="mt-1.5 text-[16px] leading-snug text-paper-dim">This run uses your own Claude subscription. Sign in on Claude&apos;s page, then paste the code it shows you here.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
            <span className="rounded-full border border-signal/40 px-3.5 py-1.5 text-signal">Open Claude sign-in ↗</span>
            <span className="min-w-[220px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-paper-faint">{t >= SIGN_IN_SENT_AT ? "••••••••" : "Paste code"}</span>
            <span className="rounded-[10px] bg-paper px-3.5 py-1.5 font-medium text-ink">Send code</span>
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
    holds: [SIGN_IN_LENGTH, ...(chapter.holds ?? []).map((at) => at + SIGN_IN_LENGTH)],
    headlines: [{ at: 0, text: "No API bill: it runs on the Claude plan you already pay for." }, ...(chapter.headlines ?? []).map(later)],
    // The sign-in note ends with the sign-in step, even when the run itself carries none.
    provenance: [{ at: 0, text: "The sign-in step, as the site shows it" }, ...(chapter.provenance ?? [{ at: 0, text: "" }]).map(later)],
    captions: [
      { at: 0, text: "Now fix it. One click starts the run on the to_pascal issue. It runs on the Claude plan you already pay for, so there's no API bill." },
      { at: SIGN_IN_PANEL_AT, spot: "sign-in", text: "You sign in on Claude's own page, inside the run's machine; opensrcer never sees your login. Hit your plan's limit? The run stops. It switches to an API key only if you've turned that on." },
      ...chapter.captions.map(later),
    ],
    View,
  };
}

// ── Review: the change explained, the rules, the chat, your own words ───────

// What the review screen's AI calls return for this change, in the product's shapes:
// the change chat teaches and ends with a "Check yourself" question.
const CHAT_QUESTION = "Explain this fix like I'm new to the project";
const CHAT_ANSWER = "This fix makes to_pascal clean up double underscores. … It title-cases the name, then removes an underscore only when a letter or digit sits on both sides. In my__field each underscore has another underscore beside it, so both survived: My__Field. … Now it first squeezes repeated underscores between letters into one, so you get MyField, while __private keeps its leading underscores. … Check yourself: why does the pattern need a letter or digit on both sides?";

// The own-words check and the practice review, as the product's real checker answered them
// (lib/understanding.ts handleUnderstand on this diff and its test results, 2026-10-26): a first
// explanation that misreads the fix is caught, then the rewrite passes. Replies trimmed with "…".
const ATTEMPTS = [
  {
    text: "The fix strips every underscore out of the name before title-casing it, so my__field now becomes MyField instead of My__Field.",
    rootCause: true, change: false, evidence: false, passed: false,
    mistake: "The fix does not strip every underscore out; it only collapses repeated underscores between alphanumeric characters into a single underscore.",
    tip: "The explanation should say that repeated underscores between letters/digits are collapsed to a single underscore (not removed entirely) …",
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
    { a: "No, the change is only in to_pascal.", feedback: "The answer is incomplete. … since `to_camel` typically calls `to_pascal` internally, it would also return different values.", followUp: "Does `to_camel` call `to_pascal` internally, or is it implemented separately?" },
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
    <div className="mt-2 space-y-0.5 text-[14px]">
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
                    <p className="mt-1 text-[14px] leading-6 text-paper"><Typed text={CHAT_ANSWER} at={R.answerAt} cps={80} /></p>
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
                    <p className="mt-1.5 text-paper-dim"><span className="font-medium text-paper">Feedback:</span> {PRACTICE.answers[answer].feedback}</p>
                    {PRACTICE.answers[answer].followUp && <p className="mt-0.5 text-paper-muted">A reviewer might follow up: {PRACTICE.answers[answer].followUp}</p>}
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
                  {t >= R.publishAt ? `Draft PR #${RUN.pr} opened ↗` : "Publish draft PR"}
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
    { at: R.results[0], text: "It catches what you got wrong.", mark: "got wrong" },
    { at: R.results[1], text: "You can't publish what you can't explain." },
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
