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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowCounterClockwise, ArrowRight, CornersIn, CornersOut, HandPointing, Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CHAPTERS, STARTS, TOTAL } from "./chapters";
import { ACTS, InteractContext, TimeContext, type Interact } from "./kit";

const SPEEDS = [1, 1.5, 2] as const;

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
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [mode, setMode] = useState<Mode>("try");
  const [waiting, setWaitingState] = useState<Waiting | null>(null);
  // Refs mirror mode and waiting for the clock, which must stop the moment a
  // click comes due, before React gets round to re-rendering.
  const modeRef = useRef<Mode>("try");
  const waitingRef = useRef<Waiting | null>(null);
  // Clicks already made in the current chapter, as "chapter:at".
  const done = useRef(new Set<string>());
  const tRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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

  // Start once the stage is first in view, unless the visitor prefers reduced
  // motion: then the tour waits for Play.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (started.current || !entries.some((e) => e.isIntersecting)) return;
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
    started.current = true;
    seek(STARTS[Math.min(CHAPTERS.length - 1, Math.max(0, i))]);
  }, [seek]);

  /** Do what the click-through tour is waiting for: the click, or the next chapter. */
  const step = useCallback(() => {
    const w = waitingRef.current;
    if (!w) return;
    started.current = true;
    if (w.kind === "press") {
      done.current.add(`${chapterAt(tRef.current)}:${w.at}`);
      setWaiting(null);
    } else {
      goTo(chapterAt(tRef.current) + 1);
    }
    setPlaying(true);
  }, [goTo, setWaiting]);

  const togglePlay = useCallback(() => {
    started.current = true;
    if (waitingRef.current) return step();
    if (tRef.current >= TOTAL) seek(0);
    setPlaying((p) => !p || tRef.current >= TOTAL);
  }, [seek, step]);

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

  // /demo?watch opens in Watch mode, for presenting.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("watch")) changeMode("watch");
  }, [changeMode]);

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
      goTo(i);
      setPlaying(true);
    },
  }, [mode, waiting, step, goTo, setWaiting]);

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

  return (
    <div ref={rootRef} className={cn("bg-ink", fullscreen && "flex h-screen flex-col overflow-hidden p-4 sm:p-6")}>
      <section aria-label="Product tour" className={cn("mx-auto w-full", fullscreen ? "flex min-h-0 max-w-none flex-1 flex-col" : "max-w-[1180px]")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-[13px] text-paper-muted">
            {mode === "try" ? "Your turn at every step: click the highlighted button, or use the app's menus to jump around." : "Sit back: the tour plays on its own."}
          </p>
          <div role="group" aria-label="Tour mode" className="inline-flex shrink-0 rounded-full border border-border bg-surface p-0.5 text-[13px]">
            {([["try", "Click through"], ["watch", "Watch"]] as const).map(([m, name]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => changeMode(m)} className={cn("min-h-8 rounded-full px-3.5 transition", mode === m ? "bg-paper font-medium text-surface" : "text-paper-dim hover:text-paper")}>
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* The stage: the app, drawn. While watching it is a picture, and screen readers get the
            captions below, which narrate it; in click-through mode it is the visitor's to use. */}
        <div
          ref={stageRef}
          aria-hidden={mode === "watch" ? true : undefined}
          role={mode === "try" ? "region" : undefined}
          aria-label={mode === "try" ? "The opensrcer app (demo)" : undefined}
          className={cn(
            "relative overflow-hidden rounded-[20px] border border-border-soft bg-surface shadow-[0_2px_4px_rgb(0_0_0/0.03),0_40px_100px_-30px_rgb(0_0_0/0.22)] sm:rounded-[26px]",
            fullscreen ? "min-h-0 flex-1" : "h-[560px] sm:h-[600px] lg:h-[620px]",
          )}
        >
          <InteractContext.Provider value={interact}>
            <TimeContext.Provider value={local}>
              <div key={chapter.id} className="h-full animate-fade-rise motion-reduce:animate-none">
                <View />
              </div>
            </TimeContext.Provider>
          </InteractContext.Provider>
          {waiting?.kind === "next" && nextChapter && (
            <button type="button" onClick={step} className="absolute bottom-4 right-4 z-10 inline-flex min-h-10 animate-fade-rise items-center gap-2 rounded-full bg-signal px-4 text-[13.5px] font-medium text-white shadow-[0_8px_24px_-6px_rgb(0_86_173/0.55)] transition hover:brightness-110 motion-reduce:animate-none">
              Next: {nextChapter.label} <ArrowRight aria-hidden size={15} weight="bold" />
            </button>
          )}
        </div>

        {/* Captions */}
        <div className={cn("mt-5 min-h-[92px] px-1 sm:min-h-[84px]", fullscreen && "mt-4 min-h-[110px]")}>
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
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl border border-border-soft bg-surface px-2 py-2 sm:px-3">
          <button type="button" onClick={previous} aria-label="Previous chapter" title="Previous chapter (←)" className={controlBtn}><SkipBack aria-hidden size={18} weight="fill" /></button>
          <button type="button" onClick={togglePlay} aria-label={waiting ? "Continue" : ended ? "Replay the tour" : playing ? "Pause" : "Play"} title={waiting ? "Continue (Space)" : ended ? "Replay" : playing ? "Pause (Space)" : "Play (Space)"} className={cn(controlBtn, "size-11 bg-paper text-surface hover:bg-paper-2")}>
            {waiting ? <ArrowRight aria-hidden size={18} weight="bold" /> : ended ? <ArrowCounterClockwise aria-hidden size={18} weight="bold" /> : playing ? <Pause aria-hidden size={18} weight="fill" /> : <Play aria-hidden size={18} weight="fill" />}
          </button>
          <button type="button" onClick={next} disabled={index === CHAPTERS.length - 1} aria-label="Next chapter" title="Next chapter (→)" className={cn(controlBtn, "disabled:opacity-35")}><SkipForward aria-hidden size={18} weight="fill" /></button>
          <label className="flex min-w-[160px] flex-1 items-center gap-3 px-1">
            <span className="sr-only">Tour position</span>
            <input
              type="range"
              min={0}
              max={TOTAL}
              step={250}
              value={Math.round(t)}
              onChange={(e) => { started.current = true; seek(Number(e.target.value)); }}
              aria-valuetext={`${clock(t)} of ${clock(TOTAL)}, ${chapter.title}`}
              className="h-6 w-full cursor-pointer accent-[var(--color-signal)]"
            />
            <span className="w-[86px] shrink-0 text-right font-mono text-[12px] tabular-nums text-paper-muted">{clock(t)} / {clock(TOTAL)}</span>
          </label>
          <button type="button" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label={`Playback speed ${speed} times`} title="Playback speed" className="h-10 min-w-12 rounded-full px-3 font-mono text-[12.5px] font-semibold text-paper transition hover:bg-surface-3">{speed}×</button>
          {canFullscreen && (
            <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit presenter mode" : "Presenter mode (full screen)"} title={fullscreen ? "Exit full screen (F)" : "Presenter mode (F)"} className={controlBtn}>
              {fullscreen ? <CornersIn aria-hidden size={18} weight="bold" /> : <CornersOut aria-hidden size={18} weight="bold" />}
            </button>
          )}
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
                  {c.captions.map((cap) => <p key={cap.at} className="mt-1.5 max-w-[75ch] text-[14px] leading-6 text-paper-dim">{cap.text}</p>)}
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
