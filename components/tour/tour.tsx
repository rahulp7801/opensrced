"use client";

// The product tour player: a self-running walkthrough of the whole product,
// with captions, chapters, scrubbing, speed and a fullscreen presenter mode.
//
// One clock drives everything. Tour time `t` advances by real elapsed time
// times the playback speed; each chapter view renders its frame from its local
// time (components/tour/kit.tsx), so pausing, seeking and replaying are exact.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowCounterClockwise, CornersIn, CornersOut, Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CHAPTERS, STARTS, TOTAL } from "./chapters";
import { ACTS, TimeContext } from "./kit";

const SPEEDS = [1, 1.5, 2] as const;
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
  const tRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const index = chapterAt(t);
  const chapter = CHAPTERS[index];
  const local = t - STARTS[index];
  const caption = [...chapter.captions].reverse().find((c) => local >= c.at) ?? chapter.captions[0];
  const ended = t >= TOTAL;

  const seek = useCallback((next: number) => {
    const clamped = Math.min(TOTAL, Math.max(0, next));
    tRef.current = clamped;
    setT(clamped);
  }, []);

  // The clock. Time is measured, not counted in ticks, so a slow frame never
  // slows the tour down; it only skips ahead a little.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const next = Math.min(TOTAL, tRef.current + (now - last) * speed);
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= TOTAL) setPlaying(false);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, speed]);

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

  const togglePlay = useCallback(() => {
    started.current = true;
    if (tRef.current >= TOTAL) seek(0);
    setPlaying((p) => !p || tRef.current >= TOTAL);
  }, [seek]);

  const goTo = useCallback((i: number) => {
    started.current = true;
    seek(STARTS[Math.min(CHAPTERS.length - 1, Math.max(0, i))]);
  }, [seek]);

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
        {/* The stage: a picture of the app. Screen readers get the captions below, which narrate it. */}
        <div
          ref={stageRef}
          aria-hidden
          className={cn(
            "relative overflow-hidden rounded-[20px] border border-border-soft bg-surface shadow-[0_2px_4px_rgb(0_0_0/0.03),0_40px_100px_-30px_rgb(0_0_0/0.22)] sm:rounded-[26px]",
            fullscreen ? "min-h-0 flex-1" : "h-[560px] sm:h-[600px] lg:h-[620px]",
          )}
        >
          <TimeContext.Provider value={local}>
            <div key={chapter.id} className="h-full animate-fade-rise motion-reduce:animate-none">
              <View />
            </div>
          </TimeContext.Provider>
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
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl border border-border-soft bg-surface px-2 py-2 sm:px-3">
          <button type="button" onClick={previous} aria-label="Previous chapter" title="Previous chapter (←)" className={controlBtn}><SkipBack aria-hidden size={18} weight="fill" /></button>
          <button type="button" onClick={togglePlay} aria-label={ended ? "Replay the tour" : playing ? "Pause" : "Play"} title={ended ? "Replay" : playing ? "Pause (Space)" : "Play (Space)"} className={cn(controlBtn, "size-11 bg-paper text-surface hover:bg-paper-2")}>
            {ended ? <ArrowCounterClockwise aria-hidden size={18} weight="bold" /> : playing ? <Pause aria-hidden size={18} weight="fill" /> : <Play aria-hidden size={18} weight="fill" />}
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
            Keyboard: <kbd className="font-mono">Space</kbd> play or pause · <kbd className="font-mono">←</kbd> <kbd className="font-mono">→</kbd> chapters{canFullscreen ? <> · <kbd className="font-mono">F</kbd> presenter mode</> : null}
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
