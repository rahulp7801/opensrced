"use client";

// Landing page, Apple product-page style: centered statement, one large
// product shot, a pinned scroll story, a black guarantees band, and tiles.
// The hero entrance is CSS (it must not wait for JavaScript, or the largest
// paint waits for hydration); GSAP ScrollTrigger owns the scroll story. Both
// are skipped under prefers-reduced-motion, where everything renders in its
// final state.

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

export function Landing({ primary, secondary }: { primary: Cta; secondary: Cta }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia(root.current);
      // The pinned story only makes sense with room for it; phones get the static stack.
      mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
        const story = gsap.timeline({
          scrollTrigger: { trigger: "[data-story]", start: "top top", end: "+=200%", scrub: 0.6, pin: true, anticipatePin: 1 },
        });
        // Without JS every panel but the last is hidden; here the first leads.
        gsap.set("[data-story-panel]", { autoAlpha: 0 });
        gsap.set("[data-story-panel]:nth-child(1)", { autoAlpha: 1 });
        story
          .fromTo("[data-story-frame]", { scale: 0.86, y: 60 }, { scale: 1, y: 0, ease: "power2.out" })
          .fromTo("[data-story-word]:nth-child(2)", { opacity: 0.18 }, { opacity: 1 }, 0.6)
          .to("[data-story-word]:nth-child(1)", { opacity: 0.18 }, 0.6)
          .to("[data-story-panel]:nth-child(1)", { autoAlpha: 0 }, 0.6)
          .to("[data-story-panel]:nth-child(2)", { autoAlpha: 1 }, 0.6)
          .fromTo("[data-story-word]:nth-child(3)", { opacity: 0.18 }, { opacity: 1 }, 1.3)
          .to("[data-story-word]:nth-child(2)", { opacity: 0.18 }, 1.3)
          .to("[data-story-panel]:nth-child(2)", { autoAlpha: 0 }, 1.3)
          .to("[data-story-panel]:nth-child(3)", { autoAlpha: 1 }, 1.3);
      });
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-tile]", {
          scrollTrigger: { trigger: "[data-tiles]", start: "top 80%" },
          opacity: 0, y: 40, stagger: 0.1, duration: 0.8, ease: "power3.out",
        });
      });
      revert = () => mm.revert();
    });
    return () => { cancelled = true; revert?.(); };
  }, []);


  return (
    <div ref={root}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="overflow-hidden px-5 pt-16 text-center sm:pt-24">
        <p className="animate-fade-rise text-[19px] font-semibold tracking-[-0.01em] text-paper sm:text-[21px]" style={{ animationDelay: "0ms" }}>
          opensrcer
        </p>
        <h1 className="animate-fade-rise display mx-auto mt-3 max-w-[900px] text-[48px] leading-[1.04] text-paper sm:text-[80px]" style={{ animationDelay: "80ms" }}>
          Issues in. <span className="sm:block">Pull requests out.</span>
        </h1>
        <p className="animate-fade-rise mx-auto mt-6 max-w-[640px] text-balance text-[19px] leading-[1.45] text-paper-muted sm:text-[21px]" style={{ animationDelay: "160ms" }}>
          Pick an open issue, let an agent work through the code, and read every line of the patch before a draft pull request opens in your name.
        </p>
        <div className="animate-fade-rise mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4" style={{ animationDelay: "240ms" }}>
          <Link href={primary.href} className="btn-primary min-h-11 px-6 text-[17px]">{primary.label}</Link>
          <Link href={secondary.href} className="group inline-flex items-center gap-1 text-[17px] text-signal hover:underline">
            {secondary.label}
            <CaretRight aria-hidden size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="animate-fade-rise mx-auto mt-16 max-w-[1080px] sm:mt-20" style={{ animationDelay: "300ms" }}>
          <ProductShot />
        </div>
      </section>

      {/* ── Pinned story ─────────────────────────────────────────────── */}
      <section data-story className="mx-auto grid max-w-[1180px] items-center gap-12 px-5 py-24 lg:min-h-svh lg:grid-cols-[5fr_7fr] lg:py-0">
        <div className="space-y-2">
          {STORY.map((line) => (
            <p key={line} data-story-word className="display text-[40px] leading-[1.1] text-paper sm:text-[56px]">{line}</p>
          ))}
          <p className="pt-6 text-[17px] leading-relaxed text-paper-muted">
            Search projects by language and activity, map the repository around the issue, then read the diff with the verification record beside it.
          </p>
        </div>
        {/* Three panels share one grid cell and crossfade with the words. */}
        <div data-story-frame className="grid">
          <StoryPanel label="Discover" hidden><MiniIssues /></StoryPanel>
          <StoryPanel label="Code graph" hidden><MiniGraph className="h-[260px]" /></StoryPanel>
          <div data-story-panel className="[grid-area:1/1]"><ReviewShot /></div>
        </div>
      </section>

      {/* ── Guarantees, on black ─────────────────────────────────────── */}
      <section className="bg-black px-5 py-28 text-center text-[#f5f5f7] sm:py-36">
        <h2 className="display mx-auto max-w-[820px] text-[44px] leading-[1.05] sm:text-[72px]">Nothing ships without you.</h2>
        <p className="mx-auto mt-5 max-w-[560px] text-[19px] leading-[1.45] text-[#a1a1a6] sm:text-[21px]">
          Every run is fenced in before it starts.
        </p>
        <ul className="mx-auto mt-20 grid max-w-[1000px] gap-14 text-left sm:grid-cols-3 sm:gap-10">
          {GUARANTEES.map(({ Icon, title, copy }) => (
            <li key={title}>
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
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <Link href={primary.href} className="btn-primary min-h-11 px-6 text-[17px]">{primary.label}</Link>
          <Link href={secondary.href} className="group inline-flex items-center gap-1 text-[17px] text-signal hover:underline">
            {secondary.label}
            <CaretRight aria-hidden size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

/** The app window, drawn in markup: a finished run, ready for review. */
function ProductShot() {
  return (
    <article
      aria-label="Illustrative agent run"
      className="overflow-hidden rounded-[22px] border border-border-soft bg-surface text-left shadow-[0_2px_4px_rgb(0_0_0/0.03),0_40px_100px_-20px_rgb(0_0_0/0.18)] sm:rounded-[28px]"
    >
      <div className="flex items-center gap-2 border-b border-border-soft px-5 py-3.5">
        <span className="size-3 rounded-full bg-[#ff5f57]" aria-hidden />
        <span className="size-3 rounded-full bg-[#febc2e]" aria-hidden />
        <span className="size-3 rounded-full bg-[#28c840]" aria-hidden />
        <span className="mx-auto pr-12 text-[12px] font-medium text-paper-muted">Run on acme/search</span>
      </div>
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)]">
        <aside aria-hidden className="hidden border-r border-border-soft bg-ink-2 p-4 md:block">
          {["Find", "Fix", "Ship", "Explore"].map((item) => (
            <div key={item} className={`rounded-lg px-3 py-2 text-[13px] ${item === "Fix" ? "bg-surface-3 font-medium text-paper" : "text-paper-muted"}`}>
              {item}
            </div>
          ))}
        </aside>
        <div className="p-6 sm:p-9">
          <p className="text-[13px] text-paper-muted">acme/search · issue #184</p>
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

/** The review screen: the patch with its verification record. */
function ReviewShot() {
  return (
    <figure aria-label="Illustrative diff review" className="card overflow-hidden rounded-[24px]">
      <div className="flex items-center justify-between border-b border-border-soft px-6 py-4">
        <span className="font-mono text-[13px] text-paper">src/query.ts</span>
        <span className="tag" data-tone="ok">checks passed</span>
      </div>
      <pre className="overflow-x-auto py-4 font-mono text-[13px] leading-7 text-paper-dim">
        <div className="px-6">{"export function search(q: string) {"}</div>
        <div className="bg-[#e6f4ea] px-6 text-[#1b5e2f]">{"+   if (!q.trim()) return [];"}</div>
        <div className="px-6">{"    return index.query(q);"}</div>
        <div className="px-6">{"}"}</div>
      </pre>
      <figcaption className="grid grid-cols-3 border-t border-border-soft text-center">
        {[["1", "file changed"], ["14", "files read"], ["0", "tests failing"]].map(([n, label]) => (
          <div key={label} className="px-3 py-5">
            <div className="text-[28px] font-semibold tracking-[-0.02em] text-paper num-tabular">{n}</div>
            <div className="text-[12px] text-paper-muted">{label}</div>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

function StoryPanel({ label, hidden, children }: { label: string; hidden?: boolean; children: React.ReactNode }) {
  return (
    <div data-story-panel aria-hidden={hidden} className="invisible self-center [grid-area:1/1]">
      <div className="card rounded-[24px] p-6 sm:p-8">
        <p className="mb-5 text-[13px] font-medium text-paper-muted">{label}</p>
        {children}
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
      {[["#184", "Handle an empty search query", "ok"], ["#92", "Exit code is 0 on a missing config", "info"], ["#311", "Install guide names an old flag", undefined]].map(([n, t, tone]) => (
        <div key={n} className="flex items-center gap-3 rounded-xl bg-ink px-3.5 py-2.5 text-[12.5px]">
          <span className="tag shrink-0" data-tone={tone}>{n}</span>
          <span className="truncate text-paper-dim">{t}</span>
        </div>
      ))}
    </div>
  );
}

function MiniGraph({ className = "h-[132px]" }: { className?: string }) {
  const nodes = [[60, 40], [150, 30], [110, 90], [200, 100], [40, 120], [160, 150]] as const;
  const edges = [[0, 2], [1, 2], [2, 3], [2, 4], [3, 5], [1, 3]] as const;
  return (
    <svg viewBox="0 0 240 180" className={`${className} w-full rounded-xl bg-ink`}>
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
