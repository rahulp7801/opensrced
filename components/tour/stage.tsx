"use client";

// The stage demo: the product in four phases, for a presenter to click through
// and talk over. Nothing on screen but the app; the words are speaker notes in a
// second window (StageNotes, /demo/stage/notes), kept in step over a
// BroadcastChannel so the notes can sit on the laptop while the stage is projected.
//
// It plays the tour's own chapters (components/tour/chapters-*.tsx) with the same
// clock model: every scripted click is a stop that waits for the presenter, the
// animation between stops plays by itself, and each chapter's last frame holds
// until the presenter moves on.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowRight, CaretLeft, CaretRight, CornersOut } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { InteractContext, TimeContext, type Caption, type Chapter, type Interact } from "./kit";
import { Doodle } from "@/components/brand/doodles";
import { underline } from "@/components/brand/doodle-data";
import { Sticker } from "@/components/brand/sticker";
import { ArrowGlyph } from "@/components/brand/pill";
import { pacedBy } from "./chapters";
import { preloadRepoSnapshot } from "./repo-map";
import { pr } from "./chapters-fix";
import { StageTitle, stageExplore, stageNotes, stageProblem, stagePromise, stageRefused, stageReview, stageRules, stageScan, stageSlop, stageVerified, withPrFacts, withSignInStart } from "./stage-views";

/** How much slower than written the stage plays its animations. The presenter
 *  sets the pace between steps; this only stretches what plays by itself. */
export const STAGE_PACE = 1.15;

/** `by`: when the presenter should reach this phase, for about 8:30 spoken (shown in the notes). */
type Phase = { name: string; by: string; say: string; chapters: Chapter[] };

// The tour's screens with the stage's speaker notes (and its versions of the review screens).
const S = stageNotes({ pr });

/** Clicks the tour's screens make that the stage makes by itself, to keep the talk to ~10 minutes. */
const SKIP = new Set(["Copy diff", "Commit msg", "Ready (3)", "Build graph", "Review patch", "Sign in with Claude & start", "Explain this fix like I'm new to the project", "Send answer"]);

/** The four phases, and the one line each one is about (shown in the notes). */
const PHASES: Phase[] = [
  { name: "Why", by: "0:00", say: "The problem every maintainer here knows, and the promise: contributions a maintainer would actually want.", chapters: [stageProblem, stagePromise] },
  { name: "Find", by: "1:05", say: "Pick an issue that's open to you, and understand the code before touching it.", chapters: [stageScan, stageExplore] },
  { name: "Prove", by: "2:50", say: "It follows the project's rules, stops when they say no, and proves the fix with the project's own tests.", chapters: [withSignInStart(stageRules), stageRefused, stageVerified] },
  { name: "Ship", by: "5:40", say: "It explains every change, you confirm you understand it, a human publishes, and nothing is hidden.", chapters: [stageReview, withPrFacts(S.pr), stageSlop] },
];

const STEPS = PHASES.flatMap((phase, p) => phase.chapters.map((c) => ({ phase: p, chapter: pacedBy(c, STAGE_PACE) })));
const STARTS = STEPS.reduce<number[]>((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + STEPS[i - 1].chapter.duration], []);
const TOTAL = STARTS[STARTS.length - 1] + STEPS[STEPS.length - 1].chapter.duration;
const PHASE_STARTS = PHASES.map((_p, i) => STARTS[STEPS.findIndex((s) => s.phase === i)]);

const DESIGN = { width: 1180, height: 620 };
const TICK_MS = 50;
const CHANNEL = "opensrcer-stage";

function stepAt(t: number): number {
  let i = 0;
  while (i + 1 < STARTS.length && t >= STARTS[i + 1]) i++;
  return i;
}

type Waiting = { kind: "press"; at: number; label: string } | { kind: "next" };
/** What the stage tells the notes window. */
export type StageState = { step: number; local: number; waiting: Waiting | null; playing: boolean; started: boolean; ended: boolean; startedAt: number | null };
type StageCommand = { type: "cmd"; cmd: "next" | "back" | "phase" | "hello"; phase?: number };

export function StageDemo() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaitingState] = useState<Waiting | null>(null);
  const [started, setStarted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  // The Explore stop maps a large repository; fetch its snapshot while the talk opens.
  useEffect(() => { preloadRepoSnapshot().catch(() => {}); }, []);
  const tRef = useRef(0);
  const waitingRef = useRef<Waiting | null>(null);
  const playingRef = useRef(false);
  const hurry = useRef(false); // fast-forward to the next stop
  const done = useRef(new Set<string>()); // clicks already made, as "step:at"
  const history = useRef<Array<{ t: number; kind: Waiting["kind"] }>>([]); // stops passed, for Back
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const index = stepAt(t);
  const step = STEPS[index];
  const local = t - STARTS[index];
  const ended = t >= TOTAL;

  const setWaiting = useCallback((w: Waiting | null) => {
    waitingRef.current = w;
    setWaitingState(w);
  }, []);
  const play = useCallback((on: boolean) => {
    playingRef.current = on;
    setPlaying(on);
  }, []);
  const seek = useCallback((next: number) => {
    const clamped = Math.min(TOTAL, Math.max(0, next));
    tRef.current = clamped;
    setT(clamped);
  }, []);

  // The clock: real time, sped up while the presenter fast-forwards.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      let next = Math.min(TOTAL, tRef.current + (now - last) * (hurry.current ? 6 : 1));
      last = now;
      if (waitingRef.current) return;
      const i = stepAt(tRef.current);
      if (i + 1 < STEPS.length && next >= STARTS[i + 1] - 1) {
        // Each chapter's last frame holds until the presenter moves on.
        next = STARTS[i + 1] - 1;
        hurry.current = false;
        setWaiting({ kind: "next" });
        play(false);
      }
      tRef.current = next;
      setT(next);
      if (next >= TOTAL) play(false);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, play, setWaiting]);

  /** Next step: make the waiting click, move to the next chapter, or hurry the animation along. */
  const forward = useCallback(() => {
    if (!started) {
      setStarted(true);
      setStartedAt(Date.now());
      play(true);
      return;
    }
    const w = waitingRef.current;
    if (w) {
      history.current.push({ t: tRef.current, kind: w.kind });
      if (w.kind === "press") done.current.add(`${stepAt(tRef.current)}:${w.at}`);
      else seek(STARTS[stepAt(tRef.current) + 1]);
      setWaiting(null);
      hurry.current = false;
      play(true);
    } else if (playingRef.current) {
      hurry.current = true;
    } else if (tRef.current < TOTAL) {
      play(true);
    }
  }, [started, play, seek, setWaiting]);

  /** Previous step: back to the last stop, waiting again. */
  const back = useCallback(() => {
    const prev = history.current.pop();
    hurry.current = false;
    done.current.clear();
    play(false);
    if (!prev) {
      seek(0);
      setWaiting(null);
      return;
    }
    // A click stop comes back by itself as its button comes due; a chapter end is held here.
    setWaiting(prev.kind === "next" ? { kind: "next" } : null);
    seek(prev.kind === "next" ? prev.t : prev.t - 1);
  }, [play, seek, setWaiting]);

  const toPhase = useCallback((p: number) => {
    if (p < 0 || p >= PHASES.length) return;
    history.current = [];
    done.current.clear();
    hurry.current = false;
    setWaiting(null);
    if (!started) { setStarted(true); setStartedAt(Date.now()); }
    seek(PHASE_STARTS[p]);
    play(true);
  }, [started, play, seek, setWaiting]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  const openNotes = useCallback(() => {
    window.open("/demo/stage/notes", "opensrcer-stage-notes", "width=960,height=760");
  }, []);

  // Clicker, keyboard and presenter remotes (they send Page Up/Down or arrows).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const onButton = document.activeElement instanceof HTMLButtonElement;
      if (["ArrowRight", "PageDown"].includes(event.key) || (!onButton && [" ", "Enter"].includes(event.key))) { event.preventDefault(); forward(); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); back(); }
      else if (event.key === "f") { event.preventDefault(); toggleFullscreen(); }
      else if (event.key === "n") { event.preventDefault(); openNotes(); }
      else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); toPhase(Number(event.key) - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, back, toggleFullscreen, openNotes, toPhase]);

  // The notes window: tell it where the stage is, take its Next and Back.
  const channel = useRef<BroadcastChannel | null>(null);
  const handlers = useRef({ forward, back, toPhase });
  handlers.current = { forward, back, toPhase };
  const [hello, setHello] = useState(0);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (e: MessageEvent<StageCommand>) => {
      if (e.data?.type !== "cmd") return;
      if (e.data.cmd === "next") handlers.current.forward();
      else if (e.data.cmd === "back") handlers.current.back();
      else if (e.data.cmd === "phase" && typeof e.data.phase === "number") handlers.current.toPhase(e.data.phase);
      else if (e.data.cmd === "hello") setHello((n) => n + 1);
    };
    return () => bc.close();
  }, []);
  const quarter = Math.floor(local / 250);
  useEffect(() => {
    const state: StageState = { step: index, local, waiting, playing, started, ended, startedAt };
    channel.current?.postMessage({ type: "state", state });
    // Quarter-second updates are plenty for the notes, and keep the channel quiet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, quarter, waiting, playing, started, ended, startedAt, hello]);

  // Scale the design canvas to the screen, like a slide.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.max(0.3, Math.min(width / DESIGN.width, height / DESIGN.height)));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const interact = useMemo<Interact>(() => ({
    waitingAt: waiting?.kind === "press" ? waiting.at : null,
    reach: (at, label) => {
      const key = `${stepAt(tRef.current)}:${at}`;
      if (SKIP.has(label)) done.current.add(key);
      if (waitingRef.current || done.current.has(key)) return;
      hurry.current = false;
      setWaiting({ kind: "press", at, label });
      play(false);
    },
    press: forward,
    open: (id) => {
      const i = STEPS.findIndex((s) => s.chapter.id === id);
      if (i < 0) return;
      history.current = [];
      done.current.clear();
      setWaiting(null);
      seek(STARTS[i]);
      play(true);
    },
    claimFocus: () => false,
  }), [waiting, forward, setWaiting, play, seek]);

  // The spotlight: on the button a click stop waits for, otherwise on what the current note is about.
  const currentAt = Math.max(-1, ...step.chapter.captions.filter((c) => c.at <= local).map((c) => c.at));
  const noteSpot = step.chapter.captions.find((c) => c.at === currentAt && c.spot)?.spot;
  const spotOn = waiting?.kind === "press" ? "[data-waiting]" : noteSpot && !ended ? `[data-spot="${noteSpot}"]` : null;

  const head = started ? step.chapter.headlines?.filter((h) => h.at <= local).at(-1) : undefined;
  const headline = head?.text;
  const poster = !started || step.chapter.poster;
  const provenance = started && !ended ? step.chapter.provenance?.filter((h) => h.at <= local).at(-1)?.text : undefined;

  const View = step.chapter.View;
  return (
    <div ref={rootRef} role="region" aria-label="opensrcer stage demo" className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink p-4 sm:p-6">
      {/* Made for a projector: on a phone the app would shrink past reading, so point to the tour. */}
      <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-ink px-6 text-center md:hidden">
        <p className="text-[20px] font-semibold text-paper">The stage demo is made for a big screen.</p>
        <p className="text-[16px] leading-[1.5] text-paper-muted">On a phone, the product tour shows the same run, sized to fit.</p>
        <a href="/demo" className="btn-primary inline-flex min-h-11 items-center px-6 text-[16px]">Open the product tour</a>
      </div>
      {/* The headline sits on the app's left edge, in the display face: big type does the work. */}
      <div className="relative z-[70] mx-auto mb-4 shrink-0" style={{ width: DESIGN.width * scale }}>
        <StageHeadline key={headline ?? ""} head={head} />
      </div>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div ref={canvasRef} style={{ width: DESIGN.width, height: DESIGN.height, zoom: scale }} className={cn("relative shrink-0 rounded-[26px] transition-[background-color,border-color,box-shadow] duration-500", poster ? "overflow-visible border border-transparent bg-ink" : "overflow-hidden border border-border bg-surface shadow-[0_30px_80px_-40px_rgb(28_23_20/0.35)]")}>
          <InteractContext.Provider value={interact}>
            <TimeContext.Provider value={local}>
              {started ? (
                <div key={step.chapter.id} className="stage-enter h-full">
                  <View />
                </div>
              ) : (
                // Before the first step: the title slide, so a projector shown early isn't an empty box.
                <StageTitle />
              )}
            </TimeContext.Provider>
          </InteractContext.Provider>
        </div>
      </div>
      <Spotlight selector={spotOn} strong={waiting?.kind === "press"} within={canvasRef} />

      {/* Which of the four phases this is (dots, no words), and, outside the app so it
          never covers it, a quiet arrow when the presenter can move on. */}
      <div className="relative mt-3 flex h-11 shrink-0 items-center justify-center">
        {/* Where what's on screen comes from: quiet, outside the app, never over it. */}
        {provenance && <p key={provenance} className="stage-settle absolute left-0 z-[70] max-w-[40%] truncate rounded-full border border-border bg-surface px-3.5 py-1 text-[13px] font-medium text-paper-dim">{provenance}</p>}
        <div aria-hidden className="flex items-center gap-2">
          {PHASES.map((p, i) => (
            <span key={p.name} className={cn("h-1.5 rounded-full transition-all duration-500", i === step.phase ? "w-8 bg-signal" : i < step.phase ? "w-1.5 bg-signal/50" : "w-1.5 bg-border")} />
          ))}
        </div>
        {waiting?.kind === "next" && !ended && (
          <button type="button" onClick={forward} aria-label="Next step" className="stage-settle absolute right-0 z-[70] grid size-11 place-items-center rounded-full bg-signal text-white transition-transform duration-200 hover:scale-105">
            <ArrowRight aria-hidden size={18} weight="bold" />
          </button>
        )}
      </div>

      {!started && (
        // Only before the first step, for the presenter: how to drive it.
        <div className="pointer-events-auto absolute inset-x-0 bottom-8 mx-auto flex w-fit flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-surface px-2 py-2 text-[13px] text-paper-muted">
          <button type="button" onClick={forward} className="cta-pill" data-size="sm">Begin<span className="cta-pill-arrow"><ArrowGlyph size={13} /></span></button>
          <button type="button" onClick={toggleFullscreen} className="pill" data-quiet><CornersOut aria-hidden size={14} weight="bold" />Full screen</button>
          <button type="button" onClick={openNotes} className="pill" data-quiet>Speaker notes</button>
          <span className="px-2 font-mono text-[12px]">→ next · ← back · 1–4 phase · F full screen · N notes</span>
        </div>
      )}
    </div>
  );
}

/** A stop's headline in the display face, with at most one personal touch: a word underlined
 *  by hand, or a sticker slapped on the end (both from what the stop already says). */
function StageHeadline({ head }: { head?: Caption }) {
  if (!head) return <p aria-live="polite" className="display min-h-[1.05em] text-[clamp(26px,2.9vw,50px)]" />;
  const { text, mark, sticker } = head;
  const at = mark ? text.indexOf(mark) : -1;
  return (
    <p aria-live="polite" className="display stage-headline min-h-[1.05em] text-balance text-[clamp(26px,2.9vw,50px)] leading-[1.02] tracking-[-0.02em] text-paper">
      {at < 0 ? text : (
        <>
          {text.slice(0, at)}
          <span className="relative inline-block whitespace-nowrap">
            {mark}
            <Doodle doodle={underline} draw="load" delay={420} duration={750} stretch className="absolute -bottom-[0.2em] left-[-2%] h-[0.26em] w-[104%]" />
          </span>
          {text.slice(at + (mark?.length ?? 0))}
        </>
      )}
      {sticker && (
        <Sticker tone={sticker.tone ?? "ink"} tilt={sticker.tilt ?? -5} delay={380} className="relative -top-[0.35em] ml-4 align-middle text-[clamp(13px,1vw,17px)]">
          {sticker.text}
        </Sticker>
      )}
    </p>
  );
}

const SPOT_PAD = 10; // screen px around the target
const SMALL = 48; // screen px: a target this short is ringed on its own edge, so the ring stays off its neighbours

/** With no pointer on stage, what's being clicked or talked about is lit: the rest of
 *  the screen dims and a thick ring sits around the target. Drawn in screen pixels,
 *  outside the scaled canvas, so it reads from the back of a room at any size. It
 *  follows the target as it moves (a pane scrolling, a card fading in). */
function Spotlight({ selector, strong, within }: { selector: string | null; strong: boolean; within: RefObject<HTMLDivElement | null> }) {
  const [box, setBox] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const measure = () => {
      const canvas = within.current;
      // Every match, as one box: a run of log lines lights up together.
      // Not yet revealed (Reveal marks it aria-hidden, or every child is) means nothing to
      // light yet: the ring waits for the content instead of framing empty space.
      // A button waiting for its click is always on screen; the check is for what notes point at.
      const hidden = (el: Element) => !el.hasAttribute("data-waiting") && (el.getAttribute("aria-hidden") === "true" || (el.children.length > 0 && [...el.children].every((c) => c.getAttribute("aria-hidden") === "true")));
      const rects = selector && canvas ? [...canvas.querySelectorAll(selector)].filter((el) => !hidden(el)).map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0) : [];
      if (!canvas || rects.length === 0) { setOn(false); return; }
      const r = { left: Math.min(...rects.map((b) => b.left)), top: Math.min(...rects.map((b) => b.top)), right: Math.max(...rects.map((b) => b.right)), bottom: Math.max(...rects.map((b) => b.bottom)), width: 1 };
      const c = canvas.getBoundingClientRect();
      // Kept to the app window: a long list lights only the part on screen.
      const small = r.bottom - r.top < SMALL && r.right - r.left < SMALL * 3;
      const pad = small ? 0 : SPOT_PAD;
      const left = Math.max(r.left, c.left) - pad, top = Math.max(r.top, c.top) - pad;
      const right = Math.min(r.right, c.right) + pad, bottom = Math.min(r.bottom, c.bottom) + pad;
      const next = r.width > 0 && right > left && bottom > top ? `${left}|${top}|${right - left}|${bottom - top}|${small ? 1 : 0}` : null;
      setOn(next !== null);
      if (next) setBox((prev) => (prev === next ? prev : next));
    };
    measure();
    if (!selector) return;
    const id = window.setInterval(measure, 100);
    return () => window.clearInterval(id);
  }, [selector, within]);
  if (!box) return null;
  const [left, top, width, height, small] = box.split("|").map(Number);
  const frame = { left, top, width, height };
  const shape = cn("fixed z-[60] transition-[left,top,width,height] duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", small ? "rounded-[8px]" : "rounded-[16px]");
  // A small target's ring sits on its own edge (inside), a big one's around it.
  const ring = small ? "inset 0 0 0 3px var(--color-signal), 0 0 22px 4px rgb(35 56 230 / 0.4)" : "inset 0 0 0 3px var(--color-surface), 0 0 0 6px var(--color-signal), 0 0 28px 8px rgb(35 56 230 / 0.35)";
  return (
    <div aria-hidden className={cn("pointer-events-none transition-opacity duration-300 ease-out motion-reduce:transition-none", on ? "opacity-100" : "opacity-0")}>
      <div data-spotlight={on ? (strong ? "click" : "note") : undefined} className={shape} style={{ ...frame, boxShadow: `0 0 0 9999px rgb(28 23 20 / ${strong ? 0.6 : 0.44})` }} />
      <div className={cn(shape, "animate-pulse motion-reduce:animate-none")} style={{ ...frame, boxShadow: ring }} />
    </div>
  );
}

/** For questions from the room; the notes window only, never the stage. */
const IF_ASKED = [
  "Big-repo replays: 4 real bugs the maintainers had already fixed (React, Flask, pydantic, vLLM), each started from just before their fix. In 2 the maintainers' own tests pass on opensrcer's fix; 2 were correct but narrower, and the preview now names the variants it didn't cover. (Flask's tests came from the issue itself, which the reporter wrote.)",
  "What it doesn't do: it doesn't run the project's own CI; CI on the pull request is still the project's. It can be wrong, which is why a person has to explain the change before anything is published.",
  "Caps: one open opensrcer pull request per project per person, and three a day.",
  "Cost: about ten cents for a small fix like this one on an Anthropic API key, about 40 to 50 cents on the big projects, or your Claude plan instead.",
  "The graph on screen is for you; the agent works from the code itself. In the real run it looked up truncate's definition and read its test file before editing, and it has tools to find every caller.",
  "opensrcer's own CI: unit tests, 7 browser smoke tests, a secret scan (gitleaks) and CodeQL on every change to main.",
];

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The presenter's window: what this phase is about, the talking points for the
 *  chapter on stage, what the next click does, and Next and Back that drive the stage. */
export function StageNotes() {
  const [state, setState] = useState<StageState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (e: MessageEvent<{ type: string; state: StageState }>) => { if (e.data?.type === "state") setState(e.data.state); };
    bc.postMessage({ type: "cmd", cmd: "hello" } satisfies StageCommand);
    return () => bc.close();
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const send = useCallback((cmd: StageCommand["cmd"], phase?: number) => channel.current?.postMessage({ type: "cmd", cmd, phase } satisfies StageCommand), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const onButton = document.activeElement instanceof HTMLButtonElement;
      if (["ArrowRight", "PageDown"].includes(event.key) || (!onButton && [" ", "Enter"].includes(event.key))) { event.preventDefault(); send("next"); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); send("back"); }
      else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); send("phase", Number(event.key) - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  const s = state ? STEPS[state.step] : null;
  const chapter = s?.chapter;
  const nextStep = state ? STEPS[state.step + 1] : undefined;
  const nextUp = !state ? "" : !state.started ? "Begin: it opens on the problem every maintainer here knows."
    : state.ended ? "That's the end of the demo."
    : state.waiting?.kind === "press" ? `Click “${state.waiting.label}”`
    : state.waiting?.kind === "next" ? (nextStep ? `Next: ${nextStep.chapter.title}${nextStep.phase !== s!.phase ? ` (${PHASES[nextStep.phase].name} phase)` : ""}` : "End of the demo")
    : "Playing… (→ skips ahead to the next step)";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[900px] flex-col gap-5 px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-paper">Speaker notes</h1>
        <div className="flex items-center gap-3 text-[13px] text-paper-muted">
          <span className="font-mono tabular-nums">{state?.startedAt ? clock(now - state.startedAt) : "0:00"}</span>
          <span>{state ? "Stage connected" : "Open /demo/stage in another window"}</span>
        </div>
      </header>

      <nav aria-label="Phases" className="grid grid-cols-4 gap-2">
        {PHASES.map((p, i) => (
          <button key={p.name} type="button" onClick={() => send("phase", i)} aria-current={s?.phase === i ? "step" : undefined} className={cn("min-h-11 rounded-xl border px-3 text-left text-[14px] transition", s?.phase === i ? "border-signal bg-signal text-white" : "border-border bg-surface text-paper hover:border-border-strong")}>
            <span className="font-mono text-[11px] opacity-75">{i + 1}</span> {p.name}
            <span className="block font-mono text-[11px] opacity-75">by {p.by}</span>
          </button>
        ))}
      </nav>

      {s && chapter ? (
        <section aria-live="polite" className="flex flex-col gap-4">
          <p className="text-[15px] font-medium text-signal">{PHASES[s.phase].say}</p>
          <div className="rounded-2xl border border-border-soft bg-surface p-5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-paper-muted">On stage · {chapter.title}</p>
            <ul className="mt-3 space-y-3">
              {chapter.captions.map((c) => {
                // Notes that start together (a tour caption and a stage note at the
                // same moment) are current together, so the next distinct time ends them.
                const nextAt = chapter.captions.find((n) => n.at > c.at)?.at ?? Infinity;
                const current = (state?.local ?? 0) >= c.at && (state?.local ?? 0) < nextAt;
                const past = (state?.local ?? 0) >= nextAt;
                return (
                  <li key={`${c.at}:${c.text}`} className={cn("text-[19px] leading-[1.45] transition-colors", current ? "font-medium text-paper" : past ? "text-paper-muted" : "text-paper-dim")}>
                    {current && <span aria-hidden className="mr-2 text-signal">▸</span>}{c.text}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-[16px] text-paper"><span className="font-semibold">Next · </span>{nextUp}</p>
        </section>
      ) : (
        <p className="text-[16px] text-paper-muted">Waiting for the stage. Open <code className="font-mono">/demo/stage</code> in another window (or press N there).</p>
      )}

      <div className="mt-auto flex gap-3">
        <button type="button" onClick={() => send("back")} className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-[17px] font-medium text-paper"><CaretLeft aria-hidden size={18} weight="bold" />Back</button>
        <button type="button" onClick={() => send("next")} className="inline-flex min-h-14 flex-[2] items-center justify-center gap-2 rounded-2xl bg-signal text-[17px] font-semibold text-white">Next<CaretRight aria-hidden size={18} weight="bold" /></button>
      </div>
      <p className="text-[12px] text-paper-muted">Keys work here too: → or Page Down next, ← back, 1-4 jump to a phase.</p>
      <details className="rounded-2xl border border-border-soft bg-surface px-5 py-4 text-[15px] leading-[1.5] text-paper">
        <summary className="cursor-pointer font-medium">If asked</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-paper-dim">
          {IF_ASKED.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </details>
    </div>
  );
}
