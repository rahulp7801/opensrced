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
import { FrameUrlContext, InteractContext, TimeContext, type Caption, type Chapter, type Interact } from "./kit";
import { Doodle } from "@/components/brand/doodles";
import { pass } from "@/components/brand/doodle-data";
import { ArrowGlyph } from "@/components/brand/pill";
import { pacedBy } from "./chapters";
import { preloadRepoSnapshot } from "./repo-map";
import { pr } from "./chapters-fix";
import { StageTitle, stageExplore, stageNotes, stageProblem, stagePromise, stageRefused, stageReview, stageRules, stageScan, stageSlop, stageVerified, withPrFacts } from "./stage-views";

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
  { name: "Find", by: "0:50", say: "Pick an issue that's open to you, and understand the code before touching it.", chapters: [stageScan, stageExplore] },
  { name: "Prove", by: "2:15", say: "It reads the project's rules, finds the cause, and proves the fix: the bug, the patch, and the test failing without it and passing with it.", chapters: [stageRules, stageVerified] },
  { name: "Ship", by: "3:45", say: "You explain it in your own words (it catches what you get wrong), a human publishes a transparent draft, and it says no where it isn't welcome.", chapters: [stageReview, withPrFacts(S.pr), stageRefused, stageSlop] },
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
const CHANNEL = "opensrcer-stage";

function stepAt(t: number): number {
  let i = 0;
  while (i + 1 < STARTS.length && t >= STARTS[i + 1]) i++;
  return i;
}

type Waiting = { kind: "press"; at: number; label: string } | { kind: "next" } | { kind: "beat" };
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
  // The presenter drives from the notes window and the keyboard; the on-screen controls show
  // only while the mouse moves (two seconds), or while one has focus.
  const [controls, setControls] = useState(false);
  useEffect(() => {
    let id = 0;
    const show = () => { setControls(true); window.clearTimeout(id); id = window.setTimeout(() => setControls(false), 2000); };
    window.addEventListener("mousemove", show);
    return () => { window.removeEventListener("mousemove", show); window.clearTimeout(id); };
  }, []);
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
      setStartedAt(Date.now());
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
  const spotOn = waiting?.kind === "press" ? "[data-waiting]" : waiting?.kind === "next" || ended ? null : noteSpot ? `[data-spot="${noteSpot}"]` : null;

  const head = started ? step.chapter.headlines?.filter((h) => h.at <= local).at(-1) : undefined;
  const poster = !started || step.chapter.poster;

  const View = step.chapter.View;
  return (
    <div ref={rootRef} data-stage-root="" role="region" aria-label="opensrcer stage demo" className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink p-4 sm:p-6">
      {/* Made for a projector: on a phone the app would shrink past reading, so point to the tour. */}
      <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-ink px-6 text-center md:hidden">
        <p className="text-[20px] font-semibold text-paper">The stage demo is made for a big screen.</p>
        <p className="text-[16px] leading-[1.5] text-paper-muted">On a phone, the product tour shows the same run, sized to fit.</p>
        <a href="/demo" className="btn-primary inline-flex min-h-11 items-center px-6 text-[16px]">Open the product tour</a>
      </div>
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

      {/* Under the app, on its left edge: which chapter this is, and (only while the mouse
          moves) the arrow to move on. */}
      <div className="relative mx-auto mt-3 flex h-11 shrink-0 items-center" style={{ width: DESIGN.width * scale }}>
        <p className="font-mono text-[13px] tracking-[0.02em] text-paper-faint">
          {started && <><span className="text-paper">{step.phase + 1}</span> / {PHASES.length}<span className="ml-3 text-paper">{PHASES[step.phase].name}</span></>}
        </p>
        {(waiting?.kind === "next" || waiting?.kind === "beat") && !ended && (
          <button type="button" onClick={forward} aria-label="Next step" className={cn("absolute right-0 z-[70] grid size-11 place-items-center rounded-full bg-signal text-white transition-opacity duration-300 focus-visible:opacity-100", controls ? "opacity-100" : "opacity-0")}>
            <ArrowRight aria-hidden size={18} weight="bold" />
          </button>
        )}
      </div>

      {!started && (
        // Only before the first step, for the presenter, and only while the mouse moves: how to drive it.
        <div className={cn("pointer-events-auto absolute inset-x-0 bottom-8 mx-auto flex w-fit flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-surface px-2 py-2 text-[13px] text-paper-muted transition-opacity duration-300 focus-within:opacity-100", controls ? "opacity-100" : "opacity-0")}>
          <button type="button" onClick={forward} className="cta-pill" data-size="sm">Begin<span className="cta-pill-arrow"><ArrowGlyph size={13} /></span></button>
          <button type="button" onClick={toggleFullscreen} className="pill" data-quiet><CornersOut aria-hidden size={14} weight="bold" />Full screen</button>
          <button type="button" onClick={openNotes} className="pill" data-quiet>Speaker notes</button>
          <span className="px-2 font-mono text-[12px]">→ next · ← back · 1–4 phase · F full screen · N notes</span>
        </div>
      )}
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
      // A button waiting for its click is always on screen; the check is for what notes point at.
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

/** For questions from the room; the notes window only, never the stage. */
const IF_ASKED: Array<[string, string]> = [
  ["Why not Copilot, or Claude Code with custom instructions?", "\"Copilot and Claude Code help you write code. opensrcer helps you make a contribution, and those aren't the same problem.\" PRs get closed because the issue was taken, the project didn't want AI, or the author couldn't answer a review question. A custom instruction is a polite request to the model; here, when Flask says no AI the model is never called, and when you can't explain your change, publish doesn't unlock. Walls, not instructions."],
  ["Is that a real Pydantic pull request?", "No. The Pydantic walkthrough is a demo scenario on the real product screens, and the issue and PR numbers are the demo's. What's real: Pydantic's rules and AI policy, the code map, the Explore answer, the fix and its test results (45 pass; 2 fail without the fix), and the explanation checker's replies. A real end-to-end run is on my demo repo: a verified draft PR I can show you."],
  ["Has one been merged yet?", "Not yet, partly on purpose: I didn't want to aim it at real projects before maintainers like you weighed in. I replayed 4 real bugs maintainers had already fixed (React, Flask, pydantic, vLLM): in 2 the maintainers' own tests pass on its fix; 2 were right but narrower, and it now names the cases it missed. If you maintain a project that wants newcomers, I'd love to try it with you watching."],
  ["What if our project bans AI pull requests?", "Then it never sends you one. It reads your contributing guide and AI policy, including your organization's default guide (that's how it knows Flask's), and a ban refuses the run before any code is written, not even a preview: AI output must not become the base for someone's fix. All that's left is Explore, to understand the code. Same when a maintainer asks for human-written work in the issue comments. Your CONTRIBUTING file is the off switch."],
  ["Why Pydantic?", "Its contributing guide says it welcomes AI help if you fully understand the code you submit. That's exactly the bar opensrcer enforces. Flask's organization closes AI PRs on sight, so opensrcer would refuse there, and now detects that wording."],
  ["Isn't this just a wrapper around Claude?", "The model writes the patch; everything around it is code the model can't skip. Before anything runs it checks the project's rules and the issue's history. The project's code and tests run in a separate throwaway machine with no keys, which can only reach package registries and GitHub. A separate step reverts the source change and reruns the tests to prove the new test catches the bug. Pushing happens outside that machine, after a secret scan, and only once a human has explained the change. \"Claude writes the code; the system decides whether it's allowed to exist.\""],
  ["Can't I just ask ChatGPT to write my 'own words'?", "You can try. Pasting the AI's own text is rejected, and vague answers are rejected; it's checked against the actual change, and you just saw a wrong one caught. It doesn't prove you understand it. It raises the bar from zero to 'you had to think about it', and then the maintainer's review is the real test, which you have to answer yourself."],
  ["So an AI grades whether you understood the AI's code?", "Yes, against the actual diff, not vibes. It's a gate, not a guarantee. The practice review and the maintainer's own review come after it."],
  ["Aren't you making it easier to send AI PRs?", "It's harder to send one through opensrcer than without it: one open PR per project, three a day, drafts only, and it refuses outright where the project says no. Anyone who wants to spam won't use this. They'll use something with no walls."],
  ["What stops people from skipping opensrcer and using Claude Code directly?", "Nothing. I can't fix the whole ecosystem. This is for the person who wants to do it right and doesn't know how yet. Your strongest tool is still one line in CONTRIBUTING.md, and opensrcer reads it."],
  ["Who's accountable when the fix is wrong?", "The person who published it: their name, their explanation, and a draft they chose to mark ready. The PR says exactly which tests ran and what wasn't tested."],
  ["Didn't you cherry-pick an easy issue?", "Yes. It's a demo, and a one-line fix fits on a slide. The honest numbers are the replays: 2 out of 4 passed the maintainers' own tests, and the other 2 were too narrow."],
  ["How does it decide an issue is open to me?", "From the issue itself and its history on GitHub: it skips anything assigned, anything with a pull request already open, and anything a maintainer says is already fixed, and it flags questions, wontfix and vague issues. Each skip comes with its reason."],
  ["What happens when a maintainer reviews the PR?", "Review comments come back to one inbox. For a code comment, it proposes the smallest change that answers it, checks it, and you push it yourself. For a question, it drafts an answer you can edit; nothing is posted until you press send."],
  ["Does it work on any project?", "Any public GitHub repository. If it can't find a test it can run, it says the fix is unverified instead of pretending. Private repositories work through an organization's GitHub App, with a short-lived token per repository."],
  ["Which model does it use?", "Claude Sonnet 5, through Claude Code, and the pull request names the model."],
  ["Why let beginners use AI at all? Shouldn't they learn?", "They do learn here: Explore to understand the code before touching it, the chat to understand the change, and they can't publish until they can explain it. The AI writes a first draft; the person has to own it."],
  ["What if the AI's fix is wrong?", "It can be. That's why it proves the fix with your tests (the new test must fail without it), says when it's unverified, makes the person explain it, and only ever opens drafts that say what was and wasn't tested."],
  ["Did you run the full suite, lint and type check?", "On this fix: Pydantic's alias-generator tests (45 pass; the new test fails without the fix), plus its own ruff lint and format checks (clean) and its pyright type check (0 errors). The full suite is what their CI runs on the draft PR, which is why Checks shows 0 and the CI box is unticked until it runs."],
  ["Does it replace our CI?", "No. It runs the project's tests in a sandbox before anyone sees the fix, but CI on the pull request is still yours."],
  ["Won't this flood maintainers with beginner PRs?", "It's built to do the opposite: one open PR per project per person, three a day, drafts only, and it skips issues someone is already working on."],
  ["Is it safe? Can it leak anything?", "Code runs in a throwaway machine with no passwords or keys that can only reach package registries and GitHub. Pushing happens separately, it scans for leaked secrets first, and nothing posts until a person confirms."],
  ["What does it cost? Can I use my Claude plan?", "Runs use your own Anthropic API key: about ten cents for a small fix like this, 40 to 50 cents on big projects, with a spend cap per run. Signing in with a Claude plan is built (on Claude's own page, so opensrcer never sees your login) but switched off until I've confirmed it with Anthropic."],
  ["What rules did it follow here?", "Pydantic's contributing guide and PR template (CONTRIBUTING.md, docs/contributing.md, .github/PULL_REQUEST_TEMPLATE.md): template followed, 3 of 3 headings; no sign-off or CLA needed; AI policy: welcomes AI help, disclosure added; no other open PR; tests verified."],
  ["What does publishing do?", "Forks the project to your account, saves exactly this patch as one commit on a new branch, and opens a draft PR with the AI disclosure. Nothing merges until you mark it ready. Afterwards it coaches: don't chase people, answer every review comment."],
  ["Does the agent use the map?", "The map is for you to understand the code. The agent works from the code itself, with tools to find a function's definition, its callers and its tests."],
  ["Can I try it?", "It's invite-only right now: sign up at opensrced.vercel.app/join and I'll let you in."],
  ["How is opensrcer itself tested?", "Unit tests, 7 browser smoke tests, a secret scan (gitleaks) and CodeQL on every change to main."],
  ["What about prompt injection in the issue text?", "The agent can't push: pushing is a separate step in another machine, after you approve. Its own machine can only reach the few services it needs, and the project's code runs in yet another machine with no keys. What it writes comes back as a diff a human reviews before anything is published. A poisoned issue can make a bad patch, not ship one."],
  ["Won't 'AI helped' in the PR just get it auto-closed?", "In projects that close AI PRs, yes, and that's correct: there it won't open one at all. Everywhere else, disclosure builds trust. Pydantic, for one, welcomes AI help when you understand the code."],
  ["Drafts push work onto me: I have to un-draft them.", "You don't. The contributor marks it ready, after CI and their own check. The draft protects you from half-finished work."],
  ["What if our tests are flaky?", "Flaky tests can fool it, the same way they fool CI. Requiring the test to fail without the fix and pass with it makes a fluke less likely, not impossible, and the PR lists exactly what ran."],
  ["What if our guide only 'discourages' AI?", "Subtle wording can get past it. That's why every PR discloses AI regardless, and it also listens to maintainers in the issue comments. If it gets your project wrong, tell me and I'll fix the rule."],
  ["What if I change our guide after the PR is opened?", "It re-checks the rules right before publishing, not just at the start. After that it's a normal PR you can close like any other."],
  ["Can it do big changes, like a refactor?", "It's built for small, well-scoped issues, and flags refactors and vague issues instead of attempting them. On purpose: small PRs are the ones you can actually review."],
  ["If the chat explains it wrong, you're teaching beginners false things.", "It can be wrong. Chat answers are labeled not verified and end with a question to check yourself. The tests are the ground truth, not the chat."],
  ["Why help contributors? Maintainers are the ones drowning.", "Because the flood starts on the contributor's side. Every PR that arrives tested, explained and following the rules is one less to triage. It's helping maintainers, one step earlier."],
  ["What did you learn from the 2 replays that failed?", "Both were right but too narrow: they fixed the reported case and missed a related one. So now it names the cases it didn't cover, in the PR, instead of letting you find them in review."],
  ["The new test is AI-written too. AI proving AI?", "The check isn't AI: it mechanically undoes the fix and reruns the test, which proves the test exercises the change. Whether it tests the right behavior is a judgment call, and that's yours in review."],
  ["What if the test is trivial, or tests the wrong thing?", "Then it can pass the fail-without, pass-with check and still be a bad test. That check proves it catches this change, not that it's good, which is why the person explains it and you still review it."],
  ["Does it reproduce the bug first?", "Yes, that's the failing test. It has to fail on the original code before the fix counts."],
  ["Your drafts will burn our CI minutes.", "By default GitHub doesn't run CI on a first-time contributor's fork PR until a maintainer approves it. Nothing runs without your say."],
  ["What if the fix needs a design discussion first?", "If the issue is labeled for discussion or your guide says discuss first, it warns the contributor and drafts an issue comment for them to post, instead of jumping to code."],
  ["Does it follow our PR template?", "Yes, it reads it. On Pydantic it filled all three headings, and left the CI box unticked because CI hadn't run."],
  ["The sandbox reaches package registries: it could install something malicious.", "Inside a throwaway machine with no keys that's discarded after. What leaves is the diff, and any dependency change is in it for a human to review."],
  ["What if the agent loops and burns money?", "Every run has a spend cap; it stops there, whatever it's in the middle of."],
  ["Is this a bot account opening PRs?", "No: the contributor's own account. They press publish, and it's their name on the commit, with a private noreply email so their real address isn't exposed."],
  ["Who owns AI-assisted code? Is it license-compatible?", "The contributor submits it under the project's license, with a sign-off where the project asks. The law on AI-generated code is unsettled, which is exactly why every PR discloses AI: the maintainer decides."],
  ["Is my code used to train anything?", "Runs use your own Anthropic API key, under Anthropic's API terms. I don't train anything."],
  ["Does the map scale to a monorepo?", "Pydantic is about seven thousand nodes and that's fine. I haven't tested something kernel-sized, so I won't claim it."],
  ["Why Claude and not an open model?", "Claude Code is the best agent harness for this today; running opensrcer yourself, ChatGPT's Codex works too. The guardrails don't depend on the model; that's the point."],
  ["How do you measure success?", "(Make it yours.) For example: not how many PRs it sends, but how many get merged that the maintainer didn't regret."],
  ["What happens when a run fails?", "It says so plainly and no PR is opened; you see where it stopped and why. A failed run beats a fake fix."],
  ["What if CI fails on the draft?", "Then it stays a draft. The contributor sees it and fixes it before marking it ready; that's exactly what drafts are for."],
  ["Can maintainers find every opensrcer PR to their repo?", "Yes: each carries an Assisted-by line and a disclosure in the description, so you can search for them."],
  ["Can I use Explore on my own repo?", "Yes: point it at any public repository and it maps it from the source, no AI, then answers questions in plain English."],
  ["Can I run it locally?", "Yes. Running opensrcer yourself, it uses the Claude Code or Codex login already on your machine."],
  ["Why would a student trust this not to embarrass them publicly?", "Nothing goes out half-baked: it must pass the tests, they must explain it, they practise a review question first, and it opens as a draft they control."],
  ["Did you use AI to build opensrcer?", "(Your honest answer.) For example: \"Yes, and I held it to the same rules: tests, review, and I can explain every part.\""],
  ["How many people use it?", "(Your honest numbers, however small.) \"It's invite-only. I wanted it right before it's big.\""],
  ["How long does a run take?", "About a minute for a small fix; bigger projects take longer, and you watch it work the whole time."],
  ["What does it need from my GitHub account?", "Public repositories, to fork and open draft PRs, and your profile, to put your name on commits. Private repositories need a separate GitHub App that an organization installs."],
  ["Where's my API key stored?", "Encrypted, in a cookie in your browser. It's not sitting in my database."],
  ["Does it only work on Python?", "No. It uses each project's own tests. The replays were React, Flask, Pydantic and vLLM. With no test it can run, it says the fix is unverified, right in the PR."],
  ["Can I tell a PR came from opensrcer?", "Always. The description says AI helped and names the model, and the commit carries an Assisted-by line."],
  ["What if two people grab the same issue?", "The second one gets skipped: it checks for open PRs on the issue, and again right before publishing."],
  ["What if the AI misreads the issue?", "A quick check runs first. If the issue is vague or isn't really a bug, it stops before the expensive run and says why."],
  ["Does it handle DCO or CLA?", "Some projects require a legal sign-off on every commit (DCO: a 'Signed-off-by' line) or a signed agreement (CLA). opensrcer reads which one a project needs and adds the sign-off where it's asked for. Pydantic needs neither."],
  ["How is this different from Devin, Sweep or Copilot Workspace?", "Those are built to do the work for you. This is built so you learn to do it, and the maintainer on the other end is protected. (Don't make claims about their features.)"],
  ["What was the hardest part to build?", "(Your story, 20 seconds.) For example: proving the fix by undoing it and rerunning the tests, or finding that Flask's ban lives in its organization's guide, not in Flask's own repository."],
  ["What's next?", "Trying it on real issues with maintainers watching. That's the only way to earn a merge honestly."],
  ["Is it open source? Will it cost money?", "(Your call: decide before the talk.) \"I haven't decided yet\" is a fine answer. Runs use your own API key today."],
  ["(If you don't know)", "\"Good question, and I don't want to guess. Find me after and we'll look at it together.\""],
];

/** What to say at each moment, in the notes window only (the tour shows the captions). Each
 *  row: how the stage caption starts, the line to say (**key words** in bold), and the detail
 *  to give only if asked. Every caption has a line and every line a caption, or this throws. */
const SAY: Array<[string, string, string?]> = [
  ["Start with the worry", "If you maintain a project, you've seen these. **Huge diffs, no tests, rules ignored**, from people who can't answer one review question."],
  ["Illustrations, but", "The problem isn't AI. It's **contributions nobody understood.**", "These four are illustrations, not real pull requests."],
  ["opensrcer helps a beginner", "opensrcer helps a beginner make the contribution a maintainer actually wants. **Tested. Explained. Follows the rules.**"],
  ["Everything from here", "I'll show you **one Pydantic issue, start to finish.** Nothing posts until you confirm.", "Real product screens; the issue and PR numbers are the demo's."],
  ["Step one", "Let's contribute to Pydantic. Step one: **find an issue that's actually open to you.**", "Pydantic welcomes AI help if you understand the code you send."],
  ["Show everything it found", "Let me show everything it found, **including what it skipped.**"],
  ["Assigned? Skip.", "Assigned? Skip. PR already open? Skip. Already fixed? Skip. **Each with the reason.** That alone saves maintainers duplicate PRs."],
  ["Back to the ready ones", "We'll take the first one: **to_pascal leaves double underscores** in the names it generates."],
  ["Before changing anything", "Before changing anything, **understand the code.**", "The map is built from the source code: no AI, nothing to install."],
  ["This is Pydantic", "This is Pydantic: **almost seven thousand pieces of code**, and how they connect.", "6,907 nodes in 330 communities, from the site's own graph builder."],
  ["Then ask the question", "So I ask, in plain English: **where is to_pascal used, and what breaks if I change it?**"],
  ["As the answer streams", "Watch the map while the answer comes in. **(Stay quiet for a moment.)**", "It zooms to to_pascal, then lights what depends on it, one and two hops out."],
  ["The answer teaches", "16 places depend on it, and it tells you what to test. **Know what your change touches before you touch it.**"],
  ["Now fix it", "Now fix it. One click starts a run, **on your own API key, in a throwaway machine.**", "About ten cents for a fix like this, with a spend cap per run."],
  ["It reads the project's rules first", "**It reads the project's rules first.** Pydantic welcomes AI help if you understand the code, and it asks for tests.", "Contribution guide, PR template, AI policy, sign-off."],
  ["Then it reads the code", "It finds the **root cause** before it writes a fix. If it can't, it says so."],
  ["This is the part maintainers", "**This is the part maintainers care about.** The bug: to_pascal turns my__field into My__Field."],
  ["Here's the change itself", "The fix: **one line.**"],
  ["In a locked box", "In a locked box, it undoes the fix and runs Pydantic's own tests. **Without the fix, the new test fails. With it, all 45 pass.**", "Locked box: no keys, it can only reach package registries and GitHub."],
  ["For maintainers who ask", "So it really catches the bug. **Judge it yourself: it's all on one screen.**", "pytest -k on the alias-generator tests: exit 1 without the fix (2 failed, 43 passed), exit 0 with it (45 passed). Ruff and pyright clean. The full suite is their CI on the draft."],
  ["It explains every change", "Now the human part. It **explains the change in plain English**, and what to double-check."],
  ["Not sure what it does?", "Not sure? **Ask the chat.** It teaches, and ends with a question to check yourself.", "Chat answers are labeled not verified."],
  ["Before you can publish", "But before you can publish, **you explain it in your own words.** Watch: this first try is wrong. It says every underscore is stripped."],
  ["The check catches it", "**It catches it.** It doesn't strip every underscore; it only collapses repeated ones. Not there yet."],
  ["So you rewrite it", "So you rewrite it, properly. **You can't publish what you can't explain.**"],
  ["Now it passes", "Now it passes. And **your words go into the PR**, so the maintainer reads your explanation, not the AI's."],
  ["Then a practice question", "Then a practice question, **the kind a maintainer would ask.** A half answer gets feedback and a follow-up."],
  ["Then you confirm", "Then you confirm you understand it, and **a human publishes.**"],
  ["It's scanned for leaked secrets", "It's checked for leaked secrets and opened **as a draft, in your name.**"],
  ["Every GitHub step", "**Every GitHub step, done right**: your fork, its own branch, a description that closes the issue."],
  ["The description shows", "It shows **the tests it ran, and the result.**"],
  ["And it discloses itself", "And it says plainly **that AI helped**: which model, what was and wasn't tested."],
  ["It stays a draft", "It stays a draft until you mark it ready. **The maintainer always knows.**"],
  ["Not every project wants AI help", "Not every project wants AI help. **Flask closes AI pull requests on sight.** So on Flask, it refuses before writing a single line. Not even a preview.", "The rule is in Pallets' organization-wide CONTRIBUTING.md. All that's left is Explore."],
  ["And it listens to maintainers", "It even listens to maintainers in the comments. **A maintainer asked for human-written work, so it won't write code for that issue.**", "A real issue on a major project; who and where stay private."],
  ["Back to where we started", "Back to where we started: **what slop is made of.**"],
  ["The heart of it", "Nobody asked for it, can't explain it, untested: **you just watched it handle each one.**"],
  ["And it can't flood you", "And it can't flood you: **one open PR per project, three a day, drafts only.**"],
  ["It's built to make better", "Not more pull requests. **Better ones.** Thank you. **(Then stop talking.)**"],
];
const sayFor = (text: string) => SAY.find(([from]) => text.startsWith(from));
for (const { chapter } of STEPS) for (const c of chapter.captions) if (!sayFor(c.text)) throw new Error(`No spoken line for the caption "${c.text.slice(0, 60)}"`);
for (const [from] of SAY) if (!STEPS.some(({ chapter }) => chapter.captions.some((c) => c.text.startsWith(from)))) throw new Error(`Spoken line matches no caption: "${from}"`);

/** A spoken line with its **key words** set in bold. */
function Said({ text }: { text: string }) {
  return <>{text.split("**").map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-signal">{part}</strong> : part))}</>;
}

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
    : state.waiting?.kind === "beat" ? `Next screen: ${chapter!.headlines?.find((h) => h.at > state.local)?.text || chapter!.captions.find((c) => c.at > state.local)?.text.split(/(?<=[.:?!])\s/)[0] || "continue"}`
    : "Playing… (→ skips ahead to the next step)";

  return (
    <div data-stage-root="" className="mx-auto flex min-h-dvh w-full max-w-[900px] flex-col gap-5 px-5 py-6">
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
                const [, say, detail] = sayFor(c.text)!;
                // The line you're on, big; the rest small, so the eye lands in one place.
                return current ? (
                  <li key={`${c.at}:${c.text}`} className="border-l-4 border-signal py-1 pl-4">
                    <p className="text-[27px] leading-[1.3] text-paper"><Said text={say} /></p>
                    {detail && <p className="mt-2 text-[15px] leading-snug text-paper-muted">If asked: {detail}</p>}
                  </li>
                ) : (
                  <li key={`${c.at}:${c.text}`} className={cn("pl-5 text-[15px] leading-snug", past ? "text-paper-faint" : "text-paper-dim")}>{say.replace(/\*\*/g, "")}</li>
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
        <summary className="cursor-pointer font-medium">If asked: questions and answers</summary>
        <dl className="mt-3 space-y-3">
          {IF_ASKED.map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold text-paper">{q}</dt>
              <dd className="mt-0.5 text-paper-dim">{a}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
