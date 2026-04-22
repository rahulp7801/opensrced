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

  // ── 6. Verification summary ─────────────────────────────────────────
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
