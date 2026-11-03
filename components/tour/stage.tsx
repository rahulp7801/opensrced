"use client";

// The stage demo: the product in four phases, to click through at your own pace.
// It's shared as a public link, so the way home, the waitlist and the controls are
// always on screen.
//
// It plays the tour's own chapters (components/tour/chapters-*.tsx) with the same
// clock model: every scripted click is a stop that waits for the presenter, the
// animation between stops plays by itself, and each chapter's last frame holds
// until the presenter moves on.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CornersOut } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { FrameUrlContext, InteractContext, TimeContext, type Caption, type Chapter, type Interact } from "./kit";
import { Doodle } from "@/components/brand/doodles";
import { pass } from "@/components/brand/doodle-data";
import { Wordmark } from "@/components/brand/wordmark";
import { pacedBy } from "./chapters";
import { preloadRepoSnapshot } from "./repo-map";
import { pr } from "./chapters-fix";
import { StageTitle, stageExplore, stageNotes, stageProblem, stagePromise, stageRefused, stageReview, stageRules, stageScan, stageSlop, stageVerified, withPrFacts } from "./stage-views";

/** How much slower than written the stage plays its animations. The presenter
 *  sets the pace between steps; this only stretches what plays by itself. */
export const STAGE_PACE = 1.15;

type Phase = { name: string; chapters: Chapter[] };

// The stage's versions of the tour's review screens.
const S = stageNotes({ pr });

/** Clicks the tour's screens make that the stage makes by itself, to keep the talk to ~10 minutes. */
const SKIP = new Set(["Copy diff", "Commit msg", "Ready (3)", "Build graph", "Review patch", "Sign in with Claude & start", "Explain this fix like I'm new to the project", "Send answer"]);

/** The four phases. */
const PHASES: Phase[] = [
  { name: "Why", chapters: [stageProblem, stagePromise] },
  { name: "Find", chapters: [stageScan, stageExplore] },
  { name: "Prove", chapters: [stageRules, stageVerified] },
  { name: "Ship", chapters: [stageReview, withPrFacts(S.pr), stageRefused, stageSlop] },
];

const STEPS = PHASES.flatMap((phase, p) => phase.chapters.map((c) => ({ phase: p, chapter: pacedBy(c, STAGE_PACE) })));
const STARTS = STEPS.reduce<number[]>((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + STEPS[i - 1].chapter.duration], []);
const TOTAL = STARTS[STARTS.length - 1] + STEPS[STEPS.length - 1].chapter.duration;
const PHASE_STARTS = PHASES.map((_p, i) => STARTS[STEPS.findIndex((s) => s.phase === i)]);
// Nothing swaps to a new screen on its own: where a chapter changes screens (its holds), the
// stage waits for →, as it does at a chapter's end.
const BEATS = STEPS.map(({ chapter }) => chapter.holds ?? []);
// A hold that comes due this soon after an on-screen click comes with the click, not on a second press.
const AFTER_PRESS = 2000;
// Given to the app windows so they leave out their own address bar: the stage shows no URLs.
const NO_URL = () => {};

const DESIGN = { width: 1040, height: 560 };
// Headlines are sized from the app frame, not the window: 3.4% of its width (about 59 px on a
// 1920 screen). The longest headline is then 88% of the frame, so none ever wraps into a
// second line that would shrink the frame between stops.
const HEADLINE_OF_FRAME = 0.034;
const TICK_MS = 50;

function stepAt(t: number): number {
  let i = 0;
  while (i + 1 < STARTS.length && t >= STARTS[i + 1]) i++;
  return i;
}

type Waiting = { kind: "press"; at: number; label: string } | { kind: "next" } | { kind: "beat" };

export function StageDemo() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaitingState] = useState<Waiting | null>(null);
  const [started, setStarted] = useState(false);
  const [scale, setScale] = useState(1);
  // The Explore stop maps a large repository; fetch its snapshot while the talk opens.
  useEffect(() => { preloadRepoSnapshot().catch(() => {}); }, []);
  const tRef = useRef(0);
  const waitingRef = useRef<Waiting | null>(null);
  const playingRef = useRef(false);
  const hurry = useRef(false); // fast-forward to the next stop
  const done = useRef(new Set<string>()); // clicks already made, as "step:at"
  const history = useRef<Array<{ t: number; kind: Waiting["kind"] }>>([]); // stops passed, for Back
  const lastPress = useRef(-Infinity); // when the last on-screen click was made, on the timeline
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
      // Hold before the next talking point in this chapter until the presenter presses →.
      const beat = BEATS[i].find((b) => STARTS[i] + b > tRef.current && STARTS[i] + b <= next && STARTS[i] + b - lastPress.current > AFTER_PRESS);
      if (beat !== undefined) {
        next = STARTS[i] + beat - 1;
        hurry.current = false;
        setWaiting({ kind: "beat" });
        play(false);
      } else if (i + 1 < STEPS.length && next >= STARTS[i + 1] - 1) {
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
      play(true);
      return;
    }
    const w = waitingRef.current;
    if (w) {
      history.current.push({ t: tRef.current, kind: w.kind });
      if (w.kind === "press") { done.current.add(`${stepAt(tRef.current)}:${w.at}`); lastPress.current = tRef.current; }
      else if (w.kind === "beat") seek(tRef.current + 1); // onto the point, so the clock doesn't hold on it again
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
    // A click stop comes back by itself as its button comes due; a chapter end or a point is held here.
    lastPress.current = -Infinity;
    setWaiting(prev.kind === "press" ? null : { kind: prev.kind });
    seek(prev.kind === "press" ? prev.t - 1 : prev.t);
  }, [play, seek, setWaiting]);

  const toPhase = useCallback((p: number) => {
    if (p < 0 || p >= PHASES.length) return;
    history.current = [];
    done.current.clear();
    hurry.current = false;
    setWaiting(null);
    if (!started) { setStarted(true); }
    seek(PHASE_STARTS[p]);
    play(true);
  }, [started, play, seek, setWaiting]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  // Clicker, keyboard and presenter remotes (they send Page Up/Down or arrows).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const onButton = document.activeElement instanceof HTMLButtonElement;
      if (["ArrowRight", "PageDown"].includes(event.key) || (!onButton && [" ", "Enter"].includes(event.key))) { event.preventDefault(); forward(); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); back(); }
      else if (event.key === "f") { event.preventDefault(); toggleFullscreen(); }
      else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); toPhase(Number(event.key) - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, back, toggleFullscreen, toPhase]);

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
  const spotOn = waiting?.kind === "press" ? "[data-waiting]" : waiting?.kind === "next" || ended ? null : noteSpot ? `[data-spot="${noteSpot}"]` : null;

  const head = started ? step.chapter.headlines?.filter((h) => h.at <= local).at(-1) : undefined;
  const poster = !started || step.chapter.poster;

  const View = step.chapter.View;
  return (
    <div ref={rootRef} data-stage-root="" role="region" aria-label="opensrcer stage demo" className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink p-2 sm:p-6">
      {/* Always on: the way back to the site, and the way in. */}
      <div className="relative z-[80] mx-auto mb-3 flex w-full max-w-[1400px] shrink-0 items-center justify-between gap-3">
        <Link href="/" aria-label="opensrcer home" className="text-paper"><Wordmark className="text-[22px]" /></Link>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleFullscreen} className="pill hidden sm:inline-flex [@media(hover:none)]:hidden" data-quiet><CornersOut aria-hidden size={14} weight="bold" />Full screen</button>
          <Link href="/join" className="inline-flex min-h-9 items-center rounded-full bg-signal px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">Join the waitlist</Link>
        </div>
      </div>
      {/* A phone held upright gets a small slide; sideways it fills the screen. */}
      <p className="mb-3 hidden shrink-0 text-center text-[13px] text-paper-muted max-md:[@media(orientation:portrait)]:block">Turn your phone sideways for a bigger view.</p>
      {/* The headline sits on the app's left edge, in the display face: big type does the work. */}
      <div className="relative z-[70] mx-auto mb-5 shrink-0" style={{ width: DESIGN.width * scale, fontSize: DESIGN.width * scale * HEADLINE_OF_FRAME }}>
        <StageHeadline head={head} />
      </div>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div ref={canvasRef} style={{ width: DESIGN.width, height: DESIGN.height, zoom: scale }} className={cn("relative shrink-0 rounded-[12px] transition-[background-color,border-color] duration-500", poster ? "overflow-visible border border-transparent bg-ink" : "overflow-hidden border border-border bg-surface")}>
          <InteractContext.Provider value={interact}>
            <FrameUrlContext.Provider value={NO_URL}>
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
            </FrameUrlContext.Provider>
          </InteractContext.Provider>
        </div>
      </div>
      <Spotlight selector={spotOn} strong={waiting?.kind === "press"} within={canvasRef} />

      {/* Under the app: the four phases (click one to jump there), Back, and Next. Next makes
          the click a step is waiting for, so it always moves the demo on. Keys: → ← 1-4 F. */}
      <div className="relative mx-auto mt-3 flex min-h-11 shrink-0 items-center gap-2" style={{ width: DESIGN.width * scale }}>
        <nav aria-label="Demo sections" className="flex min-w-0 items-center gap-0.5">
          {PHASES.map((p, i) => {
            const current = started && step.phase === i;
            return (
              <button key={p.name} type="button" onClick={() => toPhase(i)} aria-current={current ? "step" : undefined}
                className={cn("inline-flex min-h-9 items-center rounded-full px-2.5 text-[13px] transition-colors sm:px-3", current ? "bg-surface font-semibold text-paper" : "text-paper-muted hover:text-paper")}>
                <span aria-hidden className="mr-1.5 hidden font-mono text-[11px] text-paper-faint sm:inline">{i + 1}</span>{p.name}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {started && (
            <button type="button" onClick={back} aria-label="Back" className="grid size-11 place-items-center rounded-full border border-border text-paper transition-colors hover:bg-surface">
              <ArrowLeft aria-hidden size={18} weight="bold" />
            </button>
          )}
          {!ended && (started ? (
            <button type="button" onClick={forward} aria-label="Next" className="grid size-11 place-items-center rounded-full bg-signal text-white transition-opacity hover:opacity-90">
              <ArrowRight aria-hidden size={18} weight="bold" />
            </button>
          ) : (
            <button type="button" onClick={forward} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-signal px-5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90">
              Begin<ArrowRight aria-hidden size={16} weight="bold" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A stop's headline in the display face, at most one hand underline under a phrase. When it
 *  changes, the old line fades out (150 ms) before the new one rises in. */
function StageHeadline({ head }: { head?: Caption }) {
  const [shown, setShown] = useState(head);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (head === shown) return;
    if (!shown) { setShown(head); return; }
    setLeaving(true);
    const id = window.setTimeout(() => { setShown(head); setLeaving(false); }, 150);
    return () => window.clearTimeout(id);
  }, [head, shown]);
  const text = shown?.text ?? "";
  const mark = shown?.mark;
  const at = mark ? text.indexOf(mark) : -1;
  return (
    <p key={text} aria-live="polite" className={cn("display min-h-[1.05em] whitespace-nowrap leading-[1.02] tracking-[-0.02em] text-paper", leaving ? "opacity-0 transition-opacity duration-150 motion-reduce:transition-none" : "stage-rise")}>
      {at < 0 ? text : (
        <>
          {text.slice(0, at)}
          <span className="relative inline-block whitespace-nowrap">
            {mark}
            <Doodle doodle={pass} draw="load" delay={450} duration={700} stretch className="absolute -bottom-[0.12em] left-0 h-[0.12em] w-full" />
          </span>
          {text.slice(at + (mark?.length ?? 0))}
        </>
      )}
    </p>
  );
}

const SPOT_OFFSET = 6; // screen px between the target and its ring

type Rect = { left: number; top: number; width: number; height: number };

/** With no pointer on stage, what's being clicked or talked about is ringed: a thin cobalt
 *  line 6 px around the target, nothing dimmed, so every part of the screen stays readable. Between targets it fades out and in at the new place,
 *  rather than sliding; on one target it follows as the target moves (a pane scrolling). */
function Spotlight({ selector, strong, within }: { selector: string | null; strong: boolean; within: RefObject<HTMLDivElement | null> }) {
  const [frame, setFrame] = useState<{ clip: Rect; box: Rect; key: string } | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const measure = () => {
      const canvas = within.current;
      // Every match, as one box: a run of log lines lights up together.
      // Not yet revealed (Reveal marks it aria-hidden, or every child is) means nothing to
      // light yet: the ring waits for the content instead of framing empty space.
      // A button waiting for its click is always on screen; the check is for what a caption points at.
      const hidden = (el: Element) => !el.hasAttribute("data-waiting") && (el.getAttribute("aria-hidden") === "true" || (el.children.length > 0 && [...el.children].every((c) => c.getAttribute("aria-hidden") === "true")));
      const rects = selector && canvas ? [...canvas.querySelectorAll(selector)].filter((el) => !hidden(el)).map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0) : [];
      if (!canvas || rects.length === 0) { setOn(false); return; }
      const c = canvas.getBoundingClientRect();
      // Kept to the app window: a long list lights only the part on screen.
      const left = Math.max(Math.min(...rects.map((b) => b.left)), c.left) - SPOT_OFFSET;
      const top = Math.max(Math.min(...rects.map((b) => b.top)), c.top) - SPOT_OFFSET;
      const right = Math.min(Math.max(...rects.map((b) => b.right)), c.right) + SPOT_OFFSET;
      const bottom = Math.min(Math.max(...rects.map((b) => b.bottom)), c.bottom) + SPOT_OFFSET;
      if (right <= left || bottom <= top) { setOn(false); return; }
      const clip = { left: c.left, top: c.top, width: c.width, height: c.height };
      const box = { left: left - c.left, top: top - c.top, width: right - left, height: bottom - top };
      const key = [clip.left, clip.top, clip.width, clip.height, box.left, box.top, box.width, box.height].map(Math.round).join("|");
      setFrame((prev) => (prev?.key === key ? prev : { clip, box, key }));
      setOn(true);
    };
    // A new target: fade out, then appear at its place.
    setOn(false);
    if (!selector) return;
    let id = 0;
    const start = window.setTimeout(() => { measure(); id = window.setInterval(measure, 100); }, 120);
    return () => { window.clearTimeout(start); window.clearInterval(id); };
  }, [selector, within]);
  if (!frame) return null;
  const { clip, box } = frame;
  return (
    <div aria-hidden className="pointer-events-none fixed z-[60] overflow-hidden rounded-[16px]" style={clip}>
      <div
        data-spotlight={on ? (strong ? "click" : "note") : undefined}
        className={cn("absolute rounded-[12px] transition-opacity duration-[120ms] motion-reduce:transition-none", on ? "opacity-100" : "opacity-0")}
        style={{ ...box, boxShadow: "0 0 0 2px var(--color-signal)" }}
      />
    </div>
  );
}
