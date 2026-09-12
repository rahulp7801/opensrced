import { readJsonBody } from "@/lib/request-body";
// POST /api/prs/verify
// Runs verification checks on a generated diff before pushing.
// All checks are deterministic and make no model calls. Cached graph data can
// add repository impact context.
//
// Checks:
// 1. Scope — how many lines/files changed? Flag if excessive
// 2. Minimal change — does the diff touch only relevant code?
// 3. Secrets — scan diff for hardcoded API keys, tokens, passwords
// 4. Syntax — basic AST-level checks (balanced braces, valid structure)
// 5. Impact — if graph data available, show downstream callers

import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { graphJsonPath, loadGraph } from "@/lib/graph";
import { analyzeImpactFromDiff } from "@/lib/graph-impact";
import { ensureGraph, hasCrg, graphCacheDir, crgPythonPath } from "@/lib/graph-build";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { sanitizeRepoId, sanitizeFilePath } from "@/lib/sanitize";
import { childEnv } from "@/lib/child-env";
import { sessionUserId } from "@/lib/require-session";

const execFileAsync = promisify(execFile);

import { cloudExecution } from "@/lib/cloud-run-state";
import { getStoredGraph } from "@/lib/graph-store";
import { resolveRepositoryToken } from "@/lib/crucible/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const raw = ((await readJsonBody(req)) ?? {}) as {
    diff?: string;
    comment_body?: string;
    file_path?: string | null;
    repo?: string;
  };

  if (!raw || [raw.diff, raw.comment_body, raw.file_path, raw.repo].some(value => value != null && typeof value !== "string") || (raw.diff?.length ?? 0) > 200_000) return Response.json({ error: "Invalid verification input or diff too large" }, { status: 400 });

  const body = {
    diff: raw.diff?.slice(0, 200_000) ?? null, // cap diff size
    comment_body: raw.comment_body ?? null,
    file_path: raw.file_path ? sanitizeFilePath(raw.file_path) : null,
    repo: raw.repo ? sanitizeRepoId(raw.repo) : null,
  };

  if (!body.diff) {
    return Response.json({ error: "Missing diff" }, { status: 400 });
  }

  const checks: Check[] = [];
  const diff = body.diff;

  // ── 1. Scope check ──────────────────────────────────────────────────
  const addedLines = (diff.match(/^\+[^+]/gm) ?? []).length;
  const removedLines = (diff.match(/^-[^-]/gm) ?? []).length;
  const totalChanged = addedLines + removedLines;
  const filesChanged = new Set(
    [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((m) => m[1]),
  ).size;

  if (totalChanged <= 10) {
    checks.push({
      name: "Scope",
      status: "pass",
      detail: `${totalChanged} lines changed across ${filesChanged} file(s) — minimal, focused change`,
    });
  } else if (totalChanged <= 30) {
    checks.push({
      name: "Scope",
      status: "warn",
      detail: `${totalChanged} lines changed across ${filesChanged} file(s) — review carefully, moderate change`,
    });
  } else {
    checks.push({
      name: "Scope",
      status: "fail",
      detail: `${totalChanged} lines changed across ${filesChanged} file(s) — large change, high verification burden. Consider breaking this up.`,
    });
  }

  // ── 2. Minimal change check ─────────────────────────────────────────
  // Check if the diff adds unrelated code (comments, imports, formatting)
  const addedContent = (diff.match(/^\+[^+].*/gm) ?? []).map((l) => l.slice(1));
  const onlyWhitespace = addedContent.filter(
    (l) => l.trim() === "" || /^\s*[{}()[\]]\s*$/.test(l),
  );
  const commentLines = addedContent.filter((l) =>
    /^\s*(\/\/|#|\/\*|\*|"""|'''|<!--)/.test(l),
  );
  const importLines = addedContent.filter((l) =>
    /^\s*(import |from |require\(|use |#include)/.test(l),
  );

  const nonFunctional = onlyWhitespace.length + commentLines.length;
  const functionalLines = addedContent.length - nonFunctional;

  if (addedContent.length === 0) {
    checks.push({
      name: "Minimal change",
      status: "pass",
      detail: "Deletion-only change — no new code introduced",
    });
  } else if (nonFunctional > functionalLines && addedContent.length > 3) {
    checks.push({
      name: "Minimal change",
      status: "warn",
      detail: `${nonFunctional} of ${addedContent.length} added lines are non-functional (whitespace/comments). May include unnecessary changes.`,
    });
  } else {
    checks.push({
      name: "Minimal change",
      status: "pass",
      detail: `${functionalLines} functional line(s) added${importLines.length > 0 ? `, ${importLines.length} import(s)` : ""} — focused on the fix`,
    });
  }

  // ── 3. Secret scan ──────────────────────────────────────────────────
  const secretPatterns = [
    { name: "AWS key", re: /AKIA[0-9A-Z]{16}/ },
    { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
    { name: "Generic API key", re: /["'](?:api[_-]?key|apikey|api[_-]?secret)["']\s*[:=]\s*["'][^"']{10,}["']/i },
    { name: "Private key", re: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
    { name: "Slack token", re: /xox[boaprs]-[0-9a-zA-Z-]{10,}/ },
    { name: "Generic secret", re: /["'](?:secret|password|passwd|token)["']\s*[:=]\s*["'][^"']{8,}["']/i },
    { name: "Base64 credential", re: /(?:Basic|Bearer)\s+[A-Za-z0-9+/=]{20,}/ },
  ];

  const secretFindings: string[] = [];
  for (const { name, re } of secretPatterns) {
    if (re.test(diff)) {
      secretFindings.push(name);
    }
  }

  if (secretFindings.length > 0) {
    checks.push({
      name: "Secrets",
      status: "fail",
      detail: `Potential secret(s) detected: ${secretFindings.join(", ")}. DO NOT push until verified.`,
    });
  } else {
    checks.push({
      name: "Secrets",
      status: "pass",
      detail: "No hardcoded secrets detected in the diff",
    });
  }

  // ── 4. Syntax check ─────────────────────────────────────────────────
  // Check for obviously broken syntax in added lines
  const allAdded = addedContent.join("\n");
  const openBraces = (allAdded.match(/\{/g) ?? []).length;
  const closeBraces = (allAdded.match(/\}/g) ?? []).length;
  const openParens = (allAdded.match(/\(/g) ?? []).length;
  const closeParens = (allAdded.match(/\)/g) ?? []).length;

  // Only flag if the imbalance is in the added lines themselves
  // (cross-hunk changes can legitimately be imbalanced)
  if (
    addedContent.length > 3 &&
    (Math.abs(openBraces - closeBraces) > 2 ||
      Math.abs(openParens - closeParens) > 2)
  ) {
    checks.push({
      name: "Syntax heuristic",
      status: "warn",
      detail: `Bracket imbalance in added code: {${openBraces}/${closeBraces}} (${openParens}/${closeParens}). Verify structure is correct.`,
    });
  } else {
    checks.push({
      name: "Syntax",
      status: "pass",
      detail: "No bracket imbalance detected. Code has not been compiled or tested.",
    });
  }

  // ── 5. Review alignment ─────────────────────────────────────────────
  // Check if the diff addresses the reviewer's comment
  if (body.comment_body && body.file_path) {
    const commentFile = body.file_path.toLowerCase();
    const diffFiles = [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)]
      .map((m) => m[1].toLowerCase());

    if (diffFiles.some((f) => f.includes(commentFile) || commentFile.includes(f))) {
      checks.push({
        name: "Review alignment",
        status: "pass",
        detail: `Changes target the reviewed file (${body.file_path})`,
      });
    } else if (diffFiles.length > 0) {
      checks.push({
        name: "Review alignment",
        status: "warn",
        detail: `Changes are in ${diffFiles.join(", ")} but review comment is on ${body.file_path}. Verify this is intentional.`,
      });
    }
  }

  // ── 6. Blast radius analysis ─────────────────────────────────────────
  // Uses code-review-graph (preferred — defensive, capped traversal) or
  // graphify (fallback) to check downstream impact of the change.
  let repositoryToken: string | null = null;
  if (body.repo) {
    try { repositoryToken = (await resolveRepositoryToken(userId, body.repo, req.signal)).token ?? null; }
    catch { return Response.json({ error: "Repository not accessible" }, { status: 403 }); }
    if (cloudExecution()) {
      const stored = await getStoredGraph(userId, body.repo);
      if (stored) {
        const impact = analyzeImpactFromDiff(stored.graph, diff);
        checks.push({ name: "Graph impact", status: "warn", detail: `Cached graph suggests ${impact.totalAffected} downstream dependents. Snapshot: ${stored.revision.slice(0, 8)}. Confirm behavior against the current PR.` });
      } else checks.push({ name: "Graph impact", status: "warn", detail: "Build this repository's graph to inspect downstream dependencies." });
    }
  }
  if (body.repo && !cloudExecution()) {
    const m = body.repo.match(/^([^/]+)\/([^/]+)$/);
    if (m) {
      // Try code-review-graph first (handles large repos, SQLite-backed)
      const crgAvailable = hasCrg(m[1], m[2]);
      if (crgAvailable) {
        try {
          const crgResult = await runCrgImpact(m[1], m[2], diff);
          if (crgResult.error === "no_graph") {
            // CRG db exists but query failed — fall through to graphify
          } else if (crgResult.error) {
            checks.push({ name: "Blast radius", status: "warn", detail: `CRG error: ${crgResult.error}` });
          } else if (crgResult.total_affected === 0) {
            checks.push({
              name: "Blast radius",
              status: "pass",
              detail: `No downstream dependents found for changed files (code-review-graph)`,
            });
          } else if (crgResult.total_affected <= 10) {
            checks.push({
              name: "Blast radius",
              status: "pass",
              detail: `${crgResult.total_affected} downstream dependent(s) across ${crgResult.affected_file_count} file(s): ${(crgResult.affected_labels ?? []).slice(0, 5).join(", ")} (code-review-graph)`,
            });
          } else if (crgResult.total_affected <= 30) {
            checks.push({
              name: "Blast radius",
              status: "warn",
              detail: `${crgResult.total_affected} downstream dependents across ${crgResult.affected_file_count} file(s). Top: ${(crgResult.affected_labels ?? []).slice(0, 5).join(", ")}. Review carefully. (code-review-graph)`,
            });
          } else {
            checks.push({
              name: "Blast radius",
              status: "warn",
              detail: `HIGH IMPACT: ${crgResult.total_affected} downstream dependents across ${crgResult.affected_file_count} file(s). This is a wide-reaching change — review carefully before pushing. (code-review-graph)`,
            });
          }
        } catch {
          // CRG failed — fall through to graphify
        }
      }

      // If CRG didn't produce a result, try graphify
      const hasCrgCheck = checks.some((c) => c.name === "Blast radius");
      if (hasCrgCheck) {
        // Already have a result — skip graphify
      } else {
      // Auto-build graph if it doesn't exist
      const gPath = graphJsonPath(m[1], m[2]);
      if (!existsSync(gPath)) {
        checks.push({
          name: "Graph impact",
          status: "warn",
          detail: "Building knowledge graph for impact analysis (first time only)...",
        });

        // Clone as the requesting user — ensureGraph no longer falls back
        // to the host GITHUB_TOKEN or gh keychain.
        const buildResult = await ensureGraph(m[1], m[2], repositoryToken);
        // Remove the "building" placeholder
        checks.pop();

        if (buildResult.error) {
          checks.push({
            name: "Graph impact",
            status: "warn",
            detail: `Could not build graph: ${buildResult.error.slice(0, 150)}. Impact analysis skipped.`,
          });
        } else if (buildResult.built) {
          checks.push({
            name: "Graph build",
            status: "pass",
            detail: "Knowledge graph built automatically for this repo",
          });
        }
      }

      // Now try loading and analyzing
      if (existsSync(graphJsonPath(m[1], m[2]))) {
        try {
          const graph = await loadGraph(m[1], m[2]);
          const impactResult = analyzeImpactFromDiff(graph, diff);

          if (impactResult.totalAffected === 0) {
            checks.push({
              name: "Graph impact",
              status: "pass",
              detail: "Changed symbols not found in the knowledge graph (may be too granular to index)",
            });
          } else if (impactResult.totalAffected <= 5) {
            checks.push({
              name: "Graph impact",
              status: "pass",
              detail: `${impactResult.totalAffected} downstream dependent(s): ${impactResult.affectedLabels.join(", ")}`,
            });
          } else if (impactResult.totalAffected <= 15) {
            checks.push({
              name: "Graph impact",
              status: "warn",
              detail: `${impactResult.totalAffected} downstream dependents across ${impactResult.affectedModules} module(s). Top: ${impactResult.affectedLabels.slice(0, 5).join(", ")}. Verify no behavioral change.`,
            });
          } else {
            checks.push({
              name: "Graph impact",
              status: "warn",
              detail: `HIGH IMPACT: ${impactResult.totalAffected} downstream dependents across ${impactResult.affectedModules} module(s). This change touches a critical node (${impactResult.topNode}). Review carefully before pushing.`,
            });
          }
        } catch {
          // Graph load failed — skip silently
        }
      }
      } // close else (no CRG result)
    }
  }

  // ── 7. Verification summary ─────────────────────────────────────────
  checks.push({ name: "Execution", status: "warn", detail: "Repository tests were not run. Static checks do not verify behavior." });
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  return Response.json({
    checks,
    summary: {
      pass: passCount,
      warn: warnCount,
      fail: failCount,
      verdict:
        failCount > 0 ? "blocked" : warnCount > 0 ? "review" : "clean",
      linesAdded: addedLines,
      linesRemoved: removedLines,
      filesChanged,
    },
  });
}

// ── CRG blast radius helper ───────────────────────────────────────────

type CrgResult = {
  total_affected: number;
  changed_nodes: number;
  affected_files: string[];
  affected_labels: string[];
  affected_file_count: number;
  error?: string;
  detail?: string;
};

async function runCrgImpact(
  owner: string,
  repo: string,
  diff: string,
): Promise<CrgResult> {
  // Extract changed file paths from the diff
  const changedFiles = [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)]
    .map((m) => m[1]);

  if (changedFiles.length === 0) {
    return { total_affected: 0, changed_nodes: 0, affected_files: [], affected_labels: [], affected_file_count: 0 };
  }

  const repoDir = graphCacheDir(owner, repo);
  const scriptPath = join(process.cwd(), "lib", "crg-impact.py");
  const pythonPath = crgPythonPath();
  if (!pythonPath) {
    // CRG not configured — impact analysis is optional, report "no data"
    // rather than failing the whole verify pass.
    return { total_affected: 0, changed_nodes: 0, affected_files: [], affected_labels: [], affected_file_count: 0 };
  }

  const { stdout } = await execFileAsync(
    "python",
    [scriptPath, repoDir, ...changedFiles],
    {
      env: childEnv({ PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" }),
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true,
      timeout: 30_000,
    },
  );

  return JSON.parse(stdout) as CrgResult;
}
