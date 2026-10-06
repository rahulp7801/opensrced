"use client";

// Landing page, Apple product-page style: centered statement, one large
// product shot, a pinned scroll story, a black guarantees band, and tiles.
//
// Motion rules this file keeps:
// - The hero entrance is CSS (.animate-fade-rise), so the largest paint never
//   waits for hydration. Scroll motion on the hero starts at scroll 0 from the
//   rendered state, so nothing jumps when GSAP loads.
// - The server renders every illustration in its finished state. GSAP rewinds
//   parts of it (pending checks, untyped diff line) only once it has loaded,
//   only under prefers-reduced-motion: no-preference, and only for parts that
//   are below the fold at that moment.
// - Only transform, opacity, clip-path and stroke-dashoffset animate, so
//   nothing moves layout (CLS).
// - The pinned story is desktop-only (≥1024px). Phones get the static stack and
//   play the review beat once when it scrolls into view.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CaretRight, Check, Coins, GitPullRequest, ShieldCheck } from "@phosphor-icons/react";

type Cta = { href: string; label: string };

// An illustrative run: what the agent did, in order, with its evidence. Not live data.
const RUN_STEPS = [
  ["Explore", "14 files read"],
  ["Diagnose", "root cause in query.ts"],
  ["Patch", "+1 line, one file"],
  ["Review", "checks passed"],
] as const;

const STORY = ["Find the right issue.", "Understand the code.", "Review every line."] as const;

const GUARANTEES = [
  { Icon: ShieldCheck, title: "Read-only while it explores", copy: "The agent can read the repository, not change it, until it proposes a patch." },
  { Icon: Coins, title: "A hard spend limit", copy: "Every run stops at a fixed spend cap, whatever the agent is in the middle of." },
  { Icon: GitPullRequest, title: "Draft pull requests only", copy: "Nothing merges on its own. You open the draft and decide." },
] as const;

const GUARANTEE_HEADLINE = "Nothing ships without you.".split(" ");

// Illustrative issues; the tiles show the first three, the story all five.
const ISSUES = [
  ["#184", "Handle an empty search query", "ok"],
  ["#92", "Exit code is 0 on a missing config", "info"],
  ["#311", "Install guide names an old flag", undefined],
  ["#207", "Pagination skips the last page", "info"],
  ["#58", "Badge in the README links to an old build", undefined],
] as const;

// The story's code graph: the files around the one that needs the change.
const GRAPH_NODES = [
  { name: "search.ts", x: 78, y: 30 },
  { name: "api.ts", x: 282, y: 30 },
  { name: "query.ts", x: 180, y: 104 },
  { name: "tokenize.ts", x: 78, y: 178 },
  { name: "index.ts", x: 282, y: 178 },
] as const;
const GRAPH_EDGES = [[0, 2], [1, 2], [2, 3], [2, 4], [1, 4]] as const;
const ROOT = 2;

const DIFF_ADDED = "+   if (!q.trim()) return [];";
const FILES_READ = 14;

export function Landing({ primary, secondary }: { primary: Cta; secondary: Cta }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      // Scoped: every selector below only matches inside this page.
      const mm = gsap.matchMedia(root.current);
      const counter = root.current.querySelector<HTMLElement>("[data-count]");

      // Rewind the run window to "not started". Everything here is a gsap.set
      // inside a matchMedia context, so leaving the query restores the finished
      // state; the counter text is restored by the returned cleanup.
      const rewind = () => {
        gsap.set("[data-check]", { scale: 0 });
        gsap.set("[data-progress]", { scaleX: 0 });
        gsap.set("[data-diff-bg]", { scaleX: 0 });
        gsap.set("[data-diff-text]", { clipPath: "inset(0 100% 0 0)" });
        gsap.set("[data-review-tag]", { autoAlpha: 0, scale: 0.85 });
        gsap.set("[data-pr]", { autoAlpha: 0, y: 16 });
        if (counter) counter.textContent = "0";
        return () => { if (counter) counter.textContent = String(FILES_READ); };
      };
      const check = (tl: gsap.core.Timeline, step: number, at: number) =>
        tl
          .to(`[data-step="${step}"] [data-check]`, { scale: 1, duration: 0.25, ease: "back.out(2.2)" }, at)
          .to("[data-progress]", { scaleX: (step + 1) / RUN_STEPS.length, duration: 0.3, ease: "power2.out" }, at);
      // The last beat, shared by desktop (scrubbed) and phones (played once):
      // the line types in, the record counts up, checks pass, the draft is ready.
      const reviewBeat = (tl: gsap.core.Timeline, at: number) => {
        const files = { n: 0 };
        tl.to("[data-diff-bg]", { scaleX: 1, duration: 0.35, ease: "power2.out" }, at)
          .to("[data-diff-text]", { clipPath: "inset(0 0% 0 0)", duration: 0.7, ease: `steps(${DIFF_ADDED.length})` }, at + 0.1)
          .to(files, {
            n: FILES_READ, duration: 0.6, ease: "power1.out",
            onUpdate: () => { if (counter) counter.textContent = String(Math.round(files.n)); },
          }, at + 0.85)
          .to("[data-review-tag]", { autoAlpha: 1, scale: 1, duration: 0.25, ease: "back.out(2)" }, at + 1.4)
          .to("[data-pr]", { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" }, at + 1.75);
        check(tl, 2, at + 0.8);
        check(tl, 3, at + 1.5);
      };

      // Desktop: the window enters, pins, and runs the whole contribution as you scroll.
      // Created before the triggers below it, so their positions include the pin spacing.
      mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
        const restore = rewind();
        gsap.set("[data-story-panel]", { autoAlpha: 0 });
        gsap.set("[data-story-panel='0']", { autoAlpha: 1 });
        gsap.set("[data-story-word]", { opacity: 0.18 });
        gsap.set("[data-story-word='0']", { opacity: 1 });
        gsap.set("[data-select]", { autoAlpha: 0, scale: 0.97 });
        gsap.set("[data-node]", { scale: 0, transformOrigin: "50% 50%" });
        gsap.set("[data-edge]", { strokeDashoffset: 1 });
        gsap.set("[data-root-on]", { autoAlpha: 0 });
        gsap.set("[data-graph-note]", { autoAlpha: 0, y: 10 });

        // Rises into place on the way in, so the pin starts on a settled frame.
        gsap.fromTo("[data-story-frame]", { scale: 0.9, y: 90 }, {
          scale: 1, y: 0, ease: "none",
          scrollTrigger: { trigger: "[data-story]", start: "top bottom", end: "top top", scrub: true },
        });

        const swap = (from: number, to: number, at: number) =>
          tl.to(`[data-story-panel='${from}']`, { autoAlpha: 0, y: -28, duration: 0.35, ease: "power2.in" }, at)
            .fromTo(`[data-story-panel='${to}']`, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" }, at + 0.3)
            .to(`[data-story-word='${from}']`, { opacity: 0.18, duration: 0.5 }, at)
            .to(`[data-story-word='${to}']`, { opacity: 1, duration: 0.5 }, at + 0.2);

        const tl = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: { trigger: "[data-story]", start: "top top", end: "+=340%", scrub: 0.8, pin: true, anticipatePin: 1 },
        });
        // 1. Find: one issue is chosen, the rest step back.
        tl.to("[data-select]", { autoAlpha: 1, scale: 1, duration: 0.35, ease: "power2.out" }, 0.3)
          .to("[data-story-issue]:not([data-story-issue='0'])", { opacity: 0.4, duration: 0.4 }, 0.35);
        // 2. Understand: the graph assembles, then the root cause lights up.
        swap(0, 1, 1.1);
        tl.to("[data-node]", { scale: 1, duration: 0.3, stagger: 0.07, ease: "back.out(1.7)" }, 1.55)
          .to("[data-edge]", { strokeDashoffset: 0, duration: 0.5, stagger: 0.08, ease: "power1.inOut" }, 1.75)
          .to("[data-root-on]", { autoAlpha: 1, duration: 0.3 }, 2.5)
          .to("[data-graph-note]", { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out" }, 2.6);
        check(tl, 0, 2.1);
        check(tl, 1, 2.7);
        // 3. Review: the patch, its record, and the draft.
        swap(1, 2, 3.2);
        reviewBeat(tl, 3.7);
        tl.to({}, { duration: 0.6 }); // a held beat on the finished frame before the pin releases
        return restore;
      });

      // Phones and tablets: no pin. The review window plays its beat once.
      mm.add("(max-width: 1023px) and (prefers-reduced-motion: no-preference)", () => {
        const restore = rewind();
        const tl = gsap.timeline({
          scrollTrigger: { trigger: "[data-story-frame]", start: "top 70%", toggleActions: "play none none none" },
        });
        check(tl, 0, 0);
        check(tl, 1, 0.2);
        reviewBeat(tl, 0.4);
        return restore;
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Hero depth: the copy lags behind and dims while the window comes forward.
        // Both start at scroll 0, so the first frame is exactly what the server sent.
        const hero = { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: true } as const;
        gsap.to("[data-hero-copy]", { y: 80, opacity: 0.15, ease: "power1.in", scrollTrigger: hero });
        gsap.to("[data-hero-shot]", { scale: 1.05, ease: "none", scrollTrigger: hero });

        // Guarantees: the headline brightens word by word, the three promises rise in.
        gsap.fromTo("[data-hl-word]", { opacity: 0.18 }, {
          opacity: 1, stagger: 0.4, ease: "none",
          scrollTrigger: { trigger: "[data-guarantees]", start: "top 75%", end: "top 25%", scrub: true },
        });
        gsap.from("[data-guarantee]", {
          y: 60, opacity: 0, stagger: 0.15, ease: "none",
          scrollTrigger: { trigger: "[data-guarantee-list]", start: "top 95%", end: "top 60%", scrub: true },
        });

        // Tiles settle into one row from staggered depths; position only, never hidden.
        gsap.from("[data-tile]", {
          y: (i: number) => 70 + i * 45, ease: "none",
          scrollTrigger: { trigger: "[data-tiles]", start: "top bottom", end: "top 50%", scrub: true },
        });
      });
      revert = () => mm.revert();
    });
    return () => { cancelled = true; revert?.(); };
  }, []);

  return (
    <div ref={root}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section data-hero className="overflow-x-clip px-5 pb-10 pt-16 text-center sm:pt-24">
        <div data-hero-copy>
          <p className="animate-fade-rise text-[19px] font-semibold tracking-[-0.01em] text-paper sm:text-[21px]" style={{ animationDelay: "0ms" }}>
            opensrcer
          </p>
          <h1 className="animate-fade-rise display mx-auto mt-3 max-w-[900px] text-[48px] leading-[1.04] text-paper sm:text-[80px]" style={{ animationDelay: "80ms" }}>
            Issues in. <span className="sm:block">Pull requests out.</span>
          </h1>
          <p className="animate-fade-rise mx-auto mt-6 max-w-[640px] text-balance text-[19px] leading-[1.45] text-paper-muted sm:text-[21px]" style={{ animationDelay: "160ms" }}>
            Pick an open issue, let an agent work through the code, and read every line of the patch before a draft pull request opens in your name.
          </p>
          <CtaPair primary={primary} secondary={secondary} className="animate-fade-rise mt-9" delay="240ms" />
        </div>
        {/* The CSS entrance and the GSAP scroll transform sit on separate
            elements: a finished CSS animation would override GSAP's transform. */}
        <div className="animate-fade-rise mx-auto mt-16 max-w-[1080px] sm:mt-20" style={{ animationDelay: "300ms" }}>
          <div data-hero-shot className="origin-top">
            <ProductShot />
          </div>
        </div>
      </section>

      {/* ── Pinned story ─────────────────────────────────────────────── */}
      <section data-story className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-12 px-5 py-24 lg:min-h-svh lg:grid-cols-[5fr_7fr] lg:py-0">
        <div className="space-y-2">
          {STORY.map((line, i) => (
            <p key={line} data-story-word={i} className="display text-[40px] leading-[1.1] text-paper sm:text-[56px]">{line}</p>
          ))}
          <p className="pt-6 text-[17px] leading-relaxed text-paper-muted">
            Search projects by language and activity, map the repository around the issue, then read the diff with the verification record beside it.
          </p>
        </div>
        <RunWindow />
      </section>

      {/* ── Guarantees, on black ─────────────────────────────────────── */}
      <section data-guarantees className="bg-black px-5 py-28 text-center text-[#f5f5f7] sm:py-36">
        <h2 className="display mx-auto max-w-[820px] text-[44px] leading-[1.05] sm:text-[72px]">
          {GUARANTEE_HEADLINE.map((word, i) => (
            <span key={word} data-hl-word>{word}{i < GUARANTEE_HEADLINE.length - 1 ? " " : ""}</span>
          ))}
        </h2>
        <p className="mx-auto mt-5 max-w-[560px] text-[19px] leading-[1.45] text-[#a1a1a6] sm:text-[21px]">
          Every run is fenced in before it starts.
        </p>
        <ul data-guarantee-list className="mx-auto mt-20 grid max-w-[1000px] gap-14 text-left sm:grid-cols-3 sm:gap-10">
          {GUARANTEES.map(({ Icon, title, copy }) => (
            <li key={title} data-guarantee>
              <Icon aria-hidden size={34} weight="light" className="text-[#f5f5f7]" />
              <h3 className="mt-5 text-[21px] font-semibold tracking-[-0.015em]">{title}</h3>
              <p className="mt-2 text-[17px] leading-[1.5] text-[#a1a1a6]">{copy}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Tiles ────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 py-28 sm:py-36" aria-labelledby="tiles-heading">
        <h2 id="tiles-heading" className="display text-[40px] leading-[1.08] text-paper sm:text-[56px]">One place for the whole contribution.</h2>
        <div data-tiles className="mt-14 grid gap-5 md:grid-cols-3">
          <Tile title="Find" copy="Discover repositories by language and activity, or scan any public repo for issues worth fixing.">
            <MiniIssues />
          </Tile>
          <Tile title="Understand" copy="A code graph of the repository shows callers, impact, and why the change belongs where it does.">
            <MiniGraph />
          </Tile>
          <Tile title="Ship" copy="Read the diff and its checks, then open a draft pull request that you own.">
            <MiniDiff />
          </Tile>
        </div>
      </section>

      {/* ── Close ────────────────────────────────────────────────────── */}
      <section className="px-5 pb-12 text-center">
        <h2 className="display mx-auto max-w-[760px] text-[40px] leading-[1.08] text-paper sm:text-[56px]">Start with one issue.</h2>
        <CtaPair primary={primary} secondary={secondary} className="mt-9" />
      </section>
    </div>
  );
}

function CtaPair({ primary, secondary, className, delay }: { primary: Cta; secondary: Cta; className: string; delay?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-8 gap-y-4 ${className}`} style={delay ? { animationDelay: delay } : undefined}>
      {/* Press feedback: a small scale-down, on transform only. */}
      <Link href={primary.href} className="btn-primary min-h-11 px-6 text-[17px] transition-[background-color,transform] duration-150 active:scale-[0.97]">
        {primary.label}
      </Link>
      <Link href={secondary.href} className="group inline-flex items-center gap-1 text-[17px] text-signal hover:underline">
        {secondary.label}
        <CaretRight aria-hidden size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/** Traffic lights and a title: the window chrome both product shots share. */
function WindowBar() {
  return (
    <div className="flex items-center gap-2 border-b border-border-soft px-5 py-3.5">
      <span className="size-3 rounded-full bg-[#ff5f57]" aria-hidden />
      <span className="size-3 rounded-full bg-[#febc2e]" aria-hidden />
      <span className="size-3 rounded-full bg-[#28c840]" aria-hidden />
      <span className="mx-auto pr-12 text-[12px] font-medium text-paper-muted">Illustrative run on acme/search</span>
    </div>
  );
}

const WINDOW = "overflow-hidden border border-border-soft bg-surface text-left shadow-[0_2px_4px_rgb(0_0_0/0.03),0_40px_100px_-20px_rgb(0_0_0/0.18)]";

/** The app window, drawn in markup: a finished run, ready for review. */
function ProductShot() {
  return (
    <article aria-label="Illustrative agent run" className={`${WINDOW} rounded-[22px] sm:rounded-[28px]`}>
      <WindowBar />
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)]">
        <aside aria-hidden className="hidden border-r border-border-soft bg-ink-2 p-4 md:block">
          {["Find", "Fix", "Ship", "Explore"].map((item) => (
            <div key={item} className={`rounded-lg px-3 py-2 text-[13px] ${item === "Fix" ? "bg-surface-3 font-medium text-paper" : "text-paper-muted"}`}>
              {item}
            </div>
          ))}
        </aside>
        <div className="p-6 sm:p-9">
          <p className="text-[13px] text-paper-muted">acme/search, issue #184</p>
          <h2 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-paper sm:text-[28px]">Handle an empty search query</h2>
          <ol className="mt-6 divide-y divide-border-soft rounded-2xl border border-border-soft">
            {RUN_STEPS.map(([label, evidence]) => (
              <li key={label} className="flex items-center gap-3 px-4 py-3 text-[14px] sm:px-5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ok text-white">
                  <Check aria-label="Complete" size={11} weight="bold" />
                </span>
                <span className="font-medium text-paper">{label}</span>
                <span className="ml-auto truncate text-[13px] text-paper-muted">{evidence}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="text-[14px] text-paper-muted"><span className="font-medium text-paper">Draft pull request ready.</span> Opened in your name, for your review.</p>
            <span className="btn-primary pointer-events-none" aria-hidden>Review diff</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The story's stage: one window whose body changes from issue to graph to
 * diff, with the run's steps checking off along the top. Rendered finished
 * (all steps done, the review showing); the panels before it are hidden until
 * the desktop timeline takes over. All three share one grid cell, so the
 * window is always as tall as the tallest and never resizes.
 */
function RunWindow() {
  return (
    <figure data-story-frame aria-label="Illustrative agent run, step by step" className={`${WINDOW} min-w-0 rounded-[24px]`}>
      <WindowBar />
      <ol className="relative grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border-soft px-5 py-4 sm:grid-cols-4 sm:px-7">
        {RUN_STEPS.map(([label], i) => (
          <li key={label} data-step={i} className="flex items-center gap-2 text-[13px] font-medium text-paper">
            <span className="relative size-5 shrink-0 rounded-full border-[1.5px] border-border">
              <span data-check className="absolute -inset-[1.5px] grid place-items-center rounded-full bg-ok text-white">
                <Check aria-hidden size={11} weight="bold" />
              </span>
            </span>
            {label}
          </li>
        ))}
        <span data-progress aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] origin-left bg-ok" />
      </ol>
      <div className="grid grid-cols-1 p-5 sm:p-7">
        <StoryPanel index={0} label="Pick an issue"><StoryIssues /></StoryPanel>
        <StoryPanel index={1} label="Code graph"><StoryGraph /></StoryPanel>
        <StoryPanel index={2}><StoryReview /></StoryPanel>
      </div>
    </figure>
  );
}

function StoryPanel({ index, label, children }: { index: number; label?: string; children: React.ReactNode }) {
  // Without JS (and on phones) only the last panel shows; the others are for the pinned story.
  const hidden = index < 2;
  return (
    <div data-story-panel={index} aria-hidden={hidden || undefined} className={`min-w-0 self-center [grid-area:1/1] ${hidden ? "invisible" : ""}`}>
      {label && <p className="mb-4 text-[13px] font-medium text-paper-muted">{label}</p>}
      {children}
    </div>
  );
}

function StoryIssues() {
  return (
    <div className="space-y-2.5">
      {ISSUES.map(([n, t, tone], i) => (
        <div key={n} data-story-issue={i} className="relative isolate flex items-center gap-3 rounded-xl bg-ink px-4 py-3.5 text-[14px]">
          {/* The chosen issue's highlight sits behind the row's text. */}
          {i === 0 && <span data-select aria-hidden className="absolute inset-0 -z-10 rounded-xl bg-surface ring-2 ring-signal" />}
          <span className="tag shrink-0" data-tone={tone}>{n}</span>
          <span className="truncate text-paper-dim">{t}</span>
        </div>
      ))}
    </div>
  );
}

function StoryGraph() {
  const pill = (name: string) => name.length * 5 + 20;
  return (
    <div>
      <svg viewBox="0 0 360 208" className="w-full rounded-xl bg-ink" aria-hidden>
        {GRAPH_EDGES.map(([a, b]) => {
          const [p, q] = [GRAPH_NODES[a], GRAPH_NODES[b]];
          const mid = (p.y + q.y) / 2;
          return (
            <path
              key={`${a}-${b}`} data-edge d={`M${p.x} ${p.y} C${p.x} ${mid} ${q.x} ${mid} ${q.x} ${q.y}`}
              pathLength={1} strokeDasharray="1" fill="none" stroke="#a1a1a6" strokeWidth="1.25"
            />
          );
        })}
        {GRAPH_NODES.map(({ name, x, y }, i) => (
          <g key={name} data-node>
            <rect x={x - pill(name) / 2} y={y - 11} width={pill(name)} height={22} rx={11} fill="#fff" stroke="#d2d2d7" />
            <text x={x} y={y + 3} textAnchor="middle" fontSize="8.5" fontWeight="500" fill="#424245">{name}</text>
            {i === ROOT && (
              <g data-root-on>
                <rect x={x - pill(name) / 2} y={y - 11} width={pill(name)} height={22} rx={11} fill="#0056ad" />
                <text x={x} y={y + 3} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#fff">{name}</text>
              </g>
            )}
          </g>
        ))}
      </svg>
      <p data-graph-note className="mt-4 text-[14px] leading-[1.5] text-paper-dim">
        <span className="font-medium text-paper">Root cause in query.ts.</span> An empty query reaches index.query unchecked.
      </p>
    </div>
  );
}

function StoryReview() {
  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-border-soft">
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-3.5">
          <span className="font-mono text-[13px] text-paper">src/query.ts</span>
          <span data-review-tag className="tag" data-tone="ok">checks passed</span>
        </div>
        <div className="overflow-x-auto whitespace-pre py-3 font-mono text-[13px] leading-7 text-paper-dim">
          <div className="px-5">{"export function search(q: string) {"}</div>
          {/* The added line: its tint sweeps in, then the text types over it. */}
          <div className="relative px-5 text-[#1b5e2f]">
            <span data-diff-bg aria-hidden className="absolute inset-0 origin-left bg-[#e6f4ea]" />
            <span data-diff-text className="relative">{DIFF_ADDED}</span>
          </div>
          <div className="px-5">{"    return index.query(q);"}</div>
          <div className="px-5">{"}"}</div>
        </div>
        <div className="grid grid-cols-3 border-t border-border-soft text-center">
          {([["1", "file changed"], [String(FILES_READ), "files read"], ["0", "tests failing"]] as const).map(([n, label]) => (
            <div key={label} className="px-3 py-4">
              <div data-count={label === "files read" || undefined} className="text-[26px] font-semibold tracking-[-0.02em] text-paper num-tabular">{n}</div>
              <div className="text-[12px] text-paper-muted">{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div data-pr className="mt-4 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3">
        <GitPullRequest aria-hidden size={20} className="shrink-0 text-signal" />
        <p className="text-[14px] text-paper-dim"><span className="font-medium text-paper">Draft pull request ready.</span> You decide when it opens.</p>
        <span className="btn-primary pointer-events-none ml-auto hidden sm:inline-flex" aria-hidden>Open draft</span>
      </div>
    </div>
  );
}

function Tile({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <article data-tile className="card flex flex-col overflow-hidden rounded-[24px]">
      <div className="p-8">
        <h3 className="text-[24px] font-semibold tracking-[-0.02em] text-paper">{title}</h3>
        <p className="mt-2 text-[15px] leading-[1.5] text-paper-muted">{copy}</p>
      </div>
      <div aria-hidden className="mt-auto px-8 pb-8">{children}</div>
    </article>
  );
}

function MiniIssues() {
  return (
    <div className="space-y-2">
      {ISSUES.slice(0, 3).map(([n, t, tone]) => (
        <div key={n} className="flex items-center gap-3 rounded-xl bg-ink px-3.5 py-2.5 text-[12.5px]">
          <span className="tag shrink-0" data-tone={tone}>{n}</span>
          <span className="truncate text-paper-dim">{t}</span>
        </div>
      ))}
    </div>
  );
}

function MiniGraph() {
  const nodes = [[60, 40], [150, 30], [110, 90], [200, 100], [40, 120], [160, 150]] as const;
  const edges = [[0, 2], [1, 2], [2, 3], [2, 4], [3, 5], [1, 3]] as const;
  return (
    <svg viewBox="0 0 240 180" className="h-[132px] w-full rounded-xl bg-ink">
      {edges.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="#c7c7cc" strokeWidth="1.5" />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 2 ? 9 : 6} fill={i === 2 ? "#0056ad" : "#fff"} stroke={i === 2 ? "#0056ad" : "#a1a1a6"} strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function MiniDiff() {
  return (
    <div className="overflow-hidden rounded-xl bg-ink font-mono text-[12px] leading-6">
      <div className="px-3.5 pt-2 text-paper-muted">{"  return index.query(q);"}</div>
      <div className="bg-[#fde8e8] px-3.5 text-[#9f1c22]">{"- if (q === null) return;"}</div>
      <div className="bg-[#e6f4ea] px-3.5 text-[#1b5e2f]">{"+ if (!q.trim()) return [];"}</div>
      <div className="px-3.5 pb-2 text-paper-muted">{"}"}</div>
    </div>
  );
}
