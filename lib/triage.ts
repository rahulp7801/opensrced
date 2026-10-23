// Cheap pre-flight triage: one tool-less turn on the fast model decides
// whether the issue is worth the expensive agent run at all. It fails fast on
// what the exec box cannot verify (GPU-only, compiled-code changes), on
// questions and support requests, and on feature work too large for one PR.
//
// Advisory for previews (logged), binding for live runs. A triage that
// cannot run or parse never blocks: it is a cost saver, not a gate.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentInvocation, type AgentProvider } from "./agent-invocation";
import { CLAUDE_FAST_MODEL } from "./models";

export type TriageCategory = "bug" | "docs" | "small_feature" | "large_feature" | "question" | "needs_gpu" | "needs_compiled_code" | "unclear";
export type Triage = { proceed: boolean; category: TriageCategory; reason: string };

const REFUSE: TriageCategory[] = ["large_feature", "question", "needs_gpu", "needs_compiled_code"];
const CATEGORIES: TriageCategory[] = ["bug", "docs", "small_feature", "large_feature", "question", "needs_gpu", "needs_compiled_code", "unclear"];

export function triagePrompt(repo: string, issueFormatted: string): string {
  return [
    `Classify this GitHub issue from ${repo} for an automated contributor that can edit files and run CPU-only tests in a Linux container (no GPU, no C++/CUDA build toolchain), and must stay within one small PR.`,
    ``,
    issueFormatted,
    ``,
    `Answer with ONE line of JSON and nothing else: {"category": one of ${CATEGORIES.map((c) => `"${c}"`).join(", ")}, "reason": "<= 25 words"}.`,
    `- needs_gpu: the bug only reproduces or can only be tested on a GPU/accelerator.`,
    `- needs_compiled_code: the fix must change C/C++/CUDA/Rust or other compiled sources.`,
    `- large_feature: new functionality spanning many files or needing design discussion.`,
    `- question: a usage question or support request, not a defect.`,
  ].join("\n");
}

/** Parse the model's one-line answer. Unparseable answers proceed. */
export function parseTriage(text: string): Triage {
  const json = /\{[^{}]*"category"[^{}]*\}/.exec(text)?.[0];
  try {
    const parsed = JSON.parse(json ?? "") as { category?: string; reason?: string };
    const category = CATEGORIES.includes(parsed.category as TriageCategory) ? parsed.category as TriageCategory : "unclear";
    const reason = String(parsed.reason ?? "").replace(/\s+/g, " ").slice(0, 200);
    return { proceed: !REFUSE.includes(category), category, reason };
  } catch {
    return { proceed: true, category: "unclear", reason: "triage answer could not be parsed" };
  }
}

/** Run the triage turn. Returns null when triage is off or could not run. */
export async function triageIssue(opts: {
  repo: string; issueFormatted: string; workDir: string; provider?: AgentProvider; anthropicKey?: string;
}): Promise<{ triage: Triage; costUsd: number | null } | null> {
  if (process.env.OPENSRCER_TRIAGE === "0") return null;
  mkdirSync(opts.workDir, { recursive: true });
  const mcpConfig = path.join(opts.workDir, "triage-mcp.json");
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: {} }));
  const inv = buildAgentInvocation({
    provider: opts.provider, prompt: triagePrompt(opts.repo, opts.issueFormatted), mcpConfig, tools: [],
    model: CLAUDE_FAST_MODEL, budgetUsd: 0.05, maxTurns: 1, inject: { ANTHROPIC_API_KEY: opts.anthropicKey },
  });
  return new Promise((resolve) => {
    const child = spawn(inv.bin, inv.args, { env: inv.env, cwd: opts.workDir, windowsHide: true });
    let out = "";
    child.stdout.on("data", (c: Buffer) => { out = (out + c.toString()).slice(-200_000); });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", () => {
      clearTimeout(timer);
      let text = "";
      let cost: number | null = null;
      for (const line of out.split("\n")) {
        try {
          const e = JSON.parse(line);
          if (e.type === "result") { text = String(e.result ?? ""); cost = typeof e.total_cost_usd === "number" ? e.total_cost_usd : null; }
        } catch { /* partial line */ }
      }
      resolve(text ? { triage: parseTriage(text), costUsd: cost } : null);
    });
  });
}
