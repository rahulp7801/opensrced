// POST /api/prs/verify
// Runs verification checks on a generated diff before pushing.
// All checks are deterministic — zero LLM cost, instant.
//
// Checks:
// 1. Scope — how many lines/files changed? Flag if excessive
// 2. Minimal change — does the diff touch only relevant code?
// 3. Secrets — scan diff for hardcoded API keys, tokens, passwords
// 4. Syntax — basic AST-level checks (balanced braces, valid structure)
// 5. Impact — if graph data available, show downstream callers

import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { graphJsonPath, loadGraph, type GraphData } from "@/lib/graph";
import { ensureGraph } from "@/lib/graph-build";

export const dynamic = "force-dynamic";

type Check = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    diff?: string;
    comment_body?: string;
    file_path?: string | null;
    repo?: string;
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
      name: "Syntax",
      status: "warn",
      detail: `Bracket imbalance in added code: {${openBraces}/${closeBraces}} (${openParens}/${closeParens}). Verify structure is correct.`,
    });
  } else {
    checks.push({
      name: "Syntax",
      status: "pass",
      detail: "No obvious syntax issues in added code",
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

  // ── 6. Graph impact analysis ─────────────────────────────────────────
  // If a graphify knowledge graph exists for this repo, check what the
  // changed functions connect to. Flags when a "small" diff touches a
  // highly-connected node that has wide downstream impact.
  if (body.repo) {
    const m = body.repo.match(/^([^/]+)\/([^/]+)$/);
    if (m) {
      // Auto-build graph if it doesn't exist
      const gPath = graphJsonPath(m[1], m[2]);
      if (!existsSync(gPath)) {
        checks.push({
          name: "Graph impact",
          status: "warn",
          detail: "Building knowledge graph for impact analysis (first time only)...",
        });

        const buildResult = await ensureGraph(m[1], m[2]);
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
              status: "fail",
              detail: `HIGH IMPACT: ${impactResult.totalAffected} downstream dependents across ${impactResult.affectedModules} module(s). This change touches a critical node (${impactResult.topNode}). Review every dependent before pushing.`,
            });
          }
        } catch {
          // Graph load failed — skip silently
        }
      }
    }
  }

  // ── 7. Verification summary ─────────────────────────────────────────
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

// ── Graph impact helpers ──────────────────────────────────────────────

type ImpactResult = {
  totalAffected: number;
  affectedModules: number;
  affectedLabels: string[];
  topNode: string;
};

function analyzeImpactFromDiff(graph: GraphData, diff: string): ImpactResult {
  // Extract changed file paths from the diff
  const changedFiles = [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)]
    .map((m) => m[1].toLowerCase().replace(/\\/g, "/"));

  // Extract function/symbol names from changed lines
  // Look for definitions in removed lines (these are being modified)
  const changedSymbols: string[] = [];
  const defPatterns = [
    /^\-\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/,
    /^\+\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/,
  ];
  for (const line of diff.split("\n")) {
    for (const pat of defPatterns) {
      const m = pat.exec(line);
      if (m) changedSymbols.push(m[1].toLowerCase());
    }
  }

  // Find matching nodes in the graph — by file path or symbol name
  const matchedNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    const sf = (node.source_file || "").toLowerCase().replace(/\\/g, "/");
    const label = node.label.toLowerCase().replace(/\(\)$/, "");

    // Match by file
    if (changedFiles.some((f) => sf.includes(f) || f.includes(sf))) {
      matchedNodeIds.add(node.id);
    }
    // Match by symbol name
    if (changedSymbols.includes(label)) {
      matchedNodeIds.add(node.id);
    }
  }

  if (matchedNodeIds.size === 0) {
    return { totalAffected: 0, affectedModules: 0, affectedLabels: [], topNode: "" };
  }

  // BFS backward from all matched nodes to find all dependents
  const CALL_RELATIONS = new Set([
    "calls", "imports", "imports_from", "instantiates",
    "references", "uses_component",
  ]);

  const incoming = new Map<string, Array<{ source: string; relation: string }>>();
  for (const e of graph.links) {
    if (CALL_RELATIONS.has(e.relation)) {
      const list = incoming.get(e.target) ?? [];
      list.push({ source: e.source, relation: e.relation });
      incoming.set(e.target, list);
    }
  }

  const visited = new Set<string>(matchedNodeIds);
  const queue = [...matchedNodeIds];
  const affectedCommunities = new Set<number>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.find((n) => n.id === current);
    if (node) affectedCommunities.add(node.community);

    const callers = incoming.get(current) ?? [];
    for (const { source } of callers) {
      if (!visited.has(source)) {
        visited.add(source);
        queue.push(source);
      }
    }
  }

  // Remove the originally matched nodes from the count
  const dependentIds = [...visited].filter((id) => !matchedNodeIds.has(id));
  const dependentLabels = dependentIds
    .map((id) => graph.nodes.find((n) => n.id === id)?.label ?? id)
    .slice(0, 10);

  // Find the most connected matched node
  let topNode = "";
  let topDegree = 0;
  for (const id of matchedNodeIds) {
    const degree = (incoming.get(id) ?? []).length;
    if (degree > topDegree) {
      topDegree = degree;
      topNode = graph.nodes.find((n) => n.id === id)?.label ?? id;
    }
  }

  return {
    totalAffected: dependentIds.length,
    affectedModules: affectedCommunities.size,
    affectedLabels: dependentLabels,
    topNode,
  };
}
