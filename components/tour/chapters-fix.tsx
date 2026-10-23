"use client";

// Tour act "Fix" (plus the pull request that opens "Ship"): starting a run, the
// real run on issue #2, reviewing its patch, a run that cannot finish, the run
// history, and the draft pull request it opened (rahulp7801/opensrcer-demo #6).

import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "@/components/status-dot";
import { AppWindow, Inline, LogLine, PageHead, Press, Reveal, Typed, progress, useAutoScroll, useFollow, useT, type Chapter } from "./kit";
import { DEMO_REPO, DIAGNOSIS, FAILED_RUN, ISSUE, PAST_RUNS, PATCH, PATCH_STATS, PR_BODY, REPORT, RISK, RUN, RUN_LOG, RUN_NOTES } from "./data";

// ── 5. The run ────────────────────────────────────────────────────────────

// The run plays from RUN_START to RUN_END; `f` is how far through it is (0-1).
const RUN_START = 800;
const RUN_END = 26000;
const runAt = (f: number) => RUN_START + f * (RUN_END - RUN_START);

const STAGES: Array<{ name: string; from: number; to: number; skipped?: boolean }> = [
  { name: "clone", from: 0, to: 0.05 },
  { name: "explore", from: 0.05, to: 0.38 },
  { name: "patch", from: 0.4, to: 0.66 },
  { name: "test", from: 0.86, to: 0.88, skipped: true },
  { name: "review", from: 0.73, to: 0.94 },
];

function Pipeline({ f }: { f: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Run stages">
      {STAGES.map((s, i) => {
        const done = f >= s.to;
        const active = !done && f >= s.from;
        const glyph = s.skipped && done ? "–" : done ? "✓" : active ? "●" : "○";
        return (
          <li key={s.name} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className={cn("h-px w-3 sm:w-4", done || active ? "bg-ok/50" : "bg-border")} />}
            <span className={cn("rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium leading-none",
              s.skipped && done ? "border-border text-paper-muted" : done ? "border-ok/40 text-ok" : active ? "border-signal/40 text-signal" : "border-border-soft text-paper-faint")}
              title={s.skipped ? "Repository tests are not run in hosted jobs" : undefined}>
              {glyph} {s.name}{s.skipped && done ? " · not run" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Log lines the stage's notes point at: the guardrails, the read-only tools, the preview. */
function logSpot(text: string): string | undefined {
  return text.includes("] guardrails:") ? "log-guardrails" : text.startsWith("[tool]") ? "log-tools" : text.startsWith("[preview]") ? "log-preview" : undefined;
}

function RunView() {
  const t = useT();
  const f = progress(t, RUN_START, RUN_END);
  const lines = RUN_LOG.filter((l) => l.at <= f);
  const done = f >= 1;
  const ready = f >= 0.94;
  const costShown = f >= 0.66;
  const seconds = Math.round(f * RUN.seconds);
  const elapsed = `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  const logRef = useFollow(lines.length);
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="grid h-full gap-3 overflow-hidden p-3 sm:p-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="hidden overflow-hidden rounded-2xl border border-border-soft bg-surface lg:block">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2 text-[12px]"><span className="font-medium text-paper">Pipelines</span><span className="font-mono text-paper-muted">{PAST_RUNS.length + 1}</span></div>
          <div className="bg-surface-2/80 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px]">
              <StatusDot tone={done ? "ok" : "signal"} />
              <span className="truncate text-paper">{DEMO_REPO} <span className="text-paper-faint">#{ISSUE.number}</span></span>
              <span className="ml-auto rounded-full border border-info/40 px-1 text-[10px] text-info">deep</span>
            </div>
            <p className="mt-1 truncate text-[11.5px] text-paper-dim">{ISSUE.title}</p>
            <p className="mt-1 text-[11px] text-paper-muted">just now · <span className={done ? "" : "text-signal"}>{elapsed}</span> · {ready ? <span className="text-ok">ready for review <span className="text-paper-faint">· unverified</span></span> : "running"}</p>
          </div>
          {PAST_RUNS.map((r) => (
            <div key={r.number} className="border-t border-border-soft px-3 py-2.5">
              <div className="flex items-center gap-2 text-[12px]">
                <StatusDot tone="ok" />
                <span className="truncate text-paper">{DEMO_REPO} <span className="text-paper-faint">#{r.number}</span></span>
                <span className="ml-auto flex gap-1">
                  <span className="rounded-full border border-info/40 px-1 text-[10px] text-info">deep</span>
                  {r.dry && <span className="rounded-full border border-info/40 px-1 text-[10px] text-info">dry</span>}
                </span>
              </div>
              <p className="mt-1 truncate text-[11.5px] text-paper-dim">{r.title}</p>
              <p className="mt-1 text-[11px] text-paper-muted">1d ago · {r.duration} · {r.status === "PR opened" ? <span className="text-ok">PR opened <span className="text-paper-faint">· unverified</span></span> : r.status}</p>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div data-spot="run-status" className="border-b border-border px-3 py-2.5 sm:px-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[11.5px] text-paper-muted">{DEMO_REPO} <span className="rounded-full border border-info/40 px-1.5 text-[10.5px] text-info">#{ISSUE.number}</span></p>
                <p className="mt-0.5 truncate text-[14px] font-medium text-paper">{ISSUE.title}</p>
                <p className="mt-0.5 text-[11px] text-paper-muted">just now · {elapsed}{costShown && <> · <span className="text-signal">${RUN.cost.toFixed(4)}</span></>}</p>
              </div>
              {ready ? <StatusChip tone="ok">ready for review</StatusChip> : <StatusChip tone="signal">live</StatusChip>}
            </div>
            <div className="mt-2"><Pipeline f={f} /></div>
          </div>
          {ready && (
            <Reveal at={runAt(0.94)} className="flex items-center justify-between border-b border-ok/30 bg-ok/5 px-3 py-1.5 text-[12px] sm:px-4">
              <span className="font-medium text-ok">Ready for review · nothing published yet</span>
              <span className="rounded-full border border-ok/40 px-2 py-0.5 text-[11px] text-ok">Review patch →</span>
            </Reveal>
          )}
          <div className="term relative min-h-0 flex-1 overflow-hidden rounded-none">
            {!done && <span className="absolute right-3 top-2 text-[10.5px] text-[#64d2ff]">● streaming</span>}
            <div ref={logRef} className="h-full overflow-hidden px-3 py-2.5 font-mono text-[10.5px] leading-[1.6] sm:px-4 sm:text-[11px]">
              {lines.map((l) => <LogLine key={l.at + l.text} text={l.text} spot={logSpot(l.text)} />)}
            </div>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export const run: Chapter = {
  id: "run",
  act: "Fix",
  label: "Watch it run",
  title: "Watch the agent work",
  duration: 28000,
  source: "Replay of real runs on opensrcer-demo #2 · the PR #6 run took 69 s and $0.20 · ends the way runs end now: at review",
  captions: [
    { at: 0, text: "The run starts in a fresh, isolated virtual machine with a spend cap. What follows replays the real run, sped up." },
    { at: runAt(0.08), text: "The agent explores like a new contributor: it reads the code and the tests, and finds every caller before it changes anything." },
    { at: runAt(0.3), text: "Before writing anything, it notes the project's conventions. There's no contribution guide here, so it matches the style the code already uses." },
    { at: runAt(0.4), text: "It writes down what's wrong and where, then the fix as a patch." },
    { at: runAt(0.72), text: "The run ends with everything frozen for review: the patch, the pull request text and the evidence. Nothing has been published." },
    { at: runAt(0.93), spot: "run-status", text: "69 seconds and 20 cents, end to end. The hosted service can't run the project's tests, so it says so: unverified, for you to check." },
  ],
  View: RunView,
};

// ── 6. Review ─────────────────────────────────────────────────────────────

function SplitDiff() {
  const file = PATCH[0];
  const rows = Math.max(file.before.length, file.after.length);
  return (
    <div className="overflow-hidden rounded-lg border border-border-soft">
      <p className="border-b border-border-soft bg-surface-2/60 px-3 py-1 font-mono text-[10.5px] text-paper-muted">{file.file}</p>
      <div className="grid grid-cols-2 divide-x divide-border-soft font-mono text-[9.5px] leading-[1.55] sm:text-[10.5px]">
        {[file.before, file.after].map((side, s) => (
          <div key={s} className={s === 0 ? "bg-alert/[0.04]" : "bg-ok/[0.04]"}>
            {Array.from({ length: rows }, (_, i) => {
              const text = side[i];
              const gap = text === undefined || text === null;
              const changed = !gap && (s === 0 ? file.removed.includes(i) : file.added.includes(i));
              return (
                <div key={i} className={cn("truncate whitespace-pre px-2", changed && (s === 0 ? "bg-alert/15 text-alert" : "bg-ok/15 text-ok"), gap && "bg-surface-2/50", !changed && "text-paper-dim")}>
                  {gap ? " " : `${changed ? (s === 0 ? "-" : "+") : " "}${text}`}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewView() {
  const t = useT();
  const open = t >= 1500;
  const scrollRef = useAutoScroll(7600, 12000);
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      {!open ? (
        <div className="p-4">
          <Press at={1100} label="Review patch" className="flex w-full items-center gap-3 rounded-xl border border-border-soft bg-surface px-4 py-3 text-left text-[12.5px]">
            <span className="font-medium text-paper">Review patch</span>
            <span className="text-paper-muted">{PATCH_STATS.files} files</span>
            <span className="text-ok">+{PATCH_STATS.additions}</span>
            <span className="text-alert">-{PATCH_STATS.deletions}</span>
            <span className="ml-auto text-signal">open review →</span>
          </Press>
        </div>
      ) : (
        <div className="absolute inset-0 bg-ink/80 p-2 backdrop-blur-sm sm:p-4">
          <Reveal at={1500} className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)]">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-paper">{RUN.prTitle}</p>
                <p className="text-[11px] text-paper-muted">{PATCH_STATS.files} files changed · <span className="text-ok">+{PATCH_STATS.additions} additions</span> · <span className="text-alert">-{PATCH_STATS.deletions} deletions</span></p>
              </div>
              <span className="text-[16px] text-paper-muted" aria-hidden>×</span>
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-3">
              <Reveal at={2200}>
                <p className="mono-label">What was found</p>
                <p className="mt-1 text-[12px] leading-5 text-paper-dim"><Inline text={DIAGNOSIS} /></p>
              </Reveal>
              <Reveal at={4300}>
                <p className="mono-label">Risk &amp; testing</p>
                <ul className="mt-1 space-y-0.5 text-[11.5px] leading-5 text-paper-dim">
                  {RISK.map((r) => <li key={r} className="flex gap-1.5"><span className="text-paper-faint">·</span><span><Inline text={r} /></span></li>)}
                </ul>
              </Reveal>
              <Reveal at={6400} spot="review-diff">
                <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-paper-muted">Files: {PATCH.map((p) => <code key={p.file} className="rounded bg-surface-2 px-1.5 font-mono text-paper">{p.file}</code>)}</p>
                <SplitDiff />
              </Reveal>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-[11.5px]">
              <Press at={13200} className="rounded-full border border-border px-2.5 py-0.5 text-paper-dim">{t >= 13200 ? "Copied ✓" : "Copy diff"}</Press>
              <Press at={14300} className="hidden rounded-full border border-border px-2.5 py-0.5 text-paper-dim sm:inline-flex">Commit msg</Press>
            </div>
            {/* The publish gate, as components/publish-panel.tsx shows it: nothing
                opens until the owner confirms. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-[11.5px]">
              <Press at={15800} label="I've read this change" className="flex items-center gap-1.5 text-paper">
                <span aria-hidden className={cn("grid h-3.5 w-3.5 place-items-center rounded-[3px] border text-[9px]", t >= 15800 ? "border-ok bg-ok/15 text-ok" : "border-border")}>{t >= 15800 ? "✓" : ""}</span>
                I&apos;ve read this change and can explain it to reviewers.
              </Press>
              <Press at={17400} label="Publish draft PR" className={cn("ml-auto rounded-full border px-2.5 py-0.5 font-medium", t >= 15800 ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-paper-faint")}>
                {t >= 17400 ? `Draft PR #${RUN.pr} opened ↗` : "Publish draft PR"}
              </Press>
            </div>
          </Reveal>
        </div>
      )}
    </AppWindow>
  );
}

export const review: Chapter = {
  id: "review",
  act: "Fix",
  label: "Review the patch",
  title: "Review every line",
  duration: 20000,
  source: "Real patch · opensrcer-demo PR #6 · publish step as it works since October 23",
  captions: [
    { at: 0, text: "Every run ends in something you can read in full: what the agent found, what it changed, and how to test it." },
    { at: 4300, text: "The risk notes say what to double-check, including what it deliberately left alone." },
    { at: 7600, spot: "review-diff", text: "The patch is shown side by side: the one broken line out, a small, commented fix in, and new tests." },
    { at: 13200, text: "Copy the diff, or a ready-made commit message, if you'd rather apply it yourself." },
    { at: 15000, text: "Nothing is published until you say so. A preview stops here. For a live run, you confirm you've read it and can explain it to reviewers." },
    { at: 17400, text: "Then it's scanned for leaked secrets and opens as a draft pull request, with exactly this patch and text." },
  ],
  View: ReviewView,
};

// ── 7. The draft pull request ─────────────────────────────────────────────

function PrView() {
  const scrollRef = useAutoScroll(3600, 9800);
  return (
    <AppWindow host="github.com" path={`/${DEMO_REPO}/pull/${RUN.pr}`}>
      <div ref={scrollRef} className="h-full overflow-hidden bg-surface px-4 py-4 sm:px-7">
        <Reveal at={0}>
          <p className="text-[19px] font-semibold leading-tight text-paper sm:text-[23px]">{RUN.prTitle} <span className="font-normal text-paper-muted">#{RUN.pr}</span></p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-paper-muted">
            <span className="rounded-full bg-surface-3 px-2.5 py-0.5 font-medium text-paper-dim">Draft</span>
            <span><span className="font-semibold text-paper">rahulp7801</span> wants to merge 1 commit into <code className="rounded bg-info/10 px-1 font-mono text-info">main</code> from <code className="rounded bg-info/10 px-1 font-mono text-info">{RUN.branch}</code></span>
          </div>
          <div className="mt-3 flex gap-4 border-b border-border text-[12px] text-paper-muted">
            <span className="border-b-2 border-[#fd8c73] pb-1.5 font-medium text-paper">Conversation</span>
            <span>Commits 1</span>
            <span className="hidden sm:inline">Checks 0</span>
            <span>Files changed {PATCH_STATS.files}</span>
            <span className="ml-auto hidden font-mono sm:inline"><span className="text-ok">+{PATCH_STATS.additions}</span> <span className="text-alert">−{PATCH_STATS.deletions}</span></span>
          </div>
        </Reveal>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_200px]">
          <Reveal at={900} spot="pr-body" className="overflow-hidden rounded-lg border border-border">
            <p className="border-b border-border bg-surface-2/60 px-3 py-1.5 text-[11.5px] text-paper-muted"><span className="font-semibold text-paper">rahulp7801</span> commented just now</p>
            <div className="space-y-2.5 px-3 py-3 text-[12px] leading-[1.6] text-paper-dim">
              {PR_BODY.map((block, i) => (
                <Reveal key={i} at={1400 + i * 900}>
                  {block.heading && <p className="mb-0.5 font-semibold text-paper">{block.heading}</p>}
                  <p className={block.text.startsWith("Fixes") ? "font-medium text-paper" : undefined}><Inline text={block.text} /></p>
                </Reveal>
              ))}
            </div>
          </Reveal>
          <Reveal at={2000} className="hidden space-y-3 text-[11.5px] text-paper-muted lg:block">
            <div><p className="font-semibold text-paper-dim">Reviewers</p><p>No reviews</p></div>
            <div><p className="font-semibold text-paper-dim">Development</p><p>Successfully merging this pull request may close <span className="text-signal">#2</span>.</p></div>
          </Reveal>
        </div>
        <Reveal at={7600} className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-[12px]">
          <span><span className="font-semibold text-paper">This pull request is still a work in progress</span><br /><span className="text-paper-muted">Draft pull requests cannot be merged.</span></span>
          <span className="rounded-md border border-border bg-surface px-3 py-1 font-medium text-paper">Ready for review</span>
        </Reveal>
      </div>
    </AppWindow>
  );
}

export const pr: Chapter = {
  id: "pr",
  act: "Ship",
  label: "Draft PR",
  title: "A draft pull request, in your name",
  duration: 13000,
  source: "Real pull request · github.com/rahulp7801/opensrcer-demo/pull/6",
  captions: [
    { at: 0, text: "When you publish, the draft pull request opens from your account, with your name on the commit." },
    { at: 3600, text: "The description explains the root cause, what changed and how to test it, written for the maintainer who has to review it." },
    { at: 6200, text: "And it says plainly that AI helped, who asked for it, and what was or wasn't tested. No hiding it from the maintainer." },
    { at: 8600, text: "It links the issue, so merging closes it. And it stays a draft: nothing merges until you and the maintainers decide." },
  ],
  View: PrView,
};

// ── Start from any link ───────────────────────────────────────────────────

const ISSUE_URL = `https://github.com/${DEMO_REPO}/issues/2`;
const BEFORE = [
  "Use an issue URL to start a worker. Repository URLs open the issue scanner.",
  "Preview creates a patch for review without publishing it.",
  "Live mode can open a draft PR and requires GitHub write access.",
];

function NewRunView() {
  const t = useT();
  const live = t >= 5200;
  const starting = t >= 11000 && t < 13300;
  const started = t >= 13300;
  // Brings the Start button into view on small screens; a no-op when it fits.
  const scrollRef = useAutoScroll(7000, 10600);
  return (
    <AppWindow path="/trigger" section="Fix" tab="New run">
      <div ref={scrollRef} className="h-full overflow-hidden px-4 py-4 sm:px-6">
        <PageHead title="New run" description="Paste a GitHub repo or issue URL. The AI agent will explore the codebase, generate a fix and open a draft PR after the configured checks." />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-3 rounded-2xl border border-border-soft bg-surface p-4">
            <div>
              <p className="text-[12px] font-medium text-paper">Repository</p>
              <p className="mt-1 truncate rounded-xl border border-border bg-surface px-3 py-2 font-mono text-[12px] text-paper"><Typed text={ISSUE_URL} at={600} cps={40} />&nbsp;</p>
            </div>
            <div>
              <p className="text-[12px] font-medium text-paper">Mode</p>
              <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-border text-[12px]">
                <span className={cn("px-3 py-1.5", !live ? "bg-info/10 text-info" : "text-paper-muted")}>preview</span>
                <Press at={5200} className={cn("rounded-none border-l border-border px-3 py-1.5", live ? "bg-signal/10 text-signal" : "text-paper-muted")}>live (PR after review)</Press>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-medium text-paper">Notes</p>
              <p className="mt-1 min-h-[48px] rounded-xl border border-border bg-surface px-3 py-2 text-[12px] leading-5 text-paper"><Typed text={RUN_NOTES} at={6800} cps={34} />&nbsp;</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Press at={11000} className="rounded-full border border-signal/50 bg-signal/10 px-4 py-1.5 text-[12.5px] font-medium text-signal">{starting ? "Starting run..." : live ? "Start live run →" : "Generate preview →"}</Press>
              {starting && <span className="text-[11.5px] text-paper-muted">Starting an isolated worker. This can take up to 90 seconds.</span>}
              {started && <Reveal at={13300} className="flex flex-wrap gap-x-1.5"><span className="text-[12px] text-ok">+ Run started</span><span className="text-[12px] text-signal">View live run</span></Reveal>}
            </div>
          </div>
          <div className="hidden rounded-2xl border border-border-soft bg-surface p-4 lg:block">
            <p className="text-[12.5px] font-medium text-paper">Before you start</p>
            <ol className="mt-2 space-y-2.5">
              {BEFORE.map((b, i) => <li key={b} className="grid grid-cols-[1.6rem_1fr] text-[11.5px] leading-5 text-paper-dim"><span className="font-mono text-paper-faint">0{i + 1}</span>{b}</li>)}
            </ol>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

export const newRun: Chapter = {
  id: "newrun",
  act: "Fix",
  label: "Start a run",
  title: "Start from any issue link",
  duration: 15000,
  source: "The New run form, filled in for the demo issue (example notes)",
  captions: [
    { at: 0, text: "Ready to fix it. Paste any GitHub issue link into a new run, or start one straight from the issue list." },
    { at: 5200, text: "Preview writes a patch without publishing anything. Live goes all the way to a draft pull request. We'll go live." },
    { at: 6800, text: "Notes steer the agent, like a short brief for a new contributor." },
    { at: 11000, text: "Starting a run boots a fresh, isolated worker in the cloud, ready in seconds." },
  ],
  View: NewRunView,
};

// ── When a run can't finish ───────────────────────────────────────────────

function FailureView() {
  const t = useT();
  const retrying = t >= 9800 && t < 11200;
  const restarted = t >= 11200;
  return (
    <AppWindow path="/dispatches" section="Fix" tab="Runs">
      <div className="h-full overflow-hidden p-3 sm:p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="border-b border-border px-3 py-2.5 sm:px-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[11.5px] text-paper-muted">{FAILED_RUN.repo} <span className="rounded-full border border-info/40 px-1.5 text-[10.5px] text-info">#{FAILED_RUN.number}</span></p>
                <p className="mt-0.5 truncate text-[14px] font-medium text-paper">{FAILED_RUN.title}</p>
                <p className="mt-0.5 text-[11px] text-paper-muted">12m ago · 1m 41s · <span className="text-signal">$0.1874</span></p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Press at={9800} className="rounded-full border border-signal/40 bg-signal/10 px-2.5 py-0.5 text-[11.5px] text-signal">{retrying ? "retrying…" : "retry"}</Press>
                <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-[11.5px] text-paper-muted sm:inline">export</span>
              </div>
            </div>
            <ol className="mt-2 flex flex-wrap items-center gap-1 text-[10.5px] font-medium">
              {["✓ clone", "✓ explore", "✓ patch", "– test", "× PR"].map((p, i) => (
                <li key={p} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden className="h-px w-3 bg-border sm:w-4" />}
                  <span className={cn("rounded-full border px-1.5 py-0.5 leading-none", p.startsWith("×") ? "border-alert/50 text-alert" : p.startsWith("–") ? "border-border text-paper-muted" : "border-ok/40 text-ok")}>{p}</span>
                </li>
              ))}
            </ol>
          </div>
          <Reveal at={2200} className="border-b border-alert/30 bg-alert/5 px-3 py-2 text-[12px] text-alert sm:px-4">
            <span className="font-medium">Auto-PR failed</span> — {FAILED_RUN.reason}
          </Reveal>
          <div className="term min-h-0 flex-1 overflow-hidden rounded-none px-3 py-2.5 font-mono text-[10.5px] leading-[1.6] sm:px-4 sm:text-[11px]">
            {FAILED_RUN.log.map((l, i) => <Reveal key={l} at={700 + i * 500}><LogLine text={l} /></Reveal>)}
          </div>
          {restarted && (
            <Reveal at={11200} className="flex items-center gap-2 border-t border-border-soft bg-surface-2/60 px-3 py-2 text-[12px] sm:px-4">
              <span className="size-1.5 animate-pulse rounded-full bg-signal" />
              <span className="text-paper">New run started on {FAILED_RUN.repo} #{FAILED_RUN.number}</span>
              <span className="ml-auto text-signal">live</span>
            </Reveal>
          )}
        </div>
      </div>
    </AppWindow>
  );
}

export const failure: Chapter = {
  id: "failure",
  act: "Fix",
  label: "When it can't finish",
  title: "When a run can't finish",
  duration: 16000,
  source: "Example run · fictional repository",
  captions: [
    { at: 0, text: "Not every run ends in a pull request, and opensrcer says so plainly instead of guessing." },
    { at: 3200, text: "Here the patch no longer applied cleanly to the branch. Nothing was pushed and no pull request opened. The reason is right there." },
    { at: 9800, text: "Retry starts a fresh run with the same settings. A run that reaches its spend cap stops the same way, with nothing half-finished published." },
  ],
  View: FailureView,
};

// ── Every run on record ───────────────────────────────────────────────────

/** Splits a log line around matches of `term`, marking each match. */
function Marked({ text, term }: { text: string; term: string }) {
  if (!term || !text.includes(term)) return <LogLine text={text} />;
  const parts = text.split(term);
  return (
    <div className="whitespace-pre-wrap break-words text-[#e8e8ed]">
      {parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <mark className="rounded-sm bg-[#ffd60a] px-0.5 text-[#1d1d1f]">{term}</mark>}</span>)}
    </div>
  );
}

function HistoryView() {
  const t = useT();
  const searching = t >= 2200;
  const term = t >= 4200 ? "gitleaks" : "";
  const report = t >= 7900;
  const tail = RUN_LOG.slice(-8);
  return (
    <AppWindow path={`/dispatches?dispatch=${RUN.id}`} section="Fix" tab="Runs">
      <div className="grid h-full gap-3 overflow-hidden p-3 sm:p-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="hidden overflow-hidden rounded-2xl border border-border-soft bg-surface lg:block">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2 text-[12px]"><span className="font-medium text-paper">Pipelines</span><span className="font-mono text-paper-muted">{PAST_RUNS.length + 1}</span></div>
          {[{ number: ISSUE.number, title: ISSUE.title, dry: false, duration: "1m 09s", status: "PR opened" }, ...PAST_RUNS].map((r, i) => (
            <div key={r.number} className={cn("border-t border-border-soft px-3 py-2.5 first:border-0", i === 0 && "bg-surface-2/80")}>
              <p className="truncate text-[12px] text-paper">{DEMO_REPO} <span className="text-paper-faint">#{r.number}</span></p>
              <p className="mt-0.5 truncate text-[11.5px] text-paper-dim">{r.title}</p>
              <p className="mt-0.5 text-[11px] text-paper-muted">{i === 0 ? "just now" : "1d ago"} · {r.duration} · {r.status === "PR opened" ? <span className="text-ok">PR opened</span> : r.status}</p>
            </div>
          ))}
        </div>
        <div className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-paper">{ISSUE.title}</p>
              <p className="text-[11px] text-paper-muted">just now · 1m 09s · <span className="text-signal">${RUN.cost.toFixed(4)}</span></p>
            </div>
            <Press at={7600} className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11.5px] text-paper-dim">export</Press>
          </div>
          <div className="term relative min-h-0 flex-1 overflow-hidden rounded-none">
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 text-[10.5px]">
              {searching ? (
                <span className="flex items-center gap-1.5 rounded-md bg-[#2c2c2e] px-2 py-1 text-[#e8e8ed]">
                  <Typed text="gitleaks" at={2600} cps={10} />{!term && <span className="text-[#aeaeb2]">search log...</span>}
                  {term && <span className="text-[#aeaeb2]">1 match</span>}
                </span>
              ) : (
                <>
                  <span className="rounded border border-[#48484a] px-1.5 py-0.5 text-[#e8e8ed]">plain</span>
                  <Press at={2200} className="rounded border border-[#48484a] px-1.5 py-0.5 text-[#e8e8ed]">search</Press>
                </>
              )}
            </div>
            <div className="h-full overflow-hidden px-3 py-2.5 pt-9 font-mono text-[10.5px] leading-[1.6] sm:px-4 sm:text-[11px]">
              {tail.map((l) => <Marked key={l.text} text={l.text} term={term} />)}
            </div>
          </div>
          {report && (
            <Reveal at={7900} className="absolute inset-x-3 bottom-3 top-14 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)] sm:inset-x-6">
              <p className="flex items-center justify-between border-b border-border-soft px-3 py-1.5 text-[11px] text-paper-muted"><span className="font-mono">{RUN.id}.md</span><span>downloaded</span></p>
              <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[10.5px] leading-[1.6] text-paper-dim">{REPORT.join("\n")}</pre>
            </Reveal>
          )}
        </div>
      </div>
    </AppWindow>
  );
}

export const history: Chapter = {
  id: "history",
  act: "Fix",
  label: "Every run on record",
  title: "Every run on record",
  duration: 14000,
  source: "Real runs on the demo repository",
  captions: [
    { at: 0, text: "Every run keeps its full log, so you can always see exactly what the agent did and what it cost." },
    { at: 2200, text: "Search the log, or switch on colors. Here: did the secret scan pass? It did." },
    { at: 7600, text: "Export a report with the cost, the pull request, the patch and the full log, to keep or to share." },
  ],
  View: HistoryView,
};
