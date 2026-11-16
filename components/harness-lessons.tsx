// The Account page's list of the user's lessons (lib/harness.ts listLessons):
// the progress the plugin records, step by step, shown on the site.

import type { LessonSummary } from "@/lib/harness";

// As harness/server.mjs STAGE_TEXT says it to the agent.
const STAGE: Record<string, string> = {
  kickoff: "Understanding the project and the issue",
  locate: "Finding where to look",
  predict: "Predicting the change",
  ide: "Writing the fix",
  reveal: "Ready to reveal the fix",
  explain: "Explaining the fix",
  next: "Next steps",
  done: "Done",
};
const STEP: Record<string, string> = {
  s1: "the project", s2: "resources", s3: "libraries", s4: "the task", s5: "questions", s6: "research",
  s7: "starting points", s8: "the change and its test", "explain-it": "explain it", s10: "next steps",
};

export function HarnessLessons({ lessons }: { lessons: LessonSummary[] | null }) {
  if (lessons === null) {
    return <p role="alert" className="callout" data-tone="warn">Your lessons couldn&apos;t be loaded just now. Reload the page to try again.</p>;
  }
  if (!lessons.length) {
    return <p className="text-[14px] text-paper-muted">No lessons yet. Ask your agent to teach you an issue, for example: <q>Teach me issue 429 in pallets/itsdangerous.</q></p>;
  }
  return (
    <ul className="card divide-y divide-border-soft overflow-hidden">
      {lessons.map((l) => (
        <li key={l.id} className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <a href={`https://github.com/${l.repo}/issues/${l.issue}`} target="_blank" rel="noreferrer" className="text-link text-[15px] font-semibold">{l.repo} #{l.issue}</a>
            <span className="text-[13px] text-paper-muted">Started {l.startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
          <p className="mt-1 text-[14px] text-paper">
            {STAGE[l.stage] ?? l.stage}
            <span className="text-paper-muted"> · {l.path === "self" ? "you write the fix" : "predict the hidden fix"}{l.answerKey === "verified" ? ", fix verified by tests" : ""}</span>
          </p>
          <p className="mt-0.5 text-[13.5px] text-paper-muted">
            {l.done.length ? `Done: ${l.done.map((s) => STEP[s] ?? s).join(", ")}` : "No steps done yet"}
          </p>
        </li>
      ))}
    </ul>
  );
}
