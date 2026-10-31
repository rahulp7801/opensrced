"use client";

// The lesson page (PLAN §7.8): left the stepper and the current step, centre
// the code at the lesson's commit, right the teacher. Above them, the path
// choice (A: the AI writes a hidden fix, you plan and explain; B: you write
// it in the editor), the mode, and the hidden fix's progress as a phase only
// (no file names, no titles). On phones the three columns become tabs.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { canSubmit, STEP_IDS, type StepId } from "@/lib/lesson/machine";
import type { RunPhase } from "@/lib/hidden-runs";
import { pollJson } from "@/lib/poll-json";
import { cn } from "@/lib/utils";
import { MapNote } from "../project-map";
import { StatusChip } from "../status-dot";
import { CodeViewer } from "./code-viewer";
import { StepCard } from "./step-card";
import { TeacherChat } from "./teacher-chat";
import { fetchLesson, type LessonResponse, type PublicLesson } from "./types";

const STATUS_POLL_MS = 5_000;
const PHASE_TONE: Record<RunPhase, "signal" | "ok" | "alert"> = { setting_up: "signal", solving: "signal", proving: "signal", ready: "ok", failed: "alert" };
const BEFORE_REVEAL = ["kickoff", "locate", "predict", "ide"];
type Tab = "step" | "code" | "teacher";

export const PATHS = {
  A: { name: "Plan it, then see the AI's fix", blurb: "An AI solves the issue in secret while you work out where and how to fix it. Then you compare and explain." },
  B: { name: "Write it yourself", blurb: "Same steps, then you write the fix in the editor and compare it with the AI's. Needs a laptop or desktop." },
} as const;

export function LessonView({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [data, setData] = useState<LessonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<{ phase: RunPhase; label: string } | null>(null);
  const [selected, setSelected] = useState<StepId | null>(null);
  const [tab, setTab] = useState<Tab>("step");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => fetchLesson(lessonId).then(setData, (e: Error) => setError(e.message)), [lessonId]);
  useEffect(() => { void reload(); }, [reload]);

  // Progress of the hidden fix; once it settles, the answer key's status may have changed.
  const lastPhase = useRef<RunPhase | null>(null);
  useEffect(() => pollJson<{ phase: RunPhase; label: string }>(`/api/lessons/${lessonId}/status`, ({ data: s }) => {
    if (!s) return true;
    const settled = s.phase === "ready" || s.phase === "failed";
    if (lastPhase.current && lastPhase.current !== s.phase && settled) void reload();
    lastPhase.current = s.phase;
    setPhase(s);
    return !settled;
  }, STATUS_POLL_MS), [lessonId, reload]);

  const setLesson = useCallback((lesson: PublicLesson) => setData((d) => (d ? { ...d, lesson } : d)), []);

  async function act(name: string, path: string, method: string, body: object, then?: (lesson: PublicLesson) => void) {
    setBusy(name);
    setActionError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { lesson?: PublicLesson; error?: string };
      if (!res.ok || !out.lesson) throw new Error(out.error ?? `Request failed (${res.status}).`);
      setLesson(out.lesson);
      then?.(out.lesson);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div role="alert" className="callout mx-auto mt-10 max-w-xl" data-tone="alert">{error}</div>;
  if (!data) return <p role="status" className="mx-auto mt-10 max-w-xl text-paper-muted">Loading the lesson…</p>;
  const { lesson } = data;
  const repo = lesson.repo_url.replace("https://github.com/", "");
  const byId = new Map(lesson.steps.map((s) => [s.id, s]));
  const ordered = STEP_IDS.filter((id) => byId.has(id) && id !== "explain-it" && id !== "s10");
  const required = ordered.filter((id) => lesson.required.includes(id));
  const optional = ordered.filter((id) => !lesson.required.includes(id));
  const nextUp = required.find((id) => !byId.get(id)!.done && canSubmit(lesson.stage, id)) ?? null;
  const current = selected && byId.has(selected) ? selected : nextUp;
  const step = current ? byId.get(current)! : null;
  const pathOpen = !lesson.revealed && ["kickoff", "locate", "predict"].includes(lesson.stage);
  const beforeReveal = !lesson.revealed && BEFORE_REVEAL.includes(lesson.stage);
  const goReveal = () => router.push(`/learn/${lessonId}/reveal`);

  const stepButton = (id: StepId) => {
    const s = byId.get(id)!;
    return (
      <li key={id}>
        <button type="button" onClick={() => { setSelected(id); setTab("step"); }} aria-current={id === current ? "step" : undefined}
          className={cn("flex min-h-9 w-full items-baseline gap-2 text-left text-[15px]", id === current ? "font-semibold text-paper" : "text-paper-dim hover:text-paper")}>
          <span aria-hidden className={cn("w-4 font-mono text-[12px]", s.done ? "text-ok" : "text-paper-faint")}>{s.done ? "✓" : "·"}</span>
          <span>{s.title}</span>
          <span className="sr-only">{s.done ? "(done)" : ""}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-border-soft pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="meta">
            <span>lesson</span>
            <a href={`${lesson.repo_url}/issues/${lesson.issue_number}`} target="_blank" rel="noreferrer">{repo}#{lesson.issue_number}<span aria-hidden>↗</span></a>
            <span>{lesson.mode} mode</span>
            {"limit" in lesson.turns && <span>{lesson.turns.left} AI turns left</span>}
          </p>
          <h1 className="display mt-1 text-[28px] leading-tight text-paper">Fix {repo} #{lesson.issue_number}, step by step</h1>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-paper-dim" aria-live="polite">
          <span>The AI&apos;s hidden fix:</span>
          {phase ? <StatusChip tone={PHASE_TONE[phase.phase]}>{phase.label}</StatusChip> : <span className="text-paper-muted">checking…</span>}
        </p>
      </header>
      {/* The project map, when this repository is not new to them (PLAN §9.4). */}
      {lesson.stage === "kickoff" && <MapNote repo={repo} issue={lesson.issue_number} />}

      {/* Path and mode: the path until s8, the mode during kickoff. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <fieldset disabled={!pathOpen || busy !== null}>
          <legend className="field-label">How you&apos;ll learn {pathOpen ? "(you can change this until you predict the change)" : ""}</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {(["A", "B"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={lesson.path === p} onClick={() => lesson.path !== p && void act("path", "", "PATCH", { path: p })}
                className={cn("rounded-lg p-3 text-left shadow-[inset_0_0_0_1px_var(--color-border-soft)] disabled:opacity-60", lesson.path === p && "shadow-[inset_0_0_0_2px_var(--color-signal)]")}>
                <span className="block font-semibold text-paper">{p}. {PATHS[p].name}</span>
                <span className="mt-0.5 block text-[14px] leading-snug text-paper-dim">{PATHS[p].blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={lesson.stage !== "kickoff" || busy !== null} className="self-end">
          <legend className="field-label">Mode</legend>
          <div className="mt-1 flex gap-1.5">
            {(["short", "full"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={lesson.mode === m} onClick={() => lesson.mode !== m && void act("mode", "", "PATCH", { mode: m })} className="pill" data-size="sm" data-edge="">
                {m === "short" ? "Short (4 steps)" : "Full (every step)"}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {actionError && <p role="alert" className="mt-3 text-alert">{actionError}</p>}

      <nav aria-label="Lesson panels" className="tab-strip mt-4 lg:hidden" role="tablist">
        {(["step", "code", "teacher"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "step" ? "Step" : t === "code" ? "Code" : "Teacher"}</button>
        ))}
      </nav>

      <div className="mt-4 grid gap-6 lg:h-[calc(100svh-17rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)_minmax(280px,360px)]">
        <div className={cn("min-h-0 space-y-5 overflow-y-auto lg:pr-1", tab !== "step" && "max-lg:hidden")}>
          <nav aria-label="Steps">
            <ol>{required.map(stepButton)}</ol>
            {optional.length > 0 && (
              <>
                <p className="label-mono mt-3">{lesson.mode === "short" ? "Optional" : "More"}</p>
                <ol>{optional.map(stepButton)}</ol>
              </>
            )}
          </nav>

          {/* What happens next, once the steps of this stage are done. */}
          {lesson.stage === "reveal" && !lesson.revealed && (
            <div className="callout" data-tone="ok">
              <p className="font-semibold text-paper">You&apos;ve made your prediction.</p>
              <p className="mt-1">Now see the AI&apos;s fix next to your plan, and find where you differ.</p>
              <button type="button" disabled={busy !== null} onClick={() => void act("reveal", "/reveal", "POST", {}, goReveal)} className="btn-primary mt-3" data-size="sm">
                {busy === "reveal" ? "Revealing…" : "See the AI's fix"}
              </button>
            </div>
          )}
          {lesson.path === "B" && beforeReveal && (
            <div className="callout" data-tone="info">
              <p className="font-semibold text-paper">{lesson.stage === "ide" ? "Now write the fix yourself." : "The editor is ready when you are."}</p>
              <p className="mt-1">{lesson.ide_submitted ? "Your work is submitted." : "When you're done, press \"I'm done, check my work\" in the editor."}</p>
              {lesson.base_sha
                ? <Link href={`/learn/${lessonId}/code`} className="btn-primary mt-3 max-lg:hidden" data-size="sm">Open the editor</Link>
                : <p className="mt-2 text-paper-muted">The editor opens once the lesson&apos;s commit is pinned. Reload in a minute.</p>}
              <p className="mt-2 font-medium text-paper lg:hidden">The editor needs a larger screen. Open this lesson on a laptop or desktop to write the fix.</p>
            </div>
          )}
          {lesson.revealed && (
            <Link href={`/learn/${lessonId}/reveal`} className="btn-primary" data-size="sm">Go to the reveal</Link>
          )}

          {/* The card stays on its step after Check, so the feedback can be read. */}
          {step && <StepCard key={step.id} lessonId={lessonId} step={step} answerKey={lesson.answer_key} open={canSubmit(lesson.stage, step.id)} onLesson={(l) => { setLesson(l); setSelected(step.id); }} />}
          {step?.done && nextUp && nextUp !== step.id && (
            <button type="button" onClick={() => setSelected(nextUp)} className="row-cta">Next: {byId.get(nextUp)!.title} <span aria-hidden>→</span></button>
          )}
          {!step && beforeReveal && lesson.stage !== "reveal" && lesson.stage !== "ide" && <p className="text-paper-muted">Pick a step on the left.</p>}

          {beforeReveal && (
            <p className="text-[14px] text-paper-muted">
              Stuck for good?{" "}
              <button type="button" disabled={busy !== null} className="link"
                onClick={() => { if (confirm("See the AI's fix now? You can still explain it afterwards, but you won't predict it yourself.")) void act("reveal", "/reveal", "POST", { give_up: true }, goReveal); }}>
                Give up and see the fix
              </button>
            </p>
          )}
        </div>

        <CodeViewer repo={repo} sha={lesson.base_sha} className={cn("min-h-[60svh] lg:min-h-0", tab !== "code" && "max-lg:hidden")} />

        <TeacherChat
          lessonId={lessonId} initial={data.messages} step={current} available={data.teacher_available}
          onTurn={() => void reload()}
          className={cn("min-h-[60svh] lg:min-h-0", tab !== "teacher" && "max-lg:hidden")}
        />
      </div>
    </div>
  );
}
