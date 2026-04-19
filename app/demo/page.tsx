"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// Pre-recorded dispatch replay — shows the full opensrcer pipeline
// without needing API keys or a GitHub connection.

const REPO = "acme-corp/web-app";
const ISSUE = "#47 — Fix: SQL injection in user search endpoint";

type Phase = { label: string; delay: number };
const PHASES: Phase[] = [
  { label: "clone", delay: 800 },
  { label: "explore", delay: 2000 },
  { label: "patch", delay: 3000 },
  { label: "test", delay: 1500 },
  { label: "PR", delay: 1000 },
];

const LOG_LINES = [
  { text: `[agentic-dispatcher] ${new Date().toISOString()}`, delay: 0 },
  { text: `[agentic-dispatcher] repo: ${REPO}  issue: #47`, delay: 100 },
  { text: `[agentic-dispatcher] bin: claude (-p headless, MCP)`, delay: 200 },
  { text: `[agentic-dispatcher] guardrails: --max-budget-usd=0.50 · timeout=1800s`, delay: 300 },
  { text: `[agentic-dispatcher] ─────────────────────────────`, delay: 400 },
  { text: ``, delay: 600 },
  { text: `Exploring the codebase to understand the issue...`, delay: 800 },
  { text: ``, delay: 900 },
  { text: `> repo_info: 142 files, top-level: src/, tests/, package.json`, delay: 1200 },
  { text: `> grep /searchUsers/ — 3 matches`, delay: 1800 },
  { text: `> read_file src/routes/users.ts (lines 1-45)`, delay: 2200 },
  { text: `> find_definition searchUsers — src/routes/users.ts:23`, delay: 2800 },
  { text: `> grep /db\\.query/ — 8 matches`, delay: 3200 },
  { text: `> read_file src/routes/users.ts (lines 20-35)`, delay: 3600 },
  { text: ``, delay: 3800 },
  { text: `## Diagnosis`, delay: 4000 },
  { text: ``, delay: 4100 },
  { text: `The \`searchUsers\` handler at src/routes/users.ts:25 interpolates`, delay: 4200 },
  { text: `user input directly into a SQL string via template literal.`, delay: 4400 },
  { text: `An attacker can inject arbitrary SQL through the \`q\` query param.`, delay: 4600 },
  { text: `Fix: use parameterized queries ($1 placeholder).`, delay: 4800 },
  { text: ``, delay: 5000 },
  { text: "```diff", delay: 5200 },
  { text: `--- a/src/routes/users.ts`, delay: 5300 },
  { text: `+++ b/src/routes/users.ts`, delay: 5400 },
  { text: `@@ -23,7 +23,11 @@ export async function searchUsers(req, res) {`, delay: 5500 },
  { text: `   const query = req.query.q;`, delay: 5600 },
  { text: "-  const results = await db.query(`SELECT * FROM users WHERE name LIKE '%${query}%'`);", delay: 5700 },
  { text: `+  const results = await db.query(`, delay: 5800 },
  { text: `+    "SELECT * FROM users WHERE name LIKE $1",`, delay: 5900 },
  { text: "+    [`%${query}%`]", delay: 6000 },
  { text: `+  );`, delay: 6100 },
  { text: `   return res.json(results.rows);`, delay: 6200 },
  { text: "```", delay: 6300 },
  { text: ``, delay: 6400 },
  { text: `## Risk / Test`, delay: 6500 },
  { text: ``, delay: 6600 },
  { text: `Checked 8 other db.query call sites — all already parameterized.`, delay: 6700 },
  { text: `Added test for injection vector. All 47 existing tests pass.`, delay: 6900 },
  { text: ``, delay: 7100 },
  { text: `## PR title`, delay: 7200 },
  { text: ``, delay: 7300 },
  { text: `fix: parameterize SQL in searchUsers to prevent injection`, delay: 7400 },
  { text: ``, delay: 7600 },
  { text: `[agentic-dispatcher] total_cost_usd=0.084700`, delay: 7800 },
  { text: `[agentic-dispatcher] ─────────────────────────────`, delay: 7900 },
  { text: `[agentic-dispatcher] exited at ${new Date().toISOString()} · status=succeeded · exit=0`, delay: 8000 },
  { text: ``, delay: 8100 },
  { text: `[agentic-pr] ─────────────────────────────`, delay: 8300 },
  { text: `[agentic-pr] starting auto-PR`, delay: 8400 },
  { text: `[crucible-tests] status=passed`, delay: 8800 },
  { text: `[crucible-tests] 47 tests passed, 0 failed`, delay: 9000 },
  { text: `[agentic-pr] opened draft PR: https://github.com/${REPO}/pull/48`, delay: 9400 },
  { text: `[agentic-pr] head: opensrcer/issue-47  →  base: main`, delay: 9600 },
];

export default function DemoPage() {
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  function start() {
    setStarted(true);
    setLines([]);
    setPhaseIdx(0);
    setDone(false);

    // Schedule log lines
    for (const l of LOG_LINES) {
      setTimeout(() => {
        setLines((prev) => [...prev, l.text]);
      }, l.delay);
    }

    // Schedule phase transitions
    let elapsed = 0;
    PHASES.forEach((p, i) => {
      elapsed += p.delay;
      setTimeout(() => setPhaseIdx(i), elapsed);
    });

    // Done
    setTimeout(() => setDone(true), LOG_LINES[LOG_LINES.length - 1].delay + 200);
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 border border-border bg-surface/40 px-3 py-1 text-[11px] text-paper-muted mb-6">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />
          live demo — no API key required
        </div>
        <h1 className="serif text-[36px] text-paper tracking-tight">
          Watch opensrcer solve a real issue
        </h1>
        <p className="mt-3 text-[13px] text-paper-dim max-w-lg mx-auto">
          This is a replay of the agent finding a SQL injection vulnerability,
          generating a parameterized-query fix, running tests, and opening a draft PR.
        </p>
      </div>

      <div className="border border-border bg-surface/40">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-signal"><path d="M9 2 3 9h4l-1 5 6-7H8l1-5z" /></svg>
            <span className="text-[13px] text-paper-muted">{REPO}</span>
            <span className="text-[12px] text-info border border-info/40 px-1.5 py-0.5 leading-none">#47</span>
          </div>
          <div className="mt-1.5 text-[17px] text-paper">{ISSUE.split(" — ")[1]}</div>
        </div>

        {/* Timeline */}
        {started && (
          <div className="px-4 py-2 border-b border-border">
            <div className="flex items-center gap-1">
              {PHASES.map((p, i) => (
                <div key={p.label} className="flex items-center gap-1">
                  {i > 0 && <div className={cn("w-4 h-px", i <= phaseIdx ? "bg-ok/40" : "bg-border")} />}
                  <span className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] border leading-none",
                    i < phaseIdx ? "border-ok/40 text-ok" :
                    i === phaseIdx ? "border-signal/40 text-signal" :
                    "border-border-soft text-paper-faint",
                  )}>
                    {i < phaseIdx ? "✓" : i === phaseIdx ? "●" : "○"} {p.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PR banner */}
        {done && (
          <div className="border-b border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
            <span className="text-[13px] text-ok">PR #48 opened</span>
            <span className="ml-auto text-[12px] text-paper-muted tabular-nums">$0.0847 · 3m 42s</span>
          </div>
        )}

        {/* Log */}
        {started ? (
          <pre
            ref={logRef}
            className="h-[45vh] overflow-auto p-4 text-[11.5px] leading-relaxed font-mono bg-ink/70 whitespace-pre-wrap"
          >
            {lines.map((l, i) => {
              let cls = "text-paper-dim";
              if (l.startsWith("[agentic-")) cls = "text-paper-faint";
              else if (l.startsWith(">")) cls = "text-signal";
              else if (l.startsWith("##")) cls = "text-paper font-medium";
              else if (l.startsWith("+") && !l.startsWith("+++")) cls = "text-ok";
              else if (l.startsWith("-") && !l.startsWith("---")) cls = "text-alert";
              else if (l.startsWith("@@")) cls = "text-info";
              else if (l.includes("passed")) cls = "text-ok";
              else if (l.includes("opened draft PR")) cls = "text-ok font-medium";
              return <div key={i} className={cls}>{l || "\u00a0"}</div>;
            })}
          </pre>
        ) : (
          <div className="h-[45vh] flex items-center justify-center">
            <button
              onClick={start}
              className="flex flex-col items-center gap-4 group"
            >
              <div className="w-16 h-16 border-2 border-signal/50 rounded-full flex items-center justify-center group-hover:border-signal group-hover:bg-signal/10 transition">
                <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="text-signal ml-1"><path d="M4 2.5v11l9-5.5z" /></svg>
              </div>
              <span className="text-[13px] text-paper-muted group-hover:text-paper transition">
                Start demo replay
              </span>
            </button>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <p className="text-[13px] text-paper-dim">
          {done ? "That's opensrcer. Ready to try it on your own repos?" : "This demo runs entirely in your browser — no API calls, no cost."}
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link
            href="/login"
            className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-5 py-2.5 text-[13px] transition"
          >
            Get started
          </Link>
          <Link
            href="/"
            className="border border-border text-paper-muted hover:text-paper px-5 py-2.5 text-[13px] transition"
          >
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}
