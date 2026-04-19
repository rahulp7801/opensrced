"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ── Demo data ─────────────────────────────────────────────────────────

const DEMOS = [
  { key: "dispatch", label: "Bug fix pipeline" },
  { key: "explore", label: "Codebase explorer" },
  { key: "security", label: "Security scan" },
] as const;

type DemoKey = (typeof DEMOS)[number]["key"];

// ── Dispatch demo data ────────────────────────────────────────────────

const DISPATCH_REPO = "acme-corp/web-app";

type Phase = { label: string; delay: number };
const PHASES: Phase[] = [
  { label: "clone", delay: 800 },
  { label: "explore", delay: 2000 },
  { label: "patch", delay: 3000 },
  { label: "test", delay: 1500 },
  { label: "PR", delay: 1000 },
];

const DISPATCH_LOG = [
  { text: `[agentic-dispatcher] 2026-04-19T04:30:00.000Z`, delay: 0 },
  { text: `[agentic-dispatcher] repo: ${DISPATCH_REPO}  issue: #47`, delay: 100 },
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
  { text: "The `searchUsers` handler at src/routes/users.ts:25 interpolates", delay: 4200 },
  { text: `user input directly into a SQL string via template literal.`, delay: 4400 },
  { text: "An attacker can inject arbitrary SQL through the `q` query param.", delay: 4600 },
  { text: `Fix: use parameterized queries ($1 placeholder).`, delay: 4800 },
  { text: ``, delay: 5000 },
  { text: "```diff", delay: 5200 },
  { text: `--- a/src/routes/users.ts`, delay: 5300 },
  { text: `+++ b/src/routes/users.ts`, delay: 5400 },
  { text: `@@ -23,7 +23,11 @@`, delay: 5500 },
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
  { text: ``, delay: 7600 },
  { text: `[agentic-dispatcher] total_cost_usd=0.084700`, delay: 7800 },
  { text: `[agentic-dispatcher] ─────────────────────────────`, delay: 7900 },
  { text: `[agentic-dispatcher] exited · status=succeeded · exit=0`, delay: 8000 },
  { text: ``, delay: 8100 },
  { text: `[agentic-pr] starting auto-PR`, delay: 8300 },
  { text: `[gemini-review] ─────────────────────────────`, delay: 8500 },
  { text: `[gemini-review] Patch looks correct. Parameterized query prevents injection.`, delay: 8600 },
  { text: `[gemini-review] No new vulnerabilities introduced.`, delay: 8700 },
  { text: `[crucible-tests] status=passed`, delay: 9000 },
  { text: `[crucible-tests] 47 tests passed, 0 failed`, delay: 9200 },
  { text: `[agentic-pr] opened draft PR: https://github.com/${DISPATCH_REPO}/pull/48`, delay: 9600 },
  { text: `[agentic-pr] head: opensrcer/issue-47  →  base: main`, delay: 9800 },
];

// ── Explore demo data ─────────────────────────────────────────────────

const EXPLORE_TOOLS = [
  { tool: "repo_info", detail: "overview", delay: 400 },
  { tool: "grep", detail: "/middleware/", delay: 1000 },
  { tool: "read_file", detail: "src/middleware/auth.ts", delay: 1600 },
  { tool: "find_definition", detail: "validateToken", delay: 2200 },
  { tool: "grep", detail: "/JWT|jsonwebtoken/", delay: 2800 },
  { tool: "read_file", detail: "src/utils/jwt.ts", delay: 3200 },
];

const EXPLORE_ANSWER = [
  { text: "## Authentication middleware\n", delay: 3800 },
  { text: "The auth middleware lives at **src/middleware/auth.ts**. ", delay: 4000 },
  { text: "It runs on every protected route and validates JWTs using ", delay: 4200 },
  { text: "the `jsonwebtoken` library.\n\n", delay: 4400 },
  { text: "**Key files:**\n", delay: 4600 },
  { text: "- `src/middleware/auth.ts:14` — main `validateToken()` function\n", delay: 4800 },
  { text: "- `src/utils/jwt.ts:8` — token signing/verification helpers\n", delay: 5000 },
  { text: "- `src/config/auth.ts` — JWT secret and expiry config\n\n", delay: 5200 },
  { text: "```typescript\n", delay: 5400 },
  { text: "// src/middleware/auth.ts:14\n", delay: 5500 },
  { text: "export function validateToken(req, res, next) {\n", delay: 5600 },
  { text: "  const token = req.headers.authorization?.split(' ')[1];\n", delay: 5700 },
  { text: "  if (!token) return res.status(401).json({ error: 'No token' });\n", delay: 5800 },
  { text: "  try {\n", delay: 5900 },
  { text: "    req.user = jwt.verify(token, config.jwtSecret);\n", delay: 6000 },
  { text: "    next();\n", delay: 6100 },
  { text: "  } catch {\n", delay: 6200 },
  { text: "    res.status(403).json({ error: 'Invalid token' });\n", delay: 6300 },
  { text: "  }\n", delay: 6400 },
  { text: "}\n", delay: 6500 },
  { text: "```\n", delay: 6600 },
];

// ── Security demo data ────────────────────────────────────────────────

const SECURITY_FINDINGS = [
  { severity: "critical", id: "CVE-2024-4068", pkg: "npm/braces", versions: "<3.0.3", summary: "Uncontrolled resource consumption via crafted glob patterns", delay: 800 },
  { severity: "high", id: "CVE-2024-43788", pkg: "npm/webpack", versions: "<5.94.0", summary: "Cross-site scripting in development server via malicious module names", delay: 1400 },
  { severity: "high", id: "GHSA-3xgq-45jj-v275", pkg: "npm/cross-spawn", versions: "<7.0.5", summary: "Command injection via shell metacharacters in arguments", delay: 2000 },
  { severity: "medium", id: "CVE-2024-47764", pkg: "npm/cookie", versions: "<0.7.0", summary: "Cookie parsing accepts untrusted input without validation", delay: 2600 },
  { severity: "medium", id: "CVE-2024-21538", pkg: "npm/cross-spawn", versions: "<7.0.6", summary: "Regular expression denial of service in argument parsing", delay: 3200 },
  { severity: "low", id: "CVE-2024-55565", pkg: "npm/nanoid", versions: "<3.3.8", summary: "Predictable ID generation when using non-secure random", delay: 3800 },
];

const SECURITY_SOLVE_LOG = [
  { text: "> Reading package.json...", delay: 4600 },
  { text: "> Found braces@2.3.2 — vulnerable to CVE-2024-4068", delay: 5000 },
  { text: "> Checking if braces is a direct dependency... indirect (via micromatch)", delay: 5400 },
  { text: "> Reading package-lock.json for resolution path...", delay: 5800 },
  { text: "> micromatch@4.0.5 → braces@2.3.2 (needs ≥3.0.3)", delay: 6200 },
  { text: "", delay: 6400 },
  { text: "## Fix", delay: 6600 },
  { text: "", delay: 6700 },
  { text: "Override braces to ^3.0.3 in package.json overrides field.", delay: 6800 },
  { text: "```diff", delay: 7000 },
  { text: '--- a/package.json', delay: 7100 },
  { text: '+++ b/package.json', delay: 7200 },
  { text: '@@ -45,6 +45,9 @@', delay: 7300 },
  { text: '+  "overrides": {', delay: 7400 },
  { text: '+    "braces": "^3.0.3"', delay: 7500 },
  { text: '+  },', delay: 7600 },
  { text: "```", delay: 7700 },
  { text: "", delay: 7900 },
  { text: "[crucible-tests] 156 tests passed, 0 failed", delay: 8200 },
  { text: "[agentic-pr] opened draft PR: https://github.com/acme-corp/web-app/pull/49", delay: 8600 },
];

// ── Page component ────────────────────────────────────────────────────

export default function DemoPage() {
  const [activeDemo, setActiveDemo] = useState<DemoKey>("dispatch");

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 border border-border bg-surface/40 px-3 py-1 text-[11px] text-paper-muted mb-6">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />
          interactive demo — no API key required
        </div>
        <h1 className="serif text-[36px] text-paper tracking-tight">
          See opensrcer in action
        </h1>
        <p className="mt-3 text-[13px] text-paper-dim max-w-lg mx-auto">
          Three demos running entirely in your browser. No API calls, no cost, no setup.
        </p>
      </div>

      {/* Demo tabs */}
      <div className="flex border-b border-border mb-0">
        {DEMOS.map((d) => (
          <button
            key={d.key}
            onClick={() => setActiveDemo(d.key)}
            className={cn(
              "px-4 py-2.5 text-[12px] transition relative",
              activeDemo === d.key ? "text-paper" : "text-paper-muted hover:text-paper-dim",
            )}
          >
            {d.label}
            {activeDemo === d.key && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-signal" />
            )}
          </button>
        ))}
      </div>

      {/* Demo content */}
      {activeDemo === "dispatch" && <DispatchDemo />}
      {activeDemo === "explore" && <ExploreDemo />}
      {activeDemo === "security" && <SecurityDemo />}

      {/* CTA */}
      <div className="mt-8 text-center">
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/login" className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-5 py-2.5 text-[13px] transition">
            Get started
          </Link>
          <Link href="/" className="border border-border text-paper-muted hover:text-paper px-5 py-2.5 text-[13px] transition">
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Dispatch demo ─────────────────────────────────────────────────────

function DispatchDemo() {
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  function start() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStarted(true);
    setLines([]);
    setPhaseIdx(0);
    setDone(false);

    for (const l of DISPATCH_LOG) {
      timers.current.push(setTimeout(() => setLines((p) => [...p, l.text]), l.delay));
    }
    let elapsed = 0;
    PHASES.forEach((p, i) => {
      elapsed += p.delay;
      timers.current.push(setTimeout(() => setPhaseIdx(i), elapsed));
    });
    timers.current.push(setTimeout(() => setDone(true), DISPATCH_LOG[DISPATCH_LOG.length - 1].delay + 200));
  }

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-signal"><path d="M9 2 3 9h4l-1 5 6-7H8l1-5z" /></svg>
          <span className="text-[13px] text-paper-muted">{DISPATCH_REPO}</span>
          <span className="text-[12px] text-info border border-info/40 px-1.5 py-0.5 leading-none">#47</span>
        </div>
        <div className="mt-1.5 text-[17px] text-paper">Fix: SQL injection in user search endpoint</div>
      </div>

      {started && (
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-1">
            {PHASES.map((p, i) => (
              <div key={p.label} className="flex items-center gap-1">
                {i > 0 && <div className={cn("w-4 h-px", i <= phaseIdx ? "bg-ok/40" : "bg-border")} />}
                <span className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] border leading-none",
                  i < phaseIdx ? "border-ok/40 text-ok" : i === phaseIdx ? "border-signal/40 text-signal" : "border-border-soft text-paper-faint",
                )}>
                  {i < phaseIdx ? "✓" : i === phaseIdx ? "●" : "○"} {p.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {done && (
        <div className="border-b border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
          <span className="text-[13px] text-ok">PR #48 opened</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-paper-muted tabular-nums">$0.0847 · 3m 42s</span>
            <button onClick={start} className="flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">
              replay
            </button>
          </span>
        </div>
      )}

      {started ? (
        <pre ref={logRef} className="h-[40vh] overflow-auto p-4 text-[11.5px] leading-relaxed font-mono bg-ink/70 whitespace-pre-wrap">
          {lines.map((l, i) => <LogLine key={i} text={l} />)}
        </pre>
      ) : (
        <PlayButton onClick={start} label="Start bug fix demo" />
      )}
    </div>
  );
}

// ── Explore demo ──────────────────────────────────────────────────────

function ExploreDemo() {
  const [started, setStarted] = useState(false);
  const [tools, setTools] = useState<Array<{ tool: string; detail: string }>>([]);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [answer]);

  function start() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStarted(true);
    setTools([]);
    setAnswer("");
    setDone(false);

    for (const t of EXPLORE_TOOLS) {
      timers.current.push(setTimeout(() => setTools((p) => [...p, { tool: t.tool, detail: t.detail }]), t.delay));
    }
    for (const a of EXPLORE_ANSWER) {
      timers.current.push(setTimeout(() => setAnswer((p) => p + a.text), a.delay));
    }
    timers.current.push(setTimeout(() => setDone(true), EXPLORE_ANSWER[EXPLORE_ANSWER.length - 1].delay + 200));
  }

  const toolColors: Record<string, string> = {
    repo_info: "text-paper-muted border-border-soft",
    grep: "text-signal border-signal/30",
    read_file: "text-info border-info/30",
    find_definition: "text-ok border-ok/30",
  };
  const toolIcons: Record<string, string> = { repo_info: "i", grep: "/", read_file: "#", find_definition: "@" };

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.15em] text-signal">Q</span>
        <span className="text-[13px] text-paper">Where is the authentication middleware and how does it work?</span>
      </div>

      {tools.length > 0 && (
        <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <span key={i} className={`text-[9.5px] tracking-[0.05em] px-1.5 py-0.5 border leading-none ${toolColors[t.tool] ?? ""}`}>
                {toolIcons[t.tool] ?? "?"} {t.detail}
              </span>
            ))}
            {!done && <span className="text-[9.5px] text-paper-faint animate-pulse">analyzing...</span>}
          </div>
        </div>
      )}

      {started ? (
        <div ref={ref} className="h-[40vh] overflow-auto px-4 py-4 text-[12.5px] leading-relaxed text-paper-dim whitespace-pre-wrap">
          {answer.split("\n").map((line, i) => {
            if (line.startsWith("## ")) return <div key={i} className="text-[13px] text-paper font-medium mt-3 first:mt-0">{line.slice(3)}</div>;
            if (line.startsWith("- ")) return <div key={i} className="flex gap-2 ml-1"><span className="text-paper-faint">-</span><span>{renderInline(line.slice(2))}</span></div>;
            if (line.startsWith("```")) return <div key={i} className="text-[10px] text-paper-faint font-mono">{line}</div>;
            if (line.startsWith("//")) return <div key={i} className="font-mono text-[11.5px] text-paper-faint">{line}</div>;
            if (/^\s*(export|const|function|import|if|try|catch|req\.|res\.|next|jwt\.|return|\}|{)/.test(line)) return <div key={i} className="font-mono text-[11.5px] text-paper-dim">{line}</div>;
            return <div key={i}>{renderInline(line) || "\u00a0"}</div>;
          })}
        </div>
      ) : (
        <PlayButton onClick={start} label="Start explore demo" />
      )}

      {done && (
        <div className="px-4 py-2.5 border-t border-border-soft flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">follow up:</span>
          {["What permissions does it check?", "How are tokens stored?", "Show me the test suite"].map((q, i) => (
            <span key={i} className="text-[11px] text-paper-dim border border-border-soft px-2 py-1">{q}</span>
          ))}
          <button onClick={start} className="ml-auto flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">
            replay
          </button>
        </div>
      )}
    </div>
  );
}

// ── Security demo ─────────────────────────────────────────────────────

function SecurityDemo() {
  const [started, setStarted] = useState(false);
  const [findings, setFindings] = useState<typeof SECURITY_FINDINGS>([]);
  const [solving, setSolving] = useState(false);
  const [solveLines, setSolveLines] = useState<string[]>([]);
  const [solveDone, setSolveDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [solveLines]);

  function startScan() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStarted(true);
    setFindings([]);
    setSolving(false);
    setSolveLines([]);
    setSolveDone(false);

    for (const f of SECURITY_FINDINGS) {
      timers.current.push(setTimeout(() => setFindings((p) => [...p, f]), f.delay));
    }
  }

  function startSolve() {
    setSolving(true);
    setSolveLines([]);
    setSolveDone(false);
    for (const l of SECURITY_SOLVE_LOG) {
      timers.current.push(setTimeout(() => setSolveLines((p) => [...p, l.text]), l.delay));
    }
    timers.current.push(setTimeout(() => setSolveDone(true), SECURITY_SOLVE_LOG[SECURITY_SOLVE_LOG.length - 1].delay + 200));
  }

  const sevColors: Record<string, string> = {
    critical: "border-red-700 bg-red-950/60 text-red-200",
    high: "border-orange-700 bg-orange-950/40 text-orange-200",
    medium: "border-yellow-700 bg-yellow-950/40 text-yellow-200",
    low: "border-blue-700 bg-blue-950/40 text-blue-200",
  };

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-signal">
            <path d="M8 1.5L2.5 4v4c0 3.5 2.3 6.1 5.5 7 3.2-.9 5.5-3.5 5.5-7V4L8 1.5z" />
            <path d="M6 8l1.5 1.5L10 6.5" />
          </svg>
          <span className="text-[13px] text-paper-muted">acme-corp/web-app</span>
          <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em] ml-2">security scan</span>
        </div>
        <div className="mt-1.5 text-[17px] text-paper">Advisories + Dependabot alerts</div>
      </div>

      {started ? (
        <>
          <div className="max-h-[25vh] overflow-auto divide-y divide-border-soft">
            {findings.map((f, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-3 animate-fade-rise">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono border ${sevColors[f.severity]}`}>{f.severity}</span>
                    <span className="text-[10.5px] font-mono text-paper-muted">{f.id}</span>
                    <span className="text-[10.5px] font-mono text-paper-muted">{f.pkg} {f.versions}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-paper-dim">{f.summary}</div>
                </div>
                {f.severity === "critical" && !solving && findings.length === SECURITY_FINDINGS.length && (
                  <button onClick={startSolve} className="shrink-0 text-[11px] text-paper border border-border bg-surface/60 hover:bg-surface px-2 py-1">
                    deep solve
                  </button>
                )}
              </div>
            ))}
          </div>

          {findings.length > 0 && findings.length < SECURITY_FINDINGS.length && (
            <div className="px-4 py-2 text-[10px] text-signal animate-pulse">scanning...</div>
          )}

          {findings.length === SECURITY_FINDINGS.length && !solving && (
            <div className="px-4 py-2.5 border-t border-border text-[11px] text-paper-muted">
              {SECURITY_FINDINGS.length} findings · {SECURITY_FINDINGS.filter(f => f.severity === "critical").length} critical · {SECURITY_FINDINGS.filter(f => f.severity === "high").length} high
            </div>
          )}

          {solving && (
            <>
              <div className="px-4 py-2 border-t border-border text-[10px] text-paper-muted uppercase tracking-[0.1em]">
                solving CVE-2024-4068 (critical)
              </div>
              <pre ref={logRef} className="h-[20vh] overflow-auto p-4 text-[11.5px] leading-relaxed font-mono bg-ink/70 whitespace-pre-wrap">
                {solveLines.map((l, i) => <LogLine key={i} text={l} />)}
              </pre>
            </>
          )}

          {solveDone && (
            <div className="border-t border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
              <span className="text-[13px] text-ok">PR #49 opened — CVE-2024-4068 remediated</span>
              <button onClick={startScan} className="ml-auto flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">
                replay
              </button>
            </div>
          )}
        </>
      ) : (
        <PlayButton onClick={startScan} label="Start security scan demo" />
      )}
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────

function PlayButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="h-[40vh] flex items-center justify-center">
      <button onClick={onClick} className="flex flex-col items-center gap-4 group">
        <div className="w-16 h-16 border-2 border-signal/50 rounded-full flex items-center justify-center group-hover:border-signal group-hover:bg-signal/10 transition">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="text-signal ml-1"><path d="M4 2.5v11l9-5.5z" /></svg>
        </div>
        <span className="text-[13px] text-paper-muted group-hover:text-paper transition">{label}</span>
      </button>
    </div>
  );
}

function LogLine({ text }: { text: string }) {
  let cls = "text-paper-dim";
  if (text.startsWith("[agentic-") || text.startsWith("[crucible-") || text.startsWith("[gemini-")) cls = "text-paper-faint";
  else if (text.startsWith(">")) cls = "text-signal";
  else if (text.startsWith("##")) cls = "text-paper font-medium";
  else if (text.startsWith("+") && !text.startsWith("+++")) cls = "text-ok";
  else if (text.startsWith("-") && !text.startsWith("---")) cls = "text-alert";
  else if (text.startsWith("@@")) cls = "text-info";
  else if (text.includes("passed")) cls = "text-ok";
  else if (text.includes("opened draft PR")) cls = "text-ok font-medium";
  return <div className={cls}>{text || "\u00a0"}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let ki = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith("**")) parts.push(<strong key={ki++} className="text-paper font-medium">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={ki++} className="text-signal bg-signal/10 px-1 py-0.5 text-[11px]">{tok.slice(1, -1)}</code>);
    last = match.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
