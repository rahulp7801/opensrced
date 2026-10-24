"use client";

// The product tour player: a walkthrough of the whole product, with captions,
// chapters, scrubbing, speed and a fullscreen presenter mode. Two modes:
// "Click through" (the default) pauses at every scripted click for the visitor
// to make it, and the mock app's menus navigate; "Watch" plays on its own
// (/demo?watch opens straight into it).
//
// One clock drives everything. Tour time `t` advances by real elapsed time
// times the playback speed; each chapter view renders its frame from its local
// time (components/tour/kit.tsx), so pausing, seeking and replaying are exact.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowCounterClockwise, ArrowRight, CornersIn, CornersOut, HandPointing, Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CHAPTERS, STARTS, TOTAL } from "./chapters";
import { ACTS, InteractContext, TimeContext, progress, type Interact } from "./kit";
import { RUN } from "./data";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

/** The stage is drawn at this size and scaled to the room it has, like a slide,
 *  so it stays crisp and readable from a laptop to a projector. Narrower than
 *  MIN_SCALED_WIDTH (phones, small tablets) it lays out responsively instead. */
const DESIGN = { width: 1180, height: 620 };
const MIN_SCALED_WIDTH = 900;
/** Filling a short window would shrink the slide; below this scale the page
 *  keeps the stage at full size and scrolls instead. */
const MIN_FILL_SCALE = 0.95;

/** Where Watch mode's cursor waits before its first trip, on the design canvas. */
const CURSOR_HOME = { x: DESIGN.width * 0.78, y: DESIGN.height * 0.82 };

/** Watch mode's pointer. It glides to each button the tour is about to press and
 *  clicks it, so an audience sees what is being done, not only what changed. The
 *  buttons announce themselves (kit.tsx Press, data-cursor), so it simply follows
 *  the tour's clock: pausing, scrubbing and speed changes all keep it exact. */
function WatchCursor({ canvasRef, zoom }: { canvasRef: RefObject<HTMLDivElement | null>; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useRef({ ...CURSOR_HOME });
  const trip = useRef<{ to: Element; from: { x: number; y: number } } | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const cursor = ref.current;
    if (!canvas || !cursor) return;
    const target = canvas.querySelector("[data-cursor]");
    if (target && target.getClientRects().length > 0) {
      if (trip.current?.to !== target) trip.current = { to: target, from: { ...pos.current } };
      const box = canvas.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const to = { x: (r.left + r.width / 2 - box.left) / zoom, y: (r.top + r.height / 2 - box.top) / zoom };
      const p = Number(target.getAttribute("data-cursor-p") ?? 1);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(2 - 2 * p, 2) / 2;
      const from = trip.current.from;
      pos.current = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
      cursor.dataset.state = target.getAttribute("data-cursor") ?? "move";
    } else {
      trip.current = null;
      cursor.dataset.state = "idle";
    }
    cursor.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`;
  });
  return (
    <div ref={ref} aria-hidden className="group pointer-events-none absolute left-0 top-0 z-20 transition-transform duration-75 ease-linear" style={{ transform: `translate(${CURSOR_HOME.x}px, ${CURSOR_HOME.y}px)` }}>
      <span className="absolute -left-3 -top-3 size-6 rounded-full bg-signal/30 opacity-0 group-data-[state=click]:animate-ping group-data-[state=click]:opacity-100 motion-reduce:animate-none" />
      <svg width="22" height="22" viewBox="0 0 22 22" className="relative -translate-x-[3px] -translate-y-[2px] drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)] transition-transform duration-100 group-data-[state=click]:scale-90">
        <path d="M3 2 L3 18 L7.5 13.8 L10.6 20.2 L13.4 18.9 L10.4 12.6 L16.6 12.4 Z" fill="#1d1d1f" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Where the tour is, act by act: a segmented bar that is also a way to jump. */
function ActBar({ t, onJump }: { t: number; onJump: (chapter: number) => void }) {
  return (
    <div role="group" aria-label="Tour acts" className="mb-2 flex gap-1.5">
      {ACTS.map((act) => {
        const first = CHAPTERS.findIndex((c) => c.act === act);
        const last = CHAPTERS.length - 1 - [...CHAPTERS].reverse().findIndex((c) => c.act === act);
        const start = STARTS[first];
        const end = STARTS[last] + CHAPTERS[last].duration;
        const current = t >= start && (t < end || last === CHAPTERS.length - 1);
        return (
          <button key={act} type="button" onClick={() => onJump(first)} aria-label={`${act}: jump to ${CHAPTERS[first].label}`} style={{ flexGrow: end - start }} className="group min-h-7 min-w-0 basis-0 text-left">
            <span className={cn("block truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors", current ? "text-signal max-sm:overflow-visible" : "text-paper-muted group-hover:text-paper max-sm:invisible")}>{act}</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-signal transition-[width] duration-150 ease-linear" style={{ width: `${progress(t, start, end) * 100}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

type Mode = "try" | "watch";
/** What a click-through tour is paused on: a scripted click, or the end of a chapter. */
type Waiting = { kind: "press"; at: number; label: string } | { kind: "next" };
const TICK_MS = 50;

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function chapterAt(t: number): number {
  let i = 0;
  while (i + 1 < STARTS.length && t >= STARTS[i + 1]) i++;
  return i;
}

export function ProductTour({ inviteOnly }: { inviteOnly: boolean }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  // Zoom for the stage's design canvas; null while it lays out responsively.
  const [scale, setScale] = useState<number | null>(null);
  // Height that fills the window below the page title, on screens big enough to present from.
  const [fillHeight, setFillHeight] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [mode, setMode] = useState<Mode>("try");
  // The start screen, until the visitor picks a way in (or ?watch skips it).
  const [cover, setCover] = useState(true);
  const coverRef = useRef(true);
  const [waiting, setWaitingState] = useState<Waiting | null>(null);
  // Refs mirror mode and waiting for the clock, which must stop the moment a
  // click comes due, before React gets round to re-rendering.
  const modeRef = useRef<Mode>("try");
  const waitingRef = useRef<Waiting | null>(null);
  // Clicks already made in the current chapter, as "chapter:at".
  const done = useRef(new Set<string>());
  // Set when the visitor acts from inside the stage: the next button asked for takes focus.
  const refocus = useRef(false);
  const nextRef = useRef<HTMLButtonElement>(null);
  const tRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null); // the room the stage has
  const canvasRef = useRef<HTMLDivElement>(null); // the app window drawn in it
  const screenRef = useRef<HTMLDivElement>(null); // stage, captions and controls
  const started = useRef(false);

  const index = chapterAt(t);
  const chapter = CHAPTERS[index];
  const local = t - STARTS[index];
  const caption = [...chapter.captions].reverse().find((c) => local >= c.at) ?? chapter.captions[0];
  const ended = t >= TOTAL;
  const nextChapter = CHAPTERS[index + 1];

  const setWaiting = useCallback((w: Waiting | null) => {
    waitingRef.current = w;
    setWaitingState(w);
  }, []);

  /** The visitor has started the tour, by any route: the start screen goes. */
  const begin = useCallback(() => {
    started.current = true;
    coverRef.current = false;
    setCover(false);
  }, []);

  const seek = useCallback((next: number) => {
    const clamped = Math.min(TOTAL, Math.max(0, next));
    tRef.current = clamped;
    setT(clamped);
    // Moving through the tour starts its clicks afresh.
    done.current.clear();
    setWaiting(null);
  }, [setWaiting]);

  // The clock. Time is measured, not counted in ticks, so a slow frame never
  // slows the tour down; it only skips ahead a little.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      let next = Math.min(TOTAL, tRef.current + (now - last) * speed);
      last = now;
      if (waitingRef.current) return;
      // Click-through mode holds the last frame of each chapter until the visitor moves on.
      const i = chapterAt(tRef.current);
      if (modeRef.current === "try" && i + 1 < CHAPTERS.length && next >= STARTS[i + 1] - 1) {
        next = STARTS[i + 1] - 1;
        setWaiting({ kind: "next" });
        setPlaying(false);
      }
      tRef.current = next;
      setT(next);
      if (next >= TOTAL) setPlaying(false);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, speed, setWaiting]);

  // With ?watch (the presenter link) there is no start screen: the tour starts
  // once the stage is in view, unless the visitor prefers reduced motion.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (started.current || coverRef.current || !entries.some((e) => e.isIntersecting)) return;
      started.current = true;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
    }, { threshold: 0.5 });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // A hidden tab would otherwise come back minutes later in the tour.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const sync = () => {
      setCanFullscreen(Boolean(document.fullscreenEnabled));
      setFullscreen(document.fullscreenElement === rootRef.current && rootRef.current !== null);
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const goTo = useCallback((i: number) => {
    begin();
    seek(STARTS[Math.min(CHAPTERS.length - 1, Math.max(0, i))]);
  }, [seek, begin]);

  /** A keyboard visitor working inside the stage keeps their place: the button they used
   *  is about to disappear, so focus waits on the stage and moves to the next button asked for. */
  const holdFocus = useCallback(() => {
    const canvas = canvasRef.current;
    refocus.current = Boolean(canvas?.contains(document.activeElement));
    if (refocus.current) canvas?.focus({ preventScroll: true });
  }, []);

  /** Do what the click-through tour is waiting for: the click, or the next chapter. */
  const step = useCallback(() => {
    const w = waitingRef.current;
    if (!w) return;
    begin();
    holdFocus();
    if (w.kind === "press") {
      done.current.add(`${chapterAt(tRef.current)}:${w.at}`);
      setWaiting(null);
    } else {
      goTo(chapterAt(tRef.current) + 1);
    }
    setPlaying(true);
  }, [goTo, setWaiting, holdFocus, begin]);

  const togglePlay = useCallback(() => {
    begin();
    if (waitingRef.current) return step();
    if (tRef.current >= TOTAL) seek(0);
    setPlaying((p) => !p || tRef.current >= TOTAL);
  }, [seek, step, begin]);

  const changeMode = useCallback((m: Mode) => {
    modeRef.current = m;
    setMode(m);
    done.current.clear();
    // Watching picks up from wherever the visitor stopped.
    if (m === "watch" && waitingRef.current) {
      setWaiting(null);
      setPlaying(true);
    }
  }, [setWaiting]);

  // /demo?watch opens in Watch mode and ?speed=0.75 (any listed speed) sets the
  // starting speed, so a presenter can bookmark exactly the tour they want.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("watch")) {
      changeMode("watch");
      coverRef.current = false;
      setCover(false);
    }
    const asked = Number(params.get("speed"));
    const listed = SPEEDS.find((s) => s === asked);
    if (listed) setSpeed(listed);
  }, [changeMode]);

  // Fill the window below the page title when the slide would still be near full
  // size there. The captions and controls take the same height in either layout,
  // so what is left for the stage is measured, not guessed.
  useEffect(() => {
    const measure = () => {
      const screen = screenRef.current;
      const stage = stageRef.current;
      if (!screen || !stage) return;
      const top = screen.getBoundingClientRect().top + window.scrollY;
      const height = Math.floor(window.innerHeight - top - 12);
      const room = height - (screen.offsetHeight - stage.offsetHeight);
      setFillHeight(window.innerWidth >= 1024 && room / DESIGN.height >= MIN_FILL_SCALE ? height : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Scale the design canvas to the stage's room, whatever decides that room
  // (the window, full screen, or the fixed height on smaller screens).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(width >= MIN_SCALED_WIDTH ? Math.min(width / DESIGN.width, height / DESIGN.height) : null);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const interact = useMemo<Interact | null>(() => mode !== "try" ? null : {
    waitingAt: waiting?.kind === "press" ? waiting.at : null,
    reach: (at, label) => {
      if (modeRef.current !== "try" || waitingRef.current || done.current.has(`${chapterAt(tRef.current)}:${at}`)) return;
      setWaiting({ kind: "press", at, label });
      setPlaying(false);
    },
    press: step,
    open: (id) => {
      const i = CHAPTERS.findIndex((c) => c.id === id);
      if (i < 0) return;
      holdFocus();
      goTo(i);
      setPlaying(true);
    },
    claimFocus: () => {
      const claimed = refocus.current;
      refocus.current = false;
      return claimed;
    },
  }, [mode, waiting, step, goTo, setWaiting, holdFocus]);

  useEffect(() => {
    if (waiting?.kind === "next" && refocus.current) {
      refocus.current = false;
      nextRef.current?.focus({ preventScroll: true });
    }
  }, [waiting]);

  const previous = useCallback(() => {
    const i = chapterAt(tRef.current);
    // Like a media player: the first press restarts the chapter.
    goTo(tRef.current - STARTS[i] > 1500 ? i : i - 1);
  }, [goTo]);

  const next = useCallback(() => goTo(chapterAt(tRef.current) + 1), [goTo]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  /** The start screen's ways in: watch, click through, or present (watch, full screen). */
  const start = useCallback((m: Mode, present = false) => {
    changeMode(m);
    begin();
    if (present) toggleFullscreen();
    setPlaying(true);
  }, [changeMode, begin, toggleFullscreen]);

  const replay = useCallback(() => {
    begin();
    seek(0);
    setPlaying(true);
  }, [begin, seek]);

  // Keyboard: only when focus is on the page or inside the tour, never while typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const inTour = !active || active === document.body || rootRef.current?.contains(active);
      if (!inTour || (active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && !(active instanceof HTMLInputElement && active.type === "range")))) return;
      if (event.key === " " || event.key === "k") {
        if (active instanceof HTMLButtonElement) return; // the button handles its own Space
        event.preventDefault(); togglePlay();
      } else if (event.key === "ArrowRight" && !(active instanceof HTMLInputElement)) { event.preventDefault(); next(); }
      else if (event.key === "ArrowLeft" && !(active instanceof HTMLInputElement)) { event.preventDefault(); previous(); }
      else if (event.key === "f" && canFullscreen) { event.preventDefault(); toggleFullscreen(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, next, previous, toggleFullscreen, canFullscreen]);

  const View = chapter.View;
  const controlBtn = "grid size-10 shrink-0 place-items-center rounded-full text-paper transition hover:bg-surface-3 active:scale-95";

  // In fill and full-screen layouts the stage takes whatever height is left, so
  // the caption box keeps a fixed height: a longer caption must not resize the slide.
  const framed = fullscreen || fillHeight !== null;

  return (
    <div ref={rootRef} className={cn("bg-ink", fullscreen && "flex h-screen flex-col overflow-hidden p-4 sm:p-6")}>
      <section aria-label="Product tour" className={cn("mx-auto w-full", fullscreen && "flex min-h-0 flex-1 flex-col")}>
        <div ref={screenRef} className={cn(framed && "flex min-h-0 flex-col", fullscreen && "flex-1")} style={!fullscreen && fillHeight ? { height: fillHeight } : undefined}>
          <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2", fullscreen && "hidden")}>
            <p className="text-[13px] text-paper-muted">
              {mode === "try" ? "Your turn at every step: click the highlighted button, or use the app's menus to jump around." : "Sit back: the tour plays on its own."}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <div role="group" aria-label="Tour mode" className="inline-flex rounded-full border border-border bg-surface p-0.5 text-[13px]">
                {([["try", "Click through"], ["watch", "Watch"]] as const).map(([m, name]) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => changeMode(m)} className={cn("min-h-8 rounded-full px-3.5 transition", mode === m ? "bg-paper font-medium text-surface" : "text-paper-dim hover:text-paper")}>
                    {name}
                  </button>
                ))}
              </div>
              {canFullscreen && (
                <button type="button" onClick={toggleFullscreen} title={fullscreen ? "Exit full screen (F)" : "Present full screen (F)"} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-paper transition hover:border-border-strong">
                  {fullscreen ? <CornersIn aria-hidden size={16} weight="bold" /> : <CornersOut aria-hidden size={16} weight="bold" />}
                  {fullscreen ? <>Exit presenter mode</> : <>Presenter mode<span className="sr-only"> (full screen)</span></>}
                </button>
              )}
            </div>
          </div>

          <ActBar t={t} onJump={goTo} />

          {/* The stage: the app, drawn on a fixed-size canvas scaled to fit. While watching it is
              a picture, and screen readers get the captions below, which narrate it; in
              click-through mode it is the visitor's to use. */}
          <div ref={stageRef} className={cn("relative flex items-center justify-center", framed ? "min-h-0 flex-1" : "h-[560px] sm:h-[600px] lg:h-[620px]")}>
            <div
              ref={canvasRef}
              aria-hidden={mode === "watch" ? true : undefined}
              role={mode === "try" ? "region" : undefined}
              aria-label={mode === "try" ? "The opensrcer app (demo)" : undefined}
              tabIndex={mode === "try" ? -1 : undefined}
              style={scale ? { width: DESIGN.width, height: DESIGN.height, zoom: scale } : undefined}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-[20px] border border-border-soft bg-surface shadow-[0_2px_4px_rgb(0_0_0/0.03),0_40px_100px_-30px_rgb(0_0_0/0.22)] outline-none sm:rounded-[26px]",
                !scale && "h-full w-full",
              )}
            >
              <InteractContext.Provider value={interact}>
                <TimeContext.Provider value={local}>
                  <div key={chapter.id} className="h-full animate-fade-rise motion-reduce:animate-none">
                    <View />
                  </div>
                </TimeContext.Provider>
              </InteractContext.Provider>
              {!cover && !ended && index > 0 && progress(local, 200, 600) * (1 - progress(local, 3600, 4100)) > 0 && (
                // The chapter's name, on the stage as it begins, for an audience that can't see the list.
                <div aria-hidden className="pointer-events-none absolute bottom-5 left-5 z-10 rounded-2xl bg-paper/90 px-4 py-2.5 text-surface shadow-[0_10px_30px_-10px_rgb(0_0_0/0.45)]" style={{ opacity: progress(local, 200, 600) * (1 - progress(local, 3600, 4100)), transform: `translateY(${(1 - progress(local, 200, 600)) * 10}px)` }}>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-surface/75">{chapter.act} · {index + 1} of {CHAPTERS.length}</p>
                  <p className="text-[16px] font-semibold tracking-[-0.01em]">{chapter.title}</p>
                </div>
              )}
              {mode === "watch" && !cover && !ended && <WatchCursor canvasRef={canvasRef} zoom={scale ?? 1} />}
              {waiting?.kind === "press" && (
                // In sight even when the captions are below the fold; the captions announce it to screen readers.
                <div aria-hidden className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 animate-fade-rise whitespace-nowrap rounded-full bg-signal px-4 py-1.5 text-[13.5px] font-medium text-white shadow-[0_8px_24px_-6px_rgb(0_86_173/0.55)] motion-reduce:animate-none">
                  Your turn: click “{waiting.label}”
                </div>
              )}
              {waiting?.kind === "next" && nextChapter && (
                <button ref={nextRef} type="button" onClick={step} className="absolute bottom-4 right-4 z-10 inline-flex min-h-10 animate-fade-rise items-center gap-2 rounded-full bg-signal px-4 text-[13.5px] font-medium text-white shadow-[0_8px_24px_-6px_rgb(0_86_173/0.55)] transition hover:brightness-110 motion-reduce:animate-none">
                  Next: {nextChapter.label} <ArrowRight aria-hidden size={15} weight="bold" />
                </button>
              )}
            </div>
            {cover && (
              <div className="absolute inset-0 z-30 flex items-center justify-center rounded-[20px] bg-ink/60 backdrop-blur-[6px] sm:rounded-[26px]">
                <div style={{ zoom: scale ?? 1 }} className="mx-4 w-full max-w-[620px] animate-fade-rise rounded-[28px] border border-border-soft bg-surface px-7 py-8 text-center shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] motion-reduce:animate-none sm:px-10">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-signal">Product tour · about {Math.round(TOTAL / 60000)} minutes</p>
                  <h2 className="display mt-3 text-[30px] leading-[1.05] text-paper sm:text-[36px]">Watch an issue become a pull request.</h2>
                  <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-6 text-paper-muted">Follow one real issue from bug report to draft pull request, then see everything else opensrcer does.</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <button type="button" onClick={() => start("watch")} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-signal px-5 text-[15px] font-medium text-white transition hover:brightness-110">
                      <Play aria-hidden size={16} weight="fill" />Watch the tour
                    </button>
                    <button type="button" onClick={() => start("try")} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-[15px] font-medium text-paper transition hover:border-border-strong">
                      <HandPointing aria-hidden size={17} weight="fill" />Click through it yourself
                    </button>
                  </div>
                  {canFullscreen && (
                    <button type="button" onClick={() => start("watch", true)} className="mt-4 inline-flex min-h-8 items-center gap-1.5 text-[14px] font-medium text-signal underline-offset-4 hover:underline">
                      <CornersOut aria-hidden size={15} weight="bold" />Present full screen
                    </button>
                  )}
                  <p className="mt-4 hidden text-[12px] text-paper-muted sm:block">Space plays and pauses · ← → change chapter{canFullscreen ? " · F presents" : ""}</p>
                </div>
              </div>
            )}
            {ended && !cover && (
              <div className="absolute inset-0 z-30 flex items-center justify-center rounded-[20px] bg-ink/55 backdrop-blur-[4px] sm:rounded-[26px]">
                <div style={{ zoom: scale ?? 1 }} className="mx-4 w-full max-w-[600px] animate-fade-rise rounded-[28px] border border-border-soft bg-surface px-7 py-8 text-center shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] motion-reduce:animate-none sm:px-10">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-signal">That&apos;s the tour</p>
                  <h2 className="display mt-3 text-[30px] leading-[1.05] text-paper sm:text-[34px]">Issues in. Pull requests out.</h2>
                  <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-6 text-paper-muted">One real issue, {RUN.seconds} seconds of agent time, {Math.round(RUN.cost * 100)} cents, and a draft pull request you review line by line.</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link href="/login" className="inline-flex min-h-11 items-center rounded-full bg-signal px-5 text-[15px] font-medium text-white transition hover:brightness-110">{inviteOnly ? "Have an invite? Sign in" : "Connect GitHub"}</Link>
                    <button type="button" onClick={replay} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-[15px] font-medium text-paper transition hover:border-border-strong">
                      <ArrowCounterClockwise aria-hidden size={16} weight="bold" />Watch again
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Captions */}
          <div className={cn("mt-4 px-1", fullscreen ? "h-[124px] shrink-0 overflow-hidden [@media(min-height:900px)]:h-[150px]" : "min-h-[92px] sm:min-h-[84px] lg:h-[132px] lg:shrink-0 lg:overflow-hidden")}>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
              <span className="font-semibold text-signal">{String(index + 1).padStart(2, "0")} · {chapter.title}</span>
              <span className="text-paper-muted">{chapter.source}</span>
            </p>
            <p key={caption.text} aria-live="polite" className={cn("mt-1.5 max-w-[68ch] animate-fade-rise text-[17px] leading-[1.45] text-paper motion-reduce:animate-none sm:text-[19px]", fullscreen && "max-w-none text-[22px] sm:text-[26px]")}>
              {caption.text}
            </p>
            <p aria-live="polite" className="mt-2 flex min-h-6 items-center gap-2 text-[14px] font-medium text-signal">
              {waiting && <HandPointing aria-hidden size={17} weight="fill" className="shrink-0" />}
              {waiting?.kind === "press" && <span>Your turn: click <strong className="font-semibold">“{waiting.label}”</strong></span>}
              {waiting?.kind === "next" && nextChapter && <span>Next up: <strong className="font-semibold">{nextChapter.title}</strong></span>}
            </p>
          </div>

          {/* Controls */}
          <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl border border-border-soft bg-surface px-2 py-2 sm:px-3">
            <button type="button" onClick={previous} aria-label="Previous chapter" title="Previous chapter (←)" className={controlBtn}><SkipBack aria-hidden size={18} weight="fill" /></button>
            <button type="button" onClick={togglePlay} aria-label={waiting ? "Continue" : ended ? "Replay the tour" : playing ? "Pause" : "Play"} title={waiting ? "Continue (Space)" : ended ? "Replay" : playing ? "Pause (Space)" : "Play (Space)"} className={cn(controlBtn, "size-11 bg-paper text-surface hover:bg-paper-2")}>
              {waiting ? <ArrowRight aria-hidden size={18} weight="bold" /> : ended ? <ArrowCounterClockwise aria-hidden size={18} weight="bold" /> : playing ? <Pause aria-hidden size={18} weight="fill" /> : <Play aria-hidden size={18} weight="fill" />}
            </button>
            <button type="button" onClick={next} disabled={index === CHAPTERS.length - 1} aria-label="Next chapter" title="Next chapter (→)" className={cn(controlBtn, "disabled:opacity-35")}><SkipForward aria-hidden size={18} weight="fill" /></button>
            {fullscreen && (
              <select aria-label="Chapter" value={index} onChange={(e) => goTo(Number(e.target.value))} className="h-10 max-w-[230px] rounded-full border border-border bg-surface px-3 text-[13px] text-paper">
                {CHAPTERS.map((c, i) => <option key={c.id} value={i}>{String(i + 1).padStart(2, "0")} · {c.label}</option>)}
              </select>
            )}
            <label className="flex min-w-[160px] flex-1 items-center gap-3 px-1">
              <span className="sr-only">Tour position</span>
              <input
                type="range"
                min={0}
                max={TOTAL}
                step={250}
                value={Math.round(t)}
                onChange={(e) => { begin(); seek(Number(e.target.value)); }}
                aria-valuetext={`${clock(t)} of ${clock(TOTAL)}, ${chapter.title}`}
                className="h-6 w-full cursor-pointer accent-[var(--color-signal)]"
              />
              <span className="w-[86px] shrink-0 text-right font-mono text-[12px] tabular-nums text-paper-muted">{clock(t)} / {clock(TOTAL)}</span>
            </label>
            <button type="button" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label={`Playback speed ${speed} times`} title="Playback speed" className="h-10 min-w-14 rounded-full px-3 font-mono text-[12.5px] font-semibold text-paper transition hover:bg-surface-3">{speed}×</button>
            {fullscreen && (
              <>
                <div role="group" aria-label="Tour mode" className="inline-flex rounded-full border border-border bg-surface p-0.5 text-[13px]">
                  {([["try", "Click through"], ["watch", "Watch"]] as const).map(([m, name]) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => changeMode(m)} className={cn("min-h-8 rounded-full px-3.5 transition", mode === m ? "bg-paper font-medium text-surface" : "text-paper-dim hover:text-paper")}>
                      {name}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={toggleFullscreen} title="Exit full screen (F)" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-paper transition hover:border-border-strong">
                  <CornersIn aria-hidden size={16} weight="bold" />Exit presenter mode
                </button>
              </>
            )}
          </div>
        </div>

        {/* Chapters */}
        <nav aria-label="Tour chapters" className={cn("mt-4", fullscreen && "hidden")}>
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {ACTS.map((act) => (
              <div key={act}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-paper-muted">{act}</p>
                <ol className="space-y-1.5">
                  {CHAPTERS.map((c, i) => {
                    if (c.act !== act) return null;
                    const done = i < index;
                    const current = i === index;
                    const fill = current ? (local / c.duration) * 100 : done ? 100 : 0;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => goTo(i)}
                          aria-current={current ? "step" : undefined}
                          className={cn("relative flex w-full items-baseline gap-2.5 overflow-hidden rounded-xl border px-3 py-2 text-left transition", current ? "border-signal/40 bg-surface" : "border-border-soft bg-surface/60 hover:border-border hover:bg-surface")}
                        >
                          <span className="font-mono text-[10.5px] text-paper-muted">{String(i + 1).padStart(2, "0")}</span>
                          <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", current ? "font-semibold text-paper" : "text-paper-dim")}>{c.label}</span>
                          <span className="font-mono text-[10.5px] text-paper-faint">{clock(c.duration)}</span>
                          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-3">
                            <span className="block h-full bg-signal transition-[width] duration-150 ease-linear" style={{ width: `${fill}%` }} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-paper-muted">
            Keyboard: <kbd className="font-mono">Space</kbd> {mode === "try" ? "play, pause or continue" : "play or pause"} · <kbd className="font-mono">←</kbd> <kbd className="font-mono">→</kbd> chapters{canFullscreen ? <> · <kbd className="font-mono">F</kbd> presenter mode</> : null}
          </p>
        </nav>
      </section>

      {!fullscreen && (
        <>
          <details className="mx-auto mt-10 w-full max-w-[1180px] rounded-2xl border border-border-soft bg-surface px-5 py-4">
            <summary className="cursor-pointer text-[15px] font-medium text-paper">Read the tour as text</summary>
            <ol className="mt-4 space-y-5">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <h3 className="text-[14px] font-semibold text-paper">{String(i + 1).padStart(2, "0")} · {c.title}</h3>
                  <p className="text-[12px] text-paper-muted">{c.source}</p>
                  {c.captions.map((cap) => <p key={`${cap.at}:${cap.text}`} className="mt-1.5 max-w-[75ch] text-[14px] leading-6 text-paper-dim">{cap.text}</p>)}
                </li>
              ))}
            </ol>
          </details>

          <section aria-label="Next steps" className="mx-auto mt-10 flex w-full max-w-[1180px] flex-col gap-5 border-t border-border py-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-paper">{inviteOnly ? "opensrcer is in private preview." : "Ready to try it on a real repository?"}</h2>
              <p className="mt-1 text-[14px] text-paper-muted">{inviteOnly ? "Invited accounts can sign in now. Everyone else, it's coming soon." : "Connect GitHub, add your provider key, and review every change before it ships."}</p>
            </div>
            <div className="flex shrink-0 items-center gap-6">
              <Link href="/" className="text-[15px] text-paper-muted transition hover:text-paper">{inviteOnly ? "Back to home" : "How it works"}</Link>
              <Link href="/login" className="btn-primary min-h-11 px-5 text-[15px]">{inviteOnly ? "Have an invite? Sign in" : "Connect GitHub"}</Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
