"use client";

// The reveal (PLAN §7.6): left the contributor's plan (s4, s7, s8 with their
// grades) or, on path B, their own diff; right the AI's fix, each hunk marked
// where the plan reached it. Then "where you differ" with the teacher, then
// explain-it (path A, the stricter §7.4 check: a sentence per changed file,
// why the test proves it, and the existing own-words check with its two
// practice questions, recorded on the server), then the existing publish
// panel, whose server gate still requires that recorded explanation.

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { parseSplitHunks } from "@/lib/diff-view";
import { previewChangeContext } from "@/lib/explain";
import { diffFiles, hunkVerdicts } from "@/lib/lesson/reveal";
import type { RulesPreview } from "@/lib/project-rules";
import type { StepGrade } from "@/lib/lesson/store";
import { cn } from "@/lib/utils";
import { SplitDiffView } from "../dispatch-list";
import { ForkCiPanel } from "../fork-ci-panel";
import { OwnWords, type OwnWordsResult } from "../own-words";
import { PublishPanel } from "../publish-panel";
import { DocsFirstCard, PrefsCard } from "./rapport-cards";
import { StepCard } from "./step-card";
import { TeacherChat } from "./teacher-chat";
import { fetchLesson, type LessonResponse, type PublicLesson } from "./types";

type Preview = RulesPreview & { title: string; body: string; files: string[]; diff?: string; diagnosis?: string };

export const DIFFER_PROMPT = "Would my approach also work? What would it miss?";
const PLAN_STEPS = ["s4", "s7", "s8"] as const;

/** A saved answer as text: s7's picks are stored as a JSON list. */
function planAnswer(answer: string): string {
  if (!answer.startsWith("[")) return answer;
  try { return (JSON.parse(answer) as string[]).join("\n"); } catch { return answer; }
}

function GradeLine({ grade, done }: { grade: StepGrade | null; done: boolean }) {
  if (grade) return <p className={cn("mt-1 text-[14px]", grade.passed ? "text-ok" : "text-alert")}>{grade.passed ? "Passed" : "Not passed"}: <span className="text-paper-dim">{grade.feedback}</span></p>;
  return <p className="mt-1 text-[14px] text-paper-muted">{done ? "Saved, not graded" : "Not answered"}</p>;
}

export function RevealView({ lessonId, forkCi }: { lessonId: string; forkCi: boolean }) {
  const [data, setData] = useState<LessonResponse | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<OwnWordsResult | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const onWords = useCallback((r: OwnWordsResult) => setWords(r), []);

  const reload = useCallback(() => fetchLesson(lessonId).then(setData, (e: Error) => setError(e.message)), [lessonId]);
  useEffect(() => { void reload(); }, [reload]);
  const runId = data?.lesson.revealed ? data.lesson.run_id : null;
  useEffect(() => {
    if (!runId) return;
    fetch(`/api/dispatches/${runId}/preview`)
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not load the AI's fix."); setPreview(body); })
      .catch((e: Error) => setError(e.message));
  }, [runId]);
  const setLesson = (lesson: PublicLesson) => setData((d) => (d ? { ...d, lesson } : d));

  async function reveal(giveUp: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/reveal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(giveUp ? { give_up: true } : {}) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not reveal (${res.status}).`);
      setLesson(body.lesson);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reveal.");
    } finally {
      setBusy(false);
    }
  }

  const lesson = data?.lesson;
  const byId = useMemo(() => new Map((lesson?.steps ?? []).map((s) => [s.id, s])), [lesson]);
  const planText = PLAN_STEPS.map((id) => planAnswer(byId.get(id)?.answer ?? "")).join("\n");
  const verdicts = useMemo(() => {
    if (!preview?.diff || !lesson) return undefined;
    return hunkVerdicts(parseSplitHunks(preview.diff), lesson.path === "B" ? { diff: lesson.ide_diff ?? "" } : { plan: planText });
  }, [preview, lesson, planText]);

  if (!data || !lesson) return error ? <div role="alert" className="callout mx-auto mt-10 max-w-xl" data-tone="alert">{error}</div> : <p role="status" className="mx-auto mt-10 max-w-xl text-paper-muted">Loading…</p>;

  if (!lesson.revealed) {
    return (
      <div className="mx-auto mt-10 max-w-xl px-4">
        <h1 className="display text-[28px] text-paper">The reveal</h1>
        {lesson.stage === "reveal" ? (
          <>
            <p className="mt-2 text-paper-dim">You&apos;ve predicted the change. See the AI&apos;s fix next to your plan.</p>
            <button type="button" disabled={busy} onClick={() => void reveal(false)} className="btn-primary mt-4">{busy ? "Revealing…" : "See the AI's fix"}</button>
          </>
        ) : (
          <>
            <p className="mt-2 text-paper-dim">The AI&apos;s fix stays hidden until you&apos;ve predicted the change (s8), or you choose to give up.</p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Link href={`/learn/${lessonId}`} className="btn-primary">Back to the lesson</Link>
              <button type="button" disabled={busy} onClick={() => { if (confirm("See the AI's fix now, without predicting it yourself?")) void reveal(true); }} className="link">Give up and see the fix</button>
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-4 text-alert">{error}</p>}
      </div>
    );
  }

  const explain = byId.get("explain-it");
  const next = byId.get("s10");
  const explainDone = explain?.done === true;
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <p className="meta"><span>reveal</span><Link href={`/learn/${lessonId}`}>{lesson.repo_url.replace("https://github.com/", "")}#{lesson.issue_number}</Link>{lesson.gave_up && <span>gave up</span>}</p>
      <h1 className="display mt-1 text-[30px] leading-tight text-paper">{lesson.path === "B" ? "Your code and the AI's" : "Your plan and the AI's fix"}</h1>
      {error && <p role="alert" className="mt-3 text-alert">{error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="yours" className="min-w-0">
          <h2 id="yours" className="label-mono">{lesson.path === "B" ? "Your diff" : "Your plan"}</h2>
          {lesson.path === "B" ? (
            lesson.ide_diff?.trim()
              ? <div className="card mt-2 overflow-hidden"><SplitDiffView body={lesson.ide_diff} className="max-h-[70vh]" /></div>
              : <p className="mt-2 text-paper-muted">You didn&apos;t submit any code from the editor.</p>
          ) : (
            <ol className="mt-2 space-y-4">
              {PLAN_STEPS.map((id) => {
                const s = byId.get(id);
                if (!s) return null;
                return (
                  <li key={id} className="card p-4">
                    <p className="font-semibold text-paper">{s.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[15px] text-paper-dim">{planAnswer(s.answer) || "—"}</p>
                    <GradeLine grade={s.grade} done={s.done} />
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <section aria-labelledby="theirs" className="min-w-0">
          <h2 id="theirs" className="label-mono">The AI&apos;s fix</h2>
          {!preview ? <p role="status" className="mt-2 text-paper-muted">Loading the fix…</p> : (
            <>
              <p className="mt-2 font-semibold text-paper">{preview.title}</p>
              {preview.diagnosis && <p className="mt-1 whitespace-pre-wrap text-[15px] text-paper-dim">{preview.diagnosis}</p>}
              {preview.diff
                ? <div className="card mt-3 overflow-hidden"><SplitDiffView body={preview.diff} verdicts={verdicts} className="max-h-[70vh]" /></div>
                : <p className="mt-2 text-paper-muted">This run has no diff.</p>}
            </>
          )}
        </section>
      </div>

      <section aria-label="Where you and the AI differ" className="mt-10 max-w-3xl">
        <h2 className="text-[20px] font-semibold text-paper">Where you and the AI differ</h2>
        <p className="mt-1 text-paper-dim">Talk it through: would your approach also have worked, and what would it have missed?</p>
        {/* Only the talk since the reveal: earlier steps' chat is about finding the fix, not comparing it. */}
        <TeacherChat lessonId={lessonId} initial={data.messages.filter((m) => Date.parse(m.at) >= Date.parse(data.lesson.revealed_at ?? ""))} step={null} available={data.teacher_available} starters={[DIFFER_PROMPT]} className="mt-4 max-h-[60vh]" />
      </section>

      {preview?.diff && (
        <section aria-label="Explain it" className="mt-10 max-w-3xl">
          <h2 className="text-[20px] font-semibold text-paper">Explain it</h2>
          <div className="-mt-6">
            <OwnWords
              storageKey={`run:${lesson.run_id}`} runId={lesson.run_id} repo={lesson.repo_url} title={preview.title}
              context={previewChangeContext(preview, preview.diff)} copySources={[preview.diagnosis ?? "", preview.body]} onResult={onWords}
            />
          </div>
          {lesson.path === "A" && (
            <ExplainIt
              lessonId={lessonId} files={diffFiles(preview.diff)} saved={explain} ready={Boolean(words?.ready && words.practiced)}
              open={lesson.stage === "explain"} onLesson={setLesson}
            />
          )}
        </section>
      )}

      {lesson.path === "A" && explainDone && preview && (
        <section aria-label="Publish" className="mt-10">
          <div className="mb-6 max-w-3xl"><PrefsCard lessonId={lessonId} repo={lesson.repo_url.replace("https://github.com/", "")} /></div>
          <PublishPanel dispatchId={lesson.run_id} repo={lesson.repo_url} issue={lesson.issue_number} authorWords={words} onPublished={setPublished} />
          {published && forkCi && <ForkCiPanel dispatchId={lesson.run_id} />}
        </section>
      )}
      {lesson.path === "B" && (
        <p className="callout mt-10 max-w-3xl" data-tone="info">
          Publishing your own code comes with the check-my-work step (your tests in a sandbox first). The publish panel here would send the AI&apos;s version, so it isn&apos;t offered on this path.
        </p>
      )}

      {next && (lesson.stage === "next" || next.done) && (
        <div className="mt-10 max-w-3xl">
          <StepCard key="s10" lessonId={lessonId} step={next} answerKey={lesson.answer_key} open={lesson.stage === "next"} onLesson={setLesson} />
          {data.docs_issue && <div className="mt-6"><DocsFirstCard repoUrl={lesson.repo_url} draft={data.docs_issue} /></div>}
        </div>
      )}
    </div>
  );
}

/** Path A's stricter part of explain-it: a sentence per changed file and why
 *  the test proves the fix. The server also requires the two practice answers. */
function ExplainIt({ lessonId, files, saved, ready, open, onLesson }: {
  lessonId: string; files: string[]; saved?: PublicLesson["steps"][number]; ready: boolean; open: boolean; onLesson: (l: PublicLesson) => void;
}) {
  const initial = useMemo(() => {
    try { return saved?.answer ? (JSON.parse(saved.answer) as { files: Record<string, string>; test: string }) : null; } catch { return null; }
  }, [saved]);
  const [sentences, setSentences] = useState<Record<string, string>>(initial?.files ?? {});
  const [test, setTest] = useState(initial?.test ?? "");
  const [grade, setGrade] = useState<StepGrade | null>(saved?.grade ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testId = useId();

  async function check() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/steps/explain-it`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: { files: sentences, test } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not check (${res.status}).`);
      setGrade(body.step.grade);
      onLesson(body.lesson);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-paper-dim">Three parts: a sentence for each file the fix changes, why its test proves the fix, on top of your own explanation and the two practice review questions above.</p>
      <ol className="mt-4 space-y-4">
        {files.map((file, i) => (
          <li key={file}>
            <label htmlFor={`${testId}-f${i}`} className="block font-mono text-[13px] text-paper-dim">{file}</label>
            <input id={`${testId}-f${i}`} value={sentences[file] ?? ""} disabled={!open} onChange={(e) => setSentences((s) => ({ ...s, [file]: e.target.value }))}
              maxLength={600} placeholder="What this file's change does, in one sentence" className="field mt-1 w-full" />
          </li>
        ))}
      </ol>
      <label htmlFor={testId} className="label-mono mt-5 block">Why the test proves the fix</label>
      <textarea id={testId} value={test} disabled={!open} onChange={(e) => setTest(e.target.value)} rows={4} maxLength={2000} className="paper-field mt-1"
        placeholder="What the test does, and why it fails without the fix and passes with it (40 characters or more)" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void check()} disabled={!open || pending || !ready} className="btn-primary" data-size="sm">{pending ? "Checking…" : "Check explain-it"}</button>
        {!ready && open && <span className="text-[14px] text-paper-muted">Pass your own-words check and answer both practice questions first.</span>}
      </div>
      <div aria-live="polite" className="mt-3 empty:hidden">
        {error && <p role="alert" className="text-alert">{error}</p>}
        {grade && <p className={grade.passed ? "text-ok" : "text-alert"}><span className="font-semibold">{grade.passed ? "Passed. " : "Not yet. "}</span><span className="text-paper-dim">{grade.feedback}</span></p>}
      </div>
    </div>
  );
}
