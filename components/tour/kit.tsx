"use client";

// Building blocks for the product tour. Every chapter view is a pure function
// of its local time `t` (ms), read from TimeContext, so play, pause, seek and
// replay are exact: nothing here keeps its own timers or state.
//
// In click-through mode (InteractContext) the same views become the visitor's
// to drive: each scripted click pauses the tour until they make it themselves,
// and the app's menus jump to the matching part of the tour.

import { createContext, useContext, useEffect, useRef, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";

export const TimeContext = createContext(0);

/** On the stage, the app frame's address goes in the caption above the frame (fig. N  URL ·
 *  provenance) rather than in a fake URL bar inside it; the stage provides where to send it. */
export const FrameUrlContext = createContext<((url: string) => void) | null>(null);

/** Local time in the current chapter, in ms. */
export function useT(): number {
  return useContext(TimeContext);
}

/** 0 before `from`, 1 after `to`, linear in between. */
export function progress(t: number, from: number, to: number): number {
  if (to <= from) return t >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}

/** Fades and lifts its children into place once local time passes `at`. */
export function Reveal({ at, children, className, as: Tag = "div", spot }: { at: number; children: ReactNode; className?: string; as?: "div" | "li" | "span" | "tr"; spot?: string }) {
  const shown = useT() >= at;
  return (
    <Tag
      data-spot={spot}
      aria-hidden={shown ? undefined : true}
      className={cn("transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", shown ? "opacity-100 translate-y-0" : "pointer-events-none translate-y-1.5 opacity-0", className)}
    >
      {children}
    </Tag>
  );
}

/** Text typed out from `at` at `cps` characters a second, with a caret while typing. */
export function Typed({ text, at, cps = 28, className }: { text: string; at: number; cps?: number; className?: string }) {
  const t = useT();
  const shown = Math.max(0, Math.min(text.length, Math.floor(((t - at) / 1000) * cps)));
  const typing = t >= at && shown < text.length;
  return (
    <span className={className}>
      {text.slice(0, shown)}
      {typing && <span aria-hidden className="ml-px inline-block h-[1em] w-px translate-y-[0.15em] bg-current" />}
    </span>
  );
}

/** Click-through mode, provided by the player; null while the tour just plays. */
export type Interact = {
  /** The scripted click the tour is paused on, by its `at` in the chapter view. */
  waitingAt: number | null;
  /** A Press calls this as its click comes due; the player pauses on it unless already done. */
  reach: (at: number, label: string) => void;
  /** The visitor made the click: carry on. */
  press: () => void;
  /** Jump to a chapter by id (the app's menus). */
  open: (chapterId: string) => void;
  /** True once if the visitor's last action came from inside the stage, so the
   *  next button asked for should take focus. */
  claimFocus: () => boolean;
};
export const InteractContext = createContext<Interact | null>(null);

/** How long before its click a Press asks to pause, in view time: before the
 *  press animation starts (at - 450), with room for one slow clock tick. */
const REACH_MS = 600;

/** How long before its click Watch mode's cursor (tour.tsx) sets off for a Press. */
const CURSOR_LEAD = 1300;

/** A mock button that lights up as the tour "clicks" it at `at`. In
 *  click-through mode it becomes a real button the visitor has to press.
 *  `label` names it when its text is more than a button label. */
export function Press({ at, children, className, label }: { at: number | null; children: ReactNode; className?: string; label?: string }) {
  const t = useT();
  const ix = useContext(InteractContext);
  const ref = useRef<HTMLElement>(null);
  const due = ix !== null && at !== null && t >= at - REACH_MS && t < at;
  useEffect(() => {
    // A button the layout hides (on a phone, say) can't be asked for: the tour clicks it itself.
    const shown = (ref.current?.getClientRects().length ?? 0) > 0;
    if (due && at !== null && shown) ix?.reach(at, label ?? ref.current?.textContent?.trim() ?? "");
  }, [due, at, ix, label]);
  const waiting = ix !== null && at !== null && ix.waitingAt === at;
  // The button the visitor is asked for must be in sight, even in a pane that has scrolled past it.
  useEffect(() => {
    if (!waiting) return;
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (ix?.claimFocus()) ref.current?.focus({ preventScroll: true });
  }, [waiting, ix]);
  const pressing = !waiting && at !== null && t >= at - 450 && t < at + 350;
  // Where the cursor is in its trip to this button: data-cursor says moving or
  // clicking, data-cursor-p how far along (0-1). The cursor reads the DOM for them.
  const approaching = !waiting && at !== null && t >= at - CURSOR_LEAD && t < at + 300;
  const cursor = approaching ? { "data-cursor": t >= at - 150 ? "click" : "move", "data-cursor-p": progress(t, at - CURSOR_LEAD, at - 350).toFixed(3) } : {};
  const cls = cn(
    "relative inline-flex select-none items-center justify-center transition-[transform,box-shadow] duration-200 motion-reduce:transition-none",
    pressing && "scale-[0.96] shadow-[0_0_0_4px_rgb(0_86_173/0.28)]",
    waiting && "cursor-pointer shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-signal)] hover:brightness-95",
    className,
  );
  const halo = (pressing || waiting) && <span aria-hidden className="pointer-events-none absolute inset-0 animate-ping rounded-[inherit] bg-signal/20 motion-reduce:animate-none" />;
  return waiting && ix ? (
    <button ref={ref as Ref<HTMLButtonElement>} type="button" onClick={ix.press} aria-label={label} data-waiting="" className={cls}>{children}{halo}</button>
  ) : (
    <span ref={ref} className={cls} {...cursor}>{children}{halo}</span>
  );
}

/** A number counting from `from` to `to` between `at` and `at + duration`. */
export function Count({ from = 0, to, at, duration = 1200, format = (n) => String(Math.round(n)) }: { from?: number; to: number; at: number; duration?: number; format?: (n: number) => string }) {
  const p = progress(useT(), at, at + duration);
  const eased = 1 - Math.pow(1 - p, 3);
  return <>{format(from + (to - from) * eased)}</>;
}

/** Keeps a scrolling pane pinned to its newest line as lines arrive. */
export function useFollow(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  return ref;
}

/** Scrolls a pane from top to bottom as local time goes from `from` to `to`,
 *  like a presenter scrolling through a long page. */
export function useAutoScroll(from: number, to: number) {
  return useScrollFraction(progress(useT(), from, to));
}

/** Holds a pane at scroll position `p` (0 = top, 1 = bottom). */
export function useScrollFraction(p: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = p * Math.max(0, el.scrollHeight - el.clientHeight);
  }, [p]);
  return ref;
}

const SECTIONS = ["Find", "Fix", "Ship", "Explore"] as const;
export type Section = (typeof SECTIONS)[number];

const SUBTABS: Record<Section, string[]> = {
  Find: ["Browse repos", "Issues", "Your repos"],
  Fix: ["New run", "Runs"],
  Ship: ["Pull requests", "Impact"],
  Explore: [],
};

/** In click-through mode, where each menu item of the mock app goes: the
 *  chapter that shows that page. Items not listed here stay inert. */
const MENU_TARGETS: Record<string, string> = {
  Find: "find", "Browse repos": "find", Issues: "suggested",
  Fix: "newrun", "New run": "newrun", Runs: "run",
  Ship: "respond", "Pull requests": "respond", Impact: "impact",
  Explore: "understand", Settings: "setup",
};

/** A menu item of the mock app: a real link-like button in click-through mode. */
function MenuItem({ name, className, children }: { name: string; className: string; children?: ReactNode }) {
  const ix = useContext(InteractContext);
  const target = MENU_TARGETS[name];
  if (!ix || !target) return <span aria-hidden={children ? true : undefined} className={className}>{children ?? name}</span>;
  return (
    <button type="button" onClick={() => ix.open(target)} aria-label={children ? name : undefined} className={cn(className, "cursor-pointer transition-colors hover:bg-surface-3 hover:text-paper")}>
      {children ?? name}
    </button>
  );
}

/** The opensrcer app, drawn in markup: browser chrome, the signed-in header
 *  with its four sections, the section's sub-tabs, then the page. */
export function AppWindow({ path, section, tab, children, label, host = "opensrced.vercel.app" }: { path: string; section?: Section | "none"; tab?: string; children: ReactNode; label?: string; host?: string }) {
  const toCaption = useContext(FrameUrlContext);
  useEffect(() => { toCaption?.(`${host}${path}`); }, [toCaption, host, path]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!toCaption && <div className="flex items-center gap-2 border-b border-border-soft bg-ink-2 px-3 py-1.5 sm:px-4">
        <span className="mx-auto min-w-0 truncate text-center font-mono text-[12px] text-paper-faint">
          {host}{path}
        </span>
        {label && <span className="hidden shrink-0 text-[11px] text-paper-faint sm:inline">{label}</span>}
      </div>}
      {section && (
        <>
          <div className="flex items-stretch gap-1 border-b border-border-soft bg-surface px-3 sm:px-4">
            <span className="flex items-center pr-4 text-paper"><Wordmark className="text-[15px]" /></span>
            <span className="flex gap-1 sm:gap-3">
              {SECTIONS.map((s) => (
                <MenuItem key={s} name={s} className={cn("inline-flex min-h-9 items-center px-1.5 text-[12.5px]", s === section ? "font-medium text-paper shadow-[inset_0_-2px_0_var(--color-paper)]" : "text-paper-muted")} />
              ))}
            </span>
            <span className="ml-auto" />
            <MenuItem name="Settings" className="grid size-6 place-items-center rounded-full bg-paper text-[11px] font-semibold text-surface hover:!bg-paper-2 hover:!text-surface">R</MenuItem>
          </div>
          {section !== "none" && SUBTABS[section].length > 0 && (
            <div className="flex items-stretch gap-4 overflow-hidden border-b border-border-soft bg-surface px-3 sm:px-4">
              {SUBTABS[section].map((s) => (
                <MenuItem key={s} name={s} className={cn("inline-flex min-h-8 items-center whitespace-nowrap text-[12px]", s === tab ? "font-medium text-paper shadow-[inset_0_-2px_0_var(--color-paper)]" : "text-paper-muted")} />
              ))}
            </div>
          )}
        </>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">{children}</div>
    </div>
  );
}

/** Page heading as the real PageHeading draws it, scaled to the window. */
export function PageHead({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="display text-[22px] leading-tight text-paper sm:text-[26px]">{title}</h2>
      {description && <p className="mt-1 max-w-[60ch] text-[12px] leading-5 text-paper-muted">{description}</p>}
    </div>
  );
}

/** Scope badge colours, as on Discover and the issue scanner. */
export const SCOPE_TONE: Record<string, "ok" | "signal" | "info" | "alert"> = { doc: "ok", leaf: "signal", cross: "info", "new file": "info", refactor: "alert" };
/** Scope in plain words, as components/issue-scanner.tsx labels it ("Likely change: one file"). */
export const SCOPE_LABEL: Record<string, string> = { doc: "docs only", leaf: "one file", cross: "several files", "new file": "a new file", refactor: "many files" };
export const SEVERITY_TONE: Record<string, "muted" | "info" | "signal" | "alert"> = { low: "muted", medium: "info", high: "signal", critical: "alert" };

export function Pips({ value }: { value: number }) {
  const tone = value >= 4 ? "bg-signal" : value === 3 ? "bg-info" : "bg-paper-dim";
  return (
    <span className="inline-flex items-center gap-1" aria-label={`complexity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cn("h-1.5 w-2.5 rounded-sm", i <= value ? tone : "bg-surface-3")} />)}
      <span className="ml-0.5 font-mono text-[10.5px] text-paper-muted">{value}/5</span>
    </span>
  );
}

/** Inline `code` and **bold** in tour copy. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") ? <code key={i} className="rounded bg-surface-3 px-1 font-mono text-[0.92em] text-paper">{part.slice(1, -1)}</code>
          : part.startsWith("**") ? <strong key={i} className="font-semibold text-paper">{part.slice(2, -2)}</strong>
          : part,
      )}
    </>
  );
}

/** A log line coloured the way the real log viewer reads. */
export function LogLine({ text, spot }: { text: string; spot?: string }) {
  const cls = text.startsWith("[tool]") ? "text-[#64d2ff]"
    : text.startsWith("[agentic-pr] opened") ? "font-semibold text-[#30d158]"
    : text.startsWith("[gitleaks] status=clean") || text.startsWith("[verify] status=verified") ? "text-[#30d158]"
    : text.startsWith("[crucible-tests]") ? "text-[#ffd60a]"
    : text.startsWith("[") ? "text-[#8e8e93]"
    : text.startsWith("## ") ? "font-semibold text-white"
    : text.startsWith("+") && !text.startsWith("+++") ? "text-[#30d158]"
    : text.startsWith("-") && !text.startsWith("---") ? "text-[#ff6961]"
    : "text-[#e8e8ed]";
  return <div data-spot={spot} className={cn("whitespace-pre-wrap break-words", cls)}>{text || " "}</div>;
}

/** `spot` names a `data-spot` element the stage spotlights while this note is current. */
export type Caption = {
  at: number;
  text: string;
  spot?: string;
  /** Stage headlines only: one word or phrase of `text` to underline by hand. */
  mark?: string;
};

export const ACTS = ["Start", "Find", "Fix", "Ship", "Teams", "Trust"] as const;
export type Act = (typeof ACTS)[number];

export type Chapter = {
  id: string;
  /** The part of the story it belongs to; the chapter rail groups by it. */
  act: Act;
  /** Short name on the chapter rail. */
  label: string;
  /** Heading above the captions. */
  title: string;
  duration: number;
  captions: Caption[];
  /** Shown on the stage: what is real and what is example data. */
  source: string;
  /** On the stage only: the plain-language headline above the app, each from its `at`. */
  headlines?: Caption[];
  /** On the stage only: where what's on screen comes from ("Real run · Oct 24"), each from its `at`. */
  provenance?: Caption[];
  /** On the stage only: a slide on the paper itself, without the app's window frame. */
  poster?: boolean;
  /** On the stage only: where the chapter swaps to a new screen; the stage holds there until →. */
  holds?: number[];
  View: () => ReactNode;
};
