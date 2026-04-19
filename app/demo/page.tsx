"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const DEMOS = [
  { key: "dispatch", label: "Bug fix pipeline" },
  { key: "explore", label: "Codebase explorer" },
  { key: "security", label: "Security scan" },
  { key: "crucible", label: "Private repo flow" },
] as const;
type DemoKey = (typeof DEMOS)[number]["key"];

export default function DemoPage() {
  const [activeDemo, setActiveDemo] = useState<DemoKey>("dispatch");
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 border border-border bg-surface/40 px-3 py-1 text-[11px] text-paper-muted mb-6">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />
          interactive demo — no API key required
        </div>
        <h1 className="serif text-[36px] text-paper tracking-tight">See opensrcer in action</h1>
        <p className="mt-3 text-[13px] text-paper-dim max-w-lg mx-auto">
          Four interactive demos. Click through each step — no API calls, no cost.
        </p>
      </div>
      <div className="flex border-b border-border mb-0">
        {DEMOS.map((d) => (
          <button key={d.key} onClick={() => setActiveDemo(d.key)} className={cn("px-4 py-2.5 text-[12px] transition relative", activeDemo === d.key ? "text-paper" : "text-paper-muted hover:text-paper-dim")}>
            {d.label}
            {activeDemo === d.key && <span className="absolute inset-x-0 -bottom-px h-px bg-signal" />}
          </button>
        ))}
      </div>
      {activeDemo === "dispatch" && <DispatchDemo />}
      {activeDemo === "explore" && <ExploreDemo />}
      {activeDemo === "security" && <SecurityDemo />}
      {activeDemo === "crucible" && <CrucibleDemo />}
      <div className="mt-8 text-center">
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/login" className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-5 py-2.5 text-[13px] transition">Get started</Link>
          <Link href="/" className="border border-border text-paper-muted hover:text-paper px-5 py-2.5 text-[13px] transition">Learn more</Link>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DISPATCH DEMO — full step-by-step flow
// ═══════════════════════════════════════════════════════════════════════

type DispatchStep = "intro" | "issue" | "running" | "done";

const DISPATCH_LOG = [
  { t: "[agentic-dispatcher] 2026-04-19T04:30:00.000Z", d: 0 },
  { t: "[agentic-dispatcher] repo: acme-corp/web-app  issue: #47", d: 100 },
  { t: "[agentic-dispatcher] guardrails: --max-budget-usd=0.50", d: 300 },
  { t: "[agentic-dispatcher] ─────────────────────────────", d: 400 },
  { t: "", d: 500 },
  { t: "> repo_info: 142 files, top-level: src/, tests/, package.json", d: 800 },
  { t: "> grep /searchUsers/ — 3 matches", d: 1400 },
  { t: "> read_file src/routes/users.ts (lines 1-45)", d: 2000 },
  { t: "> find_definition searchUsers — src/routes/users.ts:23", d: 2600 },
  { t: "> grep /db\\.query/ — 8 matches", d: 3000 },
  { t: "> read_file src/routes/users.ts (lines 20-35)", d: 3400 },
  { t: "", d: 3600 },
  { t: "## Diagnosis", d: 3800 },
  { t: "", d: 3900 },
  { t: "The `searchUsers` handler at src/routes/users.ts:25 interpolates", d: 4000 },
  { t: "user input directly into a SQL string via template literal.", d: 4200 },
  { t: "Fix: use parameterized queries ($1 placeholder).", d: 4400 },
  { t: "", d: 4600 },
  { t: "```diff", d: 4800 },
  { t: "--- a/src/routes/users.ts", d: 4900 },
  { t: "+++ b/src/routes/users.ts", d: 5000 },
  { t: "@@ -23,7 +23,11 @@", d: 5100 },
  { t: "   const query = req.query.q;", d: 5200 },
  { t: "-  const results = await db.query(`SELECT * FROM users ...`);", d: 5300 },
  { t: "+  const results = await db.query(", d: 5400 },
  { t: '+    "SELECT * FROM users WHERE name LIKE $1",', d: 5500 },
  { t: "+    [`%${query}%`]", d: 5600 },
  { t: "+  );", d: 5700 },
  { t: "```", d: 5800 },
  { t: "", d: 5900 },
  { t: "## Risk / Test", d: 6000 },
  { t: "Checked 8 other db.query call sites — all already parameterized.", d: 6200 },
  { t: "Added test for injection vector. All 47 existing tests pass.", d: 6400 },
  { t: "", d: 6600 },
  { t: "[agentic-dispatcher] total_cost_usd=0.084700", d: 6800 },
  { t: "[agentic-dispatcher] exited · status=succeeded · exit=0", d: 7000 },
  { t: "", d: 7100 },
  { t: "[gemini-review] Patch looks correct. Parameterized query prevents injection.", d: 7300 },
  { t: "[crucible-tests] 47 tests passed, 0 failed", d: 7700 },
  { t: "[agentic-pr] opened draft PR: https://github.com/acme-corp/web-app/pull/48", d: 8100 },
  { t: "[agentic-pr] head: opensrcer/issue-47  →  base: main", d: 8300 },
];

const PHASES = ["clone", "explore", "patch", "test", "PR"];
const PHASE_TIMES = [600, 1800, 3200, 5800, 7400];

function DispatchDemo() {
  const [step, setStep] = useState<DispatchStep>("intro");
  const [lines, setLines] = useState<string[]>([]);
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines]);

  function reset() { timers.current.forEach(clearTimeout); timers.current = []; setStep("intro"); setLines([]); setPhaseIdx(-1); }

  function runDispatch() {
    setStep("running"); setLines([]); setPhaseIdx(0);
    for (const l of DISPATCH_LOG) timers.current.push(setTimeout(() => setLines(p => [...p, l.t]), l.d));
    PHASE_TIMES.forEach((t, i) => timers.current.push(setTimeout(() => setPhaseIdx(i), t)));
    timers.current.push(setTimeout(() => setStep("done"), DISPATCH_LOG[DISPATCH_LOG.length - 1].d + 400));
  }

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      {step === "intro" && (
        <div className="p-6 text-center space-y-4">
          <div className="text-[14px] text-paper">Bug fix pipeline</div>
          <p className="text-[12px] text-paper-dim max-w-md mx-auto">Watch the agent find a SQL injection vulnerability, generate a parameterized-query fix, run the test suite, and open a verified draft PR.</p>
          <button onClick={() => setStep("issue")} className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition">Start walkthrough →</button>
        </div>
      )}

      {step === "issue" && (
        <div className="p-6 space-y-4">
          <div className="mono-label text-paper-muted">step 1 — the issue</div>
          <div className="border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-paper-muted">acme-corp/web-app</span>
              <span className="text-[12px] text-info border border-info/40 px-1.5 py-0.5 leading-none">#47</span>
              <span className="text-[10px] border border-red-700/40 text-red-300 px-1.5">security</span>
            </div>
            <div className="text-[15px] text-paper">SQL injection in user search endpoint</div>
            <div className="text-[12px] text-paper-dim leading-relaxed">
              The <code className="text-signal bg-signal/10 px-1 text-[11px]">GET /api/users?q=</code> endpoint passes user input directly into a SQL query string. An attacker can inject arbitrary SQL via the <code className="text-signal bg-signal/10 px-1 text-[11px]">q</code> parameter.
            </div>
            <div className="text-[11px] text-paper-faint">est. ~$0.05–$0.12 · repo size: 4.1 MB</div>
          </div>
          <button onClick={runDispatch} className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition">Deep solve →</button>
        </div>
      )}

      {(step === "running" || step === "done") && (
        <>
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-paper-muted">acme-corp/web-app</span>
              <span className="text-[12px] text-info border border-info/40 px-1.5 py-0.5 leading-none">#47</span>
            </div>
            <div className="mt-1 text-[15px] text-paper">SQL injection in user search endpoint</div>
          </div>
          <div className="px-4 py-2 border-b border-border">
            <div className="flex items-center gap-1">
              {PHASES.map((p, i) => (
                <div key={p} className="flex items-center gap-1">
                  {i > 0 && <div className={cn("w-4 h-px", i <= phaseIdx ? "bg-ok/40" : "bg-border")} />}
                  <span className={cn("flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] border leading-none",
                    i < phaseIdx ? "border-ok/40 text-ok" : i === phaseIdx ? "border-signal/40 text-signal" : "border-border-soft text-paper-faint")}>
                    {i < phaseIdx ? "✓" : i === phaseIdx ? "●" : "○"} {p}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {step === "done" && (
            <div className="border-b border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
              <span className="text-[13px] text-ok">PR #48 opened — verified</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-[12px] text-paper-muted tabular-nums">$0.0847 · 3m 42s</span>
                <button onClick={reset} className="flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">replay</button>
              </span>
            </div>
          )}
          <pre ref={logRef} className={cn("overflow-auto p-4 text-[11.5px] leading-relaxed font-mono bg-ink/70 whitespace-pre-wrap", step === "done" ? "h-[30vh]" : "h-[40vh]")}>
            {lines.map((l, i) => <LogLine key={i} text={l} />)}
          </pre>
          {step === "done" && (
            <div className="px-4 py-4 border-t border-border space-y-2 text-[12px] text-paper-dim">
              <div className="text-[13px] text-paper font-medium">Summary</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Agent explored 6 files via MCP tools (grep, find_definition, read_file)</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Diagnosed SQL injection at src/routes/users.ts:25</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Generated a 4-line parameterized-query fix</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Gemini reviewed — no new vulnerabilities</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> 47 tests passed, 0 failed</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Draft PR #48 opened via GitHub API</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EXPLORE DEMO
// ═══════════════════════════════════════════════════════════════════════

type ExploreStep = "intro" | "repo" | "running" | "done";

const EXPLORE_TOOLS = [
  { tool: "repo_info", detail: "overview", d: 400 },
  { tool: "grep", detail: "/middleware/", d: 1000 },
  { tool: "read_file", detail: "src/middleware/auth.ts", d: 1600 },
  { tool: "find_definition", detail: "validateToken", d: 2200 },
  { tool: "grep", detail: "/JWT|jsonwebtoken/", d: 2800 },
  { tool: "read_file", detail: "src/utils/jwt.ts", d: 3200 },
];

const EXPLORE_TEXT = [
  { t: "## Authentication middleware\n\n", d: 3800 },
  { t: "The auth middleware lives at **src/middleware/auth.ts**. It runs on every protected route and validates JWTs using the `jsonwebtoken` library.\n\n", d: 4200 },
  { t: "**Key files:**\n- `src/middleware/auth.ts:14` — main `validateToken()` function\n- `src/utils/jwt.ts:8` — token signing/verification helpers\n- `src/config/auth.ts` — JWT secret and expiry config\n\n", d: 4800 },
  { t: "```typescript\n// src/middleware/auth.ts:14\nexport function validateToken(req, res, next) {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.status(401).json({ error: 'No token' });\n  try {\n    req.user = jwt.verify(token, config.jwtSecret);\n    next();\n  } catch {\n    res.status(403).json({ error: 'Invalid token' });\n  }\n}\n```", d: 5800 },
];

function ExploreDemo() {
  const [step, setStep] = useState<ExploreStep>("intro");
  const [tools, setTools] = useState<Array<{ tool: string; detail: string }>>([]);
  const [answer, setAnswer] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [answer]);

  function reset() { timers.current.forEach(clearTimeout); timers.current = []; setStep("intro"); setTools([]); setAnswer(""); }

  function run() {
    setStep("running"); setTools([]); setAnswer("");
    for (const t of EXPLORE_TOOLS) timers.current.push(setTimeout(() => setTools(p => [...p, { tool: t.tool, detail: t.detail }]), t.d));
    for (const a of EXPLORE_TEXT) timers.current.push(setTimeout(() => setAnswer(p => p + a.t), a.d));
    timers.current.push(setTimeout(() => setStep("done"), EXPLORE_TEXT[EXPLORE_TEXT.length - 1].d + 400));
  }

  const colors: Record<string, string> = { repo_info: "text-paper-muted border-border-soft", grep: "text-signal border-signal/30", read_file: "text-info border-info/30", find_definition: "text-ok border-ok/30" };
  const icons: Record<string, string> = { repo_info: "i", grep: "/", read_file: "#", find_definition: "@" };

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      {step === "intro" && (
        <div className="p-6 text-center space-y-4">
          <div className="text-[14px] text-paper">Codebase explorer</div>
          <p className="text-[12px] text-paper-dim max-w-md mx-auto">Ask plain-English questions about any codebase. The agent uses tree-sitter AST indexing, grep, and file reading to find answers with real code snippets.</p>
          <button onClick={() => setStep("repo")} className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition">Start walkthrough →</button>
        </div>
      )}

      {step === "repo" && (
        <div className="p-6 space-y-4">
          <div className="mono-label text-paper-muted">step 1 — enter a repo</div>
          <div className="border border-border p-4 space-y-3">
            <div className="bg-ink border border-border px-3 py-2 text-[13px] text-paper">acme-corp/web-app</div>
            <div className="text-[11px] text-paper-faint">Budget: $0.10 max cost per query</div>
          </div>
          <div className="mono-label text-paper-muted">step 2 — ask a question</div>
          <div className="border border-border p-4">
            <div className="bg-ink border border-border px-3 py-2 text-[13px] text-paper">Where is the authentication middleware and how does it work?</div>
          </div>
          <button onClick={run} className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition">Explore →</button>
        </div>
      )}

      {(step === "running" || step === "done") && (
        <>
          <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-signal">Q</span>
            <span className="text-[13px] text-paper">Where is the authentication middleware and how does it work?</span>
            {step === "done" && <span className="ml-auto text-[10px] text-paper-muted tabular-nums">$0.0071</span>}
          </div>
          {tools.length > 0 && (
            <div className="px-4 py-2 border-b border-border-soft bg-ink/30">
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t, i) => (
                  <span key={i} className={`text-[9.5px] tracking-[0.05em] px-1.5 py-0.5 border leading-none ${colors[t.tool] ?? ""}`}>
                    {icons[t.tool] ?? "?"} {t.detail}
                  </span>
                ))}
                {step === "running" && <span className="text-[9.5px] text-paper-faint animate-pulse">analyzing...</span>}
              </div>
            </div>
          )}
          <div ref={ref} className="h-[35vh] overflow-auto px-4 py-4 text-[12.5px] leading-relaxed text-paper-dim whitespace-pre-wrap">
            {answer.split("\n").map((line, i) => {
              if (line.startsWith("## ")) return <div key={i} className="text-[13px] text-paper font-medium mt-3 first:mt-0">{line.slice(3)}</div>;
              if (line.startsWith("- ")) return <div key={i} className="flex gap-2 ml-1"><span className="text-paper-faint">-</span><span>{renderInline(line.slice(2))}</span></div>;
              if (line.startsWith("```")) return <div key={i} className="text-[10px] text-paper-faint font-mono">{line}</div>;
              if (/^\s*(\/\/|export|const|function|if|try|catch|req\.|res\.|next|jwt\.|return|\}|{)/.test(line)) return <div key={i} className="font-mono text-[11.5px] text-paper-dim">{line}</div>;
              return <div key={i}>{renderInline(line) || "\u00a0"}</div>;
            })}
          </div>
          {step === "done" && (
            <div className="px-4 py-2.5 border-t border-border-soft flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-paper-faint uppercase tracking-[0.1em]">follow up:</span>
              {["What permissions does it check?", "How are tokens stored?", "Show me the test suite"].map((q, i) => (
                <span key={i} className="text-[11px] text-paper-dim border border-border-soft px-2 py-1">{q}</span>
              ))}
              <button onClick={reset} className="ml-auto flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">replay</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECURITY DEMO
// ═══════════════════════════════════════════════════════════════════════

type SecurityStep = "intro" | "scanning" | "findings" | "solving" | "done";

const FINDINGS = [
  { sev: "critical", id: "CVE-2024-4068", pkg: "npm/braces", ver: "<3.0.3", summary: "Uncontrolled resource consumption via crafted glob patterns", d: 800 },
  { sev: "high", id: "CVE-2024-43788", pkg: "npm/webpack", ver: "<5.94.0", summary: "XSS in dev server via malicious module names", d: 1400 },
  { sev: "high", id: "GHSA-3xgq-45jj", pkg: "npm/cross-spawn", ver: "<7.0.5", summary: "Command injection via shell metacharacters", d: 2000 },
  { sev: "medium", id: "CVE-2024-47764", pkg: "npm/cookie", ver: "<0.7.0", summary: "Cookie parsing accepts untrusted input", d: 2600 },
  { sev: "medium", id: "CVE-2024-21538", pkg: "npm/cross-spawn", ver: "<7.0.6", summary: "ReDoS in argument parsing", d: 3000 },
  { sev: "low", id: "CVE-2024-55565", pkg: "npm/nanoid", ver: "<3.3.8", summary: "Predictable ID generation with non-secure random", d: 3400 },
];

const SOLVE_LOG = [
  { t: "> Reading package.json...", d: 400 },
  { t: "> Found braces@2.3.2 — vulnerable to CVE-2024-4068", d: 800 },
  { t: "> Checking dependency tree... indirect via micromatch", d: 1200 },
  { t: "> micromatch@4.0.5 → braces@2.3.2 (needs ≥3.0.3)", d: 1600 },
  { t: "", d: 1800 },
  { t: "## Fix", d: 2000 },
  { t: "Override braces to ^3.0.3 in package.json overrides field.", d: 2200 },
  { t: "```diff", d: 2400 },
  { t: "--- a/package.json", d: 2500 },
  { t: "+++ b/package.json", d: 2600 },
  { t: '@@ -45,6 +45,9 @@', d: 2700 },
  { t: '+  "overrides": {', d: 2800 },
  { t: '+    "braces": "^3.0.3"', d: 2900 },
  { t: '+  },', d: 3000 },
  { t: "```", d: 3100 },
  { t: "", d: 3200 },
  { t: "[gemini-review] Override is correct. braces ^3.0.3 fixes CVE-2024-4068.", d: 3400 },
  { t: "[crucible-tests] 156 tests passed, 0 failed", d: 3800 },
  { t: "[agentic-pr] opened draft PR: https://github.com/acme-corp/web-app/pull/49", d: 4200 },
];

function SecurityDemo() {
  const [step, setStep] = useState<SecurityStep>("intro");
  const [findings, setFindings] = useState<typeof FINDINGS>([]);
  const [solveLines, setSolveLines] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [solveLines]);

  function reset() { timers.current.forEach(clearTimeout); timers.current = []; setStep("intro"); setFindings([]); setSolveLines([]); }

  function scan() {
    setStep("scanning"); setFindings([]);
    for (const f of FINDINGS) timers.current.push(setTimeout(() => setFindings(p => [...p, f]), f.d));
    timers.current.push(setTimeout(() => setStep("findings"), FINDINGS[FINDINGS.length - 1].d + 400));
  }

  function solve() {
    setStep("solving"); setSolveLines([]);
    for (const l of SOLVE_LOG) timers.current.push(setTimeout(() => setSolveLines(p => [...p, l.t]), l.d));
    timers.current.push(setTimeout(() => setStep("done"), SOLVE_LOG[SOLVE_LOG.length - 1].d + 400));
  }

  const sevCls: Record<string, string> = {
    critical: "border-red-700 bg-red-950/60 text-red-200",
    high: "border-orange-700 bg-orange-950/40 text-orange-200",
    medium: "border-yellow-700 bg-yellow-950/40 text-yellow-200",
    low: "border-blue-700 bg-blue-950/40 text-blue-200",
  };

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      {step === "intro" && (
        <div className="p-6 text-center space-y-4">
          <div className="text-[14px] text-paper">Security scan</div>
          <p className="text-[12px] text-paper-dim max-w-md mx-auto">Scan a repo for CVEs and Dependabot alerts, then watch the agent automatically remediate the critical finding with a verified patch.</p>
          <button onClick={scan} className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition">Start scan →</button>
        </div>
      )}

      {(step === "scanning" || step === "findings") && (
        <>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[13px] text-paper-muted">acme-corp/web-app</div>
            <div className="mt-1 text-[15px] text-paper">Security advisories + Dependabot alerts</div>
          </div>
          <div className="max-h-[30vh] overflow-auto divide-y divide-border-soft">
            {findings.map((f, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-3 animate-fade-rise">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono border ${sevCls[f.sev]}`}>{f.sev}</span>
                    <span className="text-[10.5px] font-mono text-paper-muted">{f.id}</span>
                    <span className="text-[10.5px] font-mono text-paper-muted">{f.pkg} {f.ver}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-paper-dim">{f.summary}</div>
                </div>
                {step === "findings" && f.sev === "critical" && (
                  <button onClick={solve} className="shrink-0 text-[11px] text-paper border border-border bg-surface/60 hover:bg-surface px-2 py-1">deep solve</button>
                )}
              </div>
            ))}
          </div>
          {step === "scanning" && <div className="px-4 py-2 text-[10px] text-signal animate-pulse">scanning...</div>}
          {step === "findings" && (
            <div className="px-4 py-2.5 border-t border-border text-[11px] text-paper-muted">
              {findings.length} findings · click &quot;deep solve&quot; on the critical CVE
            </div>
          )}
        </>
      )}

      {(step === "solving" || step === "done") && (
        <>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[13px] text-paper-muted">acme-corp/web-app</div>
            <div className="mt-1 text-[15px] text-paper">Remediating CVE-2024-4068 (critical)</div>
          </div>
          {step === "done" && (
            <div className="border-b border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
              <span className="text-[13px] text-ok">PR #49 opened — CVE-2024-4068 remediated</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-[12px] text-paper-muted tabular-nums">$0.0614 · 1m 52s</span>
                <button onClick={reset} className="flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">replay</button>
              </span>
            </div>
          )}
          <pre ref={logRef} className={cn("overflow-auto p-4 text-[11.5px] leading-relaxed font-mono bg-ink/70 whitespace-pre-wrap", step === "done" ? "h-[25vh]" : "h-[35vh]")}>
            {solveLines.map((l, i) => <LogLine key={i} text={l} />)}
          </pre>
          {step === "done" && (
            <div className="px-4 py-4 border-t border-border space-y-2 text-[12px] text-paper-dim">
              <div className="text-[13px] text-paper font-medium">Summary</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Scanned 6 security advisories (1 critical, 2 high, 2 medium, 1 low)</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Traced CVE-2024-4068 to braces@2.3.2 via micromatch dependency</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Generated 3-line fix (npm overrides), Gemini verified</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> 156 tests passed, draft PR #49 opened</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CRUCIBLE DEMO
// ═══════════════════════════════════════════════════════════════════════

type CrucibleStep = "start" | "connect" | "install" | "connected" | "repos" | "issues" | "solving" | "done";

const REPOS = [
  { name: "web-app", lang: "TypeScript", issues: 8, updated: "2d ago" },
  { name: "api-gateway", lang: "Go", issues: 14, updated: "5h ago" },
  { name: "ml-pipeline", lang: "Python", issues: 6, updated: "1w ago" },
  { name: "mobile-sdk", lang: "Kotlin", issues: 3, updated: "3d ago" },
];

const ISSUES = [
  { num: 14, title: "Race condition in rate limiter middleware", labels: ["bug", "p1"] },
  { num: 12, title: "API key rotation doesn't invalidate old tokens", labels: ["security"] },
  { num: 9, title: "GraphQL N+1 query on user.posts resolver", labels: ["performance"] },
  { num: 7, title: "Missing CORS headers on preflight requests", labels: ["bug"] },
  { num: 3, title: "Add request ID to all log entries", labels: ["enhancement"] },
];

const CRUCIBLE_LOG = [
  { t: "[agentic-dispatcher] repo: acme-corp/api-gateway  issue: #12", d: 200 },
  { t: "[agentic-dispatcher] ─────────────────────────────", d: 400 },
  { t: "", d: 500 },
  { t: "> repo_info: 89 files, top-level: cmd/, internal/, pkg/", d: 800 },
  { t: "> grep /apiKey|rotation|invalidat/ — 12 matches", d: 1400 },
  { t: "> read_file internal/auth/keys.go (lines 1-60)", d: 2000 },
  { t: "> find_definition RotateKey — internal/auth/keys.go:34", d: 2600 },
  { t: "> read_file internal/auth/cache.go (lines 20-55)", d: 3200 },
  { t: "", d: 3400 },
  { t: "## Diagnosis", d: 3600 },
  { t: "", d: 3700 },
  { t: "RotateKey() generates a new key but doesn't add the old key", d: 3800 },
  { t: "hash to the revocation set. Old tokens remain valid until TTL.", d: 4000 },
  { t: "", d: 4200 },
  { t: "```diff", d: 4400 },
  { t: "--- a/internal/auth/keys.go", d: 4500 },
  { t: "+++ b/internal/auth/keys.go", d: 4600 },
  { t: "@@ -34,6 +34,9 @@ func RotateKey(ctx context.Context) error {", d: 4700 },
  { t: "   newKey := generateKey()", d: 4800 },
  { t: "   store.Set(ctx, newKey)", d: 4900 },
  { t: "+  // Revoke the old key immediately", d: 5000 },
  { t: "+  oldHash := hashKey(store.Current())", d: 5100 },
  { t: "+  cache.AddRevoked(ctx, oldHash, store.TTL())", d: 5200 },
  { t: "   return nil", d: 5300 },
  { t: "```", d: 5400 },
  { t: "", d: 5500 },
  { t: "[gemini-review] Fix correctly revokes old key on rotation.", d: 5700 },
  { t: "[crucible-tests] 83 tests passed, 0 failed", d: 6100 },
  { t: "[agentic-pr] token: orgCtx=acme-corp source=installation prefix=ghs_", d: 6500 },
  { t: "[agentic-pr] opened draft PR: https://github.com/acme-corp/api-gateway/pull/15", d: 6900 },
];

function CrucibleDemo() {
  const [step, setStep] = useState<CrucibleStep>("start");
  const [solveLines, setSolveLines] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [solveLines]);

  function reset() { timers.current.forEach(clearTimeout); timers.current = []; setStep("start"); setSolveLines([]); }

  function solve() {
    setStep("solving"); setSolveLines([]);
    for (const l of CRUCIBLE_LOG) timers.current.push(setTimeout(() => setSolveLines(p => [...p, l.t]), l.d));
    timers.current.push(setTimeout(() => setStep("done"), CRUCIBLE_LOG[CRUCIBLE_LOG.length - 1].d + 400));
  }

  return (
    <div className="border border-border border-t-0 bg-surface/40">
      {step === "start" && (
        <div className="p-6 text-center space-y-4">
          <div className="text-[14px] text-paper">Private repo flow</div>
          <p className="text-[12px] text-paper-dim max-w-md mx-auto">Walk through connecting a GitHub Organization, browsing private repos, and dispatching a security fix — all using short-lived installation tokens.</p>
          <button onClick={() => setStep("connect")} className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition">Connect GitHub Org →</button>
        </div>
      )}

      {step === "connect" && (
        <div className="p-6 space-y-4">
          <div className="mono-label text-paper-muted">step 1 — install the github app</div>
          <div className="border border-border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-surface-3 rounded-full flex items-center justify-center text-[16px] text-paper-muted">A</div>
              <div><div className="text-[13px] text-paper">acme-corp</div><div className="text-[11px] text-paper-muted">Organization · 4 repositories</div></div>
            </div>
            <div className="text-[11.5px] text-paper-dim space-y-1.5">
              <div className="flex items-center gap-2"><span className="text-ok">+</span> Repository contents — read & write</div>
              <div className="flex items-center gap-2"><span className="text-ok">+</span> Pull requests — read & write</div>
              <div className="flex items-center gap-2"><span className="text-ok">+</span> Issues, Dependabot alerts, Security advisories — read</div>
            </div>
            <button onClick={() => setStep("install")} className="w-full border border-ok/50 bg-ok/10 text-ok hover:bg-ok/20 py-2 text-[12px] transition">Install & Authorize</button>
          </div>
        </div>
      )}

      {step === "install" && (
        <div className="p-6 text-center space-y-3">
          <div className="inline-block w-8 h-8 border-2 border-signal/30 border-t-signal rounded-full animate-spin" />
          <div className="text-[12px] text-paper-muted">Redirecting from GitHub...</div>
          {(() => { setTimeout(() => setStep("connected"), 1200); return null; })()}
        </div>
      )}

      {step === "connected" && (
        <div className="p-6 space-y-4">
          <div className="mono-label text-paper-muted">step 2 — org connected</div>
          <div className="border border-ok/40 bg-ok/5 px-4 py-3 flex items-center gap-3">
            <span className="text-ok text-[14px]">✓</span>
            <div><div className="text-[13px] text-ok">acme-corp connected</div><div className="text-[11px] text-paper-muted">Installation #48291 · 60-min tokens · revocable anytime</div></div>
          </div>
          <button onClick={() => setStep("repos")} className="border border-border bg-surface/60 hover:bg-surface text-paper px-4 py-2 text-[12px] transition">Browse repos →</button>
        </div>
      )}

      {step === "repos" && (
        <div>
          <div className="px-4 py-3 border-b border-border">
            <div className="mono-label text-paper-muted">step 3 — choose a repo</div>
            <div className="mt-1 text-[13px] text-paper">acme-corp · {REPOS.length} repositories</div>
          </div>
          <ul className="divide-y divide-border-soft">
            {REPOS.map((r) => (
              <li key={r.name}><button onClick={() => setStep("issues")} className="w-full text-left px-4 py-3 hover:bg-surface-2/40 transition flex items-center gap-4">
                <div className="flex-1"><div className="text-[13px] text-paper">acme-corp/{r.name}</div><div className="mt-0.5 text-[11px] text-paper-muted">{r.lang} · {r.issues} issues · {r.updated}</div></div>
                <span className="text-[11px] text-paper-faint">→</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}

      {step === "issues" && (
        <div>
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div><div className="mono-label text-paper-muted">step 4 — pick an issue</div><div className="mt-1 text-[13px] text-paper">acme-corp/api-gateway</div></div>
              <button onClick={() => setStep("repos")} className="text-[11px] text-paper-muted hover:text-paper">← back</button>
            </div>
          </div>
          <ul className="divide-y divide-border-soft">
            {ISSUES.map((iss) => (
              <li key={iss.num} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-paper"><span className="text-paper-muted">#{iss.num}</span> {iss.title}</div>
                  <div className="mt-1 flex gap-1">{iss.labels.map(l => <span key={l} className={cn("text-[10px] font-mono border px-1.5", l === "security" ? "border-red-700/40 text-red-300" : l === "bug" || l === "p1" ? "border-orange-700/40 text-orange-300" : "border-border-soft text-paper-muted")}>{l}</span>)}</div>
                </div>
                <button onClick={iss.num === 12 ? solve : undefined} className={cn("shrink-0 text-[11px] border px-2.5 py-1", iss.num === 12 ? "text-paper border-border bg-surface/60 hover:bg-surface" : "text-paper-faint border-border-soft cursor-default")}>deep solve</button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2 border-t border-border-soft text-[10px] text-paper-faint">Click &quot;deep solve&quot; on issue #12</div>
        </div>
      )}

      {(step === "solving" || step === "done") && (
        <>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-[13px] text-paper-muted">acme-corp/api-gateway</div>
            <div className="mt-1 text-[15px] text-paper">#12 — API key rotation doesn&apos;t invalidate old tokens</div>
          </div>
          {step === "done" && (
            <div className="border-b border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
              <span className="text-[13px] text-ok">PR #15 opened — security fix verified</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-[12px] text-paper-muted tabular-nums">$0.0923 · 2m 18s</span>
                <button onClick={reset} className="flex items-center gap-1 border border-border hover:border-signal/50 hover:text-signal px-2 py-0.5 text-[10px] text-paper-muted transition">replay</button>
              </span>
            </div>
          )}
          <pre ref={logRef} className={cn("overflow-auto p-4 text-[11.5px] leading-relaxed font-mono bg-ink/70 whitespace-pre-wrap", step === "done" ? "h-[25vh]" : "h-[35vh]")}>
            {solveLines.map((l, i) => <LogLine key={i} text={l} />)}
          </pre>
          {step === "done" && (
            <div className="px-4 py-4 border-t border-border space-y-2 text-[12px] text-paper-dim">
              <div className="text-[13px] text-paper font-medium">Summary</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Connected acme-corp via GitHub App (installation token, 60-min TTL)</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Browsed 4 private repos, selected api-gateway</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Agent explored Go codebase via MCP tools</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Diagnosed missing key revocation on rotation</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> 3-line fix, Gemini reviewed, 83 tests passed</div>
              <div className="flex gap-2"><span className="text-ok">✓</span> Draft PR #15 opened with installation token (not personal PAT)</div>
              <div className="mt-2 text-[11px] text-paper-faint">Total: $0.09 · No long-lived credentials · Token expired after 60 min</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════════════

function LogLine({ text }: { text: string }) {
  let cls = "text-paper-dim";
  if (text.startsWith("[")) cls = "text-paper-faint";
  else if (text.startsWith(">")) cls = "text-signal";
  else if (text.startsWith("##")) cls = "text-paper font-medium";
  else if (text.startsWith("+") && !text.startsWith("+++")) cls = "text-ok";
  else if (text.startsWith("-") && !text.startsWith("---")) cls = "text-alert";
  else if (text.startsWith("@@")) cls = "text-info";
  else if (text.includes("passed")) cls = "text-ok";
  else if (text.includes("opened draft PR") || text.includes("opened PR")) cls = "text-ok font-medium";
  return <div className={cls}>{text || "\u00a0"}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let match: RegExpExecArray | null; let ki = 0;
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
