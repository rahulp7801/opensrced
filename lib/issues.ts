// Issue scanner — lists open issues for a repo via gh CLI and scores each
// with deterministic heuristics (labels + title/body signal). No LLM here:
// classification is ~instant, costs nothing, and is "good enough" for picking.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { classifyScope, type ScopeInfo } from "./scope";

// ── Stale-open detection ────────────────────────────────────────────────
// An issue can be OPEN on GitHub yet already fixed — a maintainer or the
// reporter dropped a "resolved in PR #123" line in the body and nobody
// closed the ticket. Running the pipeline on one of these burns tokens
// to regenerate work that's already merged. We scan the title/body/labels
// for the common "already handled" signals and force solvable=false.
//
// Body-only (not comments): fetching comment content per issue would 50x
// the API calls on a scan. The strongest signals show up in the OP's body
// or in the title prefix anyway; the rest is a v2.6 follow-up.
//
// Patterns are deliberately conservative — a "fixed" mention with a
// nearby negation ("not yet fixed", "still not resolved") is ignored.

// Each pattern returns the matched fragment via m[0]; the caller phrases
// the surrounding "body says …" / "comment says …" wrapper.
const RESOLVED_PATTERNS: RegExp[] = [
  // "Fixed in PR #123", "Resolved by #456", "Merged in #789"
  /\b(fixed|resolved|solved|addressed|merged|landed|shipped)\s+(?:in|by|via|with|through|as\s+of)\s+(?:(?:pr|pull\s*request|commit)\s*)?#?(\d+)\b/i,
  // "#123 fixes this" / "PR #456 resolves it"
  /\b(?:pr|pull\s*request|commit)?\s*#(\d+)\s+(fixes|resolves|closes|addresses|solves)\s+(?:this|it|the\s+issue)\b/i,
  // "this was/is already fixed/resolved/merged/shipped"
  /\bthis\s+(?:is|was|has\s+been)\s+(?:already\s+)?(fixed|resolved|solved|addressed|merged|shipped|released)\b/i,
  // "duplicate of #123" / "dup of #456"
  /\b(?:duplicate|dup)\s+of\s+#?(\d+)/i,
  // "closing as fixed/resolved/duplicate/obsolete"
  /\b(?:closing|mark(?:ing)?)\s+(?:as|this\s+as)\s+(fixed|resolved|duplicate|obsolete|stale)\b/i,
  // "already merged/released/shipped in <version>"
  /\balready\s+(merged|released|shipped|landed|fixed)\s+in\s+(?:v?\d+\.\d+|master|main|trunk|the\s+\w+\s+release)/i,
  // Status prefix on the title: [RESOLVED] foo, (FIXED) bar
  /^\s*[\[\(]\s*(RESOLVED|FIXED|DUPLICATE|CLOSED|DONE|OBSOLETE|STALE)\s*[\]\)]/i,
];

const RESOLVED_LABELS = [
  "fixed", "resolved", "duplicate", "obsolete", "stale", "done", "wontfix",
  "fixed-in-main", "fixed-in-master", "resolved-in-main", "closed-fixed",
];

// If a hit is within ~40 chars of a negation, drop it. Prevents "not yet
// fixed" or "still not resolved" from reading as resolved.
// Negations that should cancel a nearby "fixed/resolved/duplicate" hit.
// Cases learned from testing:
//   "not a duplicate of #99"          — "not a duplicate"
//   "still not fixed in main"         — "still not fixed"
//   "was fixed in 2020 but broke…"    — "but broke", "regression"
//   "the fix was reverted"            — "reverted"
const NEGATION_RE = new RegExp(
  "\\b(" +
    "not\\s+(a\\s+)?(yet\\s+)?(fixed|resolved|solved|closed|merged|addressed|duplicate|dup)" +
    "|still\\s+(not\\s+)?(broken|unresolved|open|not\\s+working|happening|reproducible)" +
    "|(?:doesn'?t|didn'?t)\\s+(fix|resolve|close)" +
    "|hasn'?t\\s+been\\s+(fixed|resolved)" +
    "|but\\s+(?:it\\s+)?(?:broke|broken|regress(?:ed|ion)?|reopen(?:ed)?|came\\s+back|was\\s+reopened)" +
    "|reverted" +
    "|regression" +
  ")\\b",
  "i",
);

function hasNearbyNegation(text: string, hitIndex: number, hitLen: number): boolean {
  const start = Math.max(0, hitIndex - 40);
  const end = Math.min(text.length, hitIndex + hitLen + 40);
  return NEGATION_RE.test(text.slice(start, end));
}

type ResolvedHint = { reason: string };

function scanForResolved(corpus: string): string | null {
  for (const re of RESOLVED_PATTERNS) {
    const m = re.exec(corpus);
    if (!m) continue;
    if (hasNearbyNegation(corpus, m.index, m[0].length)) continue;
    return m[0].trim();
  }
  return null;
}

function detectResolved(
  title: string,
  body: string,
  labels: string[],
  comments: GhComment[] = [],
): ResolvedHint | null {
  // Label-based signal is the most trustworthy: maintainers typically add
  // `fixed-in-main` / `resolved` deliberately.
  const labelHit = labels.find((l) => RESOLVED_LABELS.includes(l.toLowerCase()));
  if (labelHit) return { reason: `label "${labelHit}" suggests resolved` };

  // Title + body.
  const bodyHit = scanForResolved(`${title}\n${body}`);
  if (bodyHit) return { reason: `body says "${bodyHit}"` };

  // Then each comment, oldest → newest. Any match is enough — a single
  // credible "fixed in #N" is the whole point of adding this pass.
  // Maintainer comments (OWNER/MEMBER/COLLABORATOR) get called out in
  // the reason so the user sees the signal's authority.
  for (const c of comments) {
    if (!c.body) continue;
    const hit = scanForResolved(c.body);
    if (!hit) continue;
    const who = c.author?.login ? `@${c.author.login}` : "someone";
    const assoc = c.authorAssociation ?? "";
    const authority =
      assoc === "OWNER" || assoc === "MEMBER" || assoc === "COLLABORATOR"
        ? " (maintainer)"
        : "";
    return { reason: `comment by ${who}${authority} says "${hit}"` };
  }

  return null;
}

const execFileAsync = promisify(execFile);

export type IssueCategory =
  | "bug"
  | "feature"
  | "docs"
  | "refactor"
  | "test"
  | "performance"
  | "security"
  | "question"
  | "other";

export type Severity = "low" | "medium" | "high" | "critical";

export type ScannedIssue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  author: string;
  url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  category: IssueCategory;
  severity: Severity;
  complexity: number; // 1 (trivial) – 5 (hard)
  est_minutes: number;
  solvable: boolean;
  reason: string;
  scope: ScopeInfo;
};

type GhComment = {
  body: string;
  author: { login: string } | null;
  authorAssociation?: string;  // OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | NONE
  createdAt: string;
};

type GhIssue = {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  state: string;
  author: { login: string } | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  assignees: Array<{ login: string }>;
  // gh --json comments returns full bodies inline; we use them for
  // stale-open detection so the scanner skips issues resolved in a comment.
  comments: GhComment[];
};

function ghBin(): string {
  const env = process.env.GH_CLI;
  if (env && existsSync(env)) return env;
  return "gh"; // falls through to PATH on systems where gh is on PATH
}

export async function listIssues(
  owner: string,
  repo: string,
  limit = 50,
  extraLabels: string[] = [],
): Promise<ScannedIssue[]> {
  // Recent batch: most recently created N issues regardless of label.
  // Label-filtered batches: ensures beginner-friendly issues show up even
  // on active repos where they're old (maintainers keep them open for
  // newcomers, so they're rarely in the recent N).
  const calls: Array<Promise<GhIssue[]>> = [
    runListIssues(owner, repo, limit, []),
    ...extraLabels.map((l) => runListIssues(owner, repo, limit, [l])),
  ];
  const batches = await Promise.all(calls.map((p) => p.catch(() => [])));

  // Dedupe by issue number — first occurrence wins
  const seen = new Set<number>();
  const merged: GhIssue[] = [];
  for (const batch of batches) {
    for (const issue of batch) {
      if (seen.has(issue.number)) continue;
      seen.add(issue.number);
      merged.push(issue);
    }
  }
  return merged.map(scoreIssue);
}

async function runListIssues(
  owner: string,
  repo: string,
  limit: number,
  labels: string[],
): Promise<GhIssue[]> {
  const args = [
    "issue",
    "list",
    "--repo",
    `${owner}/${repo}`,
    "--state",
    "open",
    "--limit",
    String(limit),
    "--json",
    "number,title,body,labels,state,author,url,createdAt,updatedAt,assignees,comments",
  ];
  for (const l of labels) {
    args.push("--label", l);
  }
  const { stdout } = await execFileAsync(ghBin(), args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as GhIssue[];
}

function scoreIssue(i: GhIssue): ScannedIssue {
  const labels = (i.labels ?? []).map((l) => l.name.toLowerCase());
  const title = (i.title ?? "").toLowerCase();
  const body = (i.body ?? "").toLowerCase();
  const all = `${title}\n${body}`;
  const commentList = Array.isArray(i.comments) ? i.comments : [];
  const comments = commentList.length;

  // ── Category ────────────────────────────────────────
  const category: IssueCategory = (() => {
    if (labels.some((l) => /security|cve|vuln/.test(l))) return "security";
    if (labels.some((l) => /bug|crash|regression|defect/.test(l))) return "bug";
    if (labels.some((l) => /doc/.test(l))) return "docs";
    if (labels.some((l) => /performance|perf|slow/.test(l))) return "performance";
    if (labels.some((l) => /test/.test(l))) return "test";
    if (labels.some((l) => /refactor|cleanup/.test(l))) return "refactor";
    if (labels.some((l) => /feature|enhancement/.test(l))) return "feature";
    if (labels.some((l) => /question|discuss/.test(l))) return "question";
    // Title fallbacks
    if (/\b(crash|error|broken|fails?|bug|regression)\b/.test(title)) return "bug";
    if (/\b(add|support|implement|introduce|create|generate|define|provide|build|produce)\b/.test(title)) return "feature";
    if (/\b(docs?|readme|documentation)\b/.test(title)) return "docs";
    if (/\b(test|tests|coverage)\b/.test(title)) return "test";
    if (/\b(refactor|simplify|cleanup)\b/.test(title)) return "refactor";
    return "other";
  })();

  // ── Severity ────────────────────────────────────────
  const severity: Severity = (() => {
    if (labels.some((l) => /critical|p0/.test(l))) return "critical";
    if (category === "security") return "high";
    if (labels.some((l) => /high|p1/.test(l))) return "high";
    if (labels.some((l) => /low|trivial|nice|minor/.test(l))) return "low";
    if (/\b(crash|data loss|corruption|panic|segfault)\b/.test(all)) return "high";
    if (/\b(typo|minor|cosmetic)\b/.test(all)) return "low";
    return "medium";
  })();

  // ── Complexity 1–5 ──────────────────────────────────
  const bodyChars = (i.body ?? "").length;
  const refFiles = (i.body?.match(/`[^`\n]{3,}\.(py|ts|tsx|js|rs|go|java|c|cpp|h|md|yaml)`/g) ?? []).length;
  const snippets = (i.body?.match(/```[\s\S]*?```/g) ?? []).length;
  let complexity = 1;
  if (bodyChars > 400) complexity++;
  if (bodyChars > 1500) complexity++;
  if (refFiles > 2 || snippets > 1) complexity++;
  if (category === "refactor" || category === "performance") complexity++;
  if (comments > 5) complexity++; // lots of discussion = contested scope
  complexity = Math.min(5, Math.max(1, complexity));

  // ── Time estimate (very rough) ──────────────────────
  const est_minutes = { 1: 8, 2: 20, 3: 45, 4: 90, 5: 180 }[complexity] ?? 30;

  // ── Solvable? ───────────────────────────────────────
  let solvable = true;
  let reason = "";
  // Stale-open detection runs first: an issue already fixed in a PR must
  // never dispatch the pipeline, regardless of other signals. Checks the
  // title + body + labels, then every comment body (gh --json comments
  // returns full content inline, so this is free — no extra API calls).
  const resolvedHint = detectResolved(i.title ?? "", i.body ?? "", labels, commentList);
  // Assignee check: if someone's actively claimed this issue on GitHub,
  // opening a parallel PR wastes their work and ours. Bots that self-assign
  // (dependabot, github-actions[bot], etc.) count — they're definitionally
  // the owner of that issue's resolution.
  const assigneeLogins = (i.assignees ?? []).map((a) => a.login).filter(Boolean);
  if (resolvedHint) {
    solvable = false;
    reason = `Appears already resolved (${resolvedHint.reason}). Skip — the ticket is stale-open.`;
  } else if (assigneeLogins.length > 0) {
    const who =
      assigneeLogins.length === 1
        ? `@${assigneeLogins[0]}`
        : `${assigneeLogins.slice(0, 2).map((l) => `@${l}`).join(", ")}${
            assigneeLogins.length > 2 ? ` +${assigneeLogins.length - 2}` : ""
          }`;
    solvable = false;
    reason = `Already assigned to ${who} — someone's on it. Skip.`;
  } else if (category === "question") {
    solvable = false;
    reason = "Question, not an actionable issue.";
  } else if (/\b(cannot reproduce|not reproducible|nonetype error)\b/.test(all) && bodyChars < 300) {
    solvable = false;
    reason = "Not enough repro detail for automated fix.";
  } else if (labels.some((l) => /needs-triage|wontfix|duplicate|invalid/.test(l))) {
    solvable = false;
    reason = "Labeled as non-actionable.";
  } else if (category === "other" && bodyChars < 80) {
    solvable = false;
    reason = "Unclear scope — issue body too sparse.";
  } else {
    reason = "Has enough signal for an automated fix attempt.";
  }

  const scope = classifyScope(i.title ?? "", i.body ?? "");

  return {
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: labels,
    state: i.state,
    author: i.author?.login ?? "unknown",
    url: i.url,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
    comments,
    category,
    severity,
    complexity,
    est_minutes,
    solvable,
    reason,
    scope,
  };
}
