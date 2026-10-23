// Data the product tour replays. The issue, the run's tool calls, the patch and
// the pull request are taken from a real run on the public demo repository
// (rahulp7801/opensrcer-demo, issue #2 -> draft PR #6, October 20-21, 2026).
// Everything marked EXAMPLE is illustrative and labelled that way on screen.

export const DEMO_REPO = "rahulp7801/opensrcer-demo";
export const SITE = "opensrced.vercel.app";

/** The demo repository's open issues (real). */
export const DEMO_ISSUES = [
  { number: 1, title: "slugify leaves stray dashes for punctuation and spaces", scope: "leaf", risk: "low", complexity: 2, estimate: "~20m", files: ["src/slugify.ts"], symbols: ["slugify"] },
  { number: 2, title: "truncate cuts mid-word and returns more than max characters", scope: "leaf", risk: "medium", complexity: 2, estimate: "~30m", files: ["src/truncate.ts"], symbols: ["truncate", "TruncateOptions"] },
  { number: 3, title: "parseDuration returns NaN for compound durations like \"1h30m\"", scope: "leaf", risk: "medium", complexity: 3, estimate: "~45m", files: ["src/duration.ts"], symbols: ["parseDuration", "UNIT_MS"] },
  { number: 4, title: "splitCsvLine breaks quoted fields that contain commas", scope: "leaf", risk: "medium", complexity: 3, estimate: "~45m", files: ["src/csv.ts"], symbols: ["splitCsvLine"] },
] as const;

export const ISSUE = DEMO_ISSUES[1];

/** Issue #2's body (real), as the reviewer sees it. */
export const ISSUE_BODY = [
  "The docs say `truncate` ends on a word boundary and that the ellipsis counts toward `max`. Neither is true today.",
  "truncate(\"The quick brown fox\", 12)",
  "// expected: \"The quick…\"     (10 chars)",
  "// actual:   \"The quick br…\"  (13 chars, cut inside \"brown\")",
];

/** The run (real): duration, spend and the pull request it opened. */
export const RUN = {
  id: "c_1792549506303_25804b7e7f43",
  seconds: 69,
  cost: 0.2010,
  budget: 2,
  pr: 6,
  branch: "opensrcer/issue-2-25-16_9f59b5",
  prTitle: "fix: keep truncate within max and cut on word boundaries",
};

/** The run log, as the Runs page streams it. `at` is the share of the run (0-1)
 *  when the line appears. The tool calls are the agent's real calls on this issue
 *  (re-run on October 22, 2026: 77 s, $0.22); the patch and PR are from PR #6. */
export const RUN_LOG: Array<{ at: number; text: string }> = [
  { at: 0.00, text: `[agentic-dispatcher] repo: ${DEMO_REPO}  issue: #2` },
  { at: 0.015, text: "[agentic-dispatcher] guardrails: --max-budget-usd=2 · timeout=1800s" },
  { at: 0.03, text: "I'll start by orienting on the repo and looking for contribution guidelines." },
  { at: 0.050, text: "[tool] repo_info" },
  { at: 0.072, text: "[tool] list_files CONTRIBUTING*" },
  { at: 0.094, text: "[tool] list_files" },
  { at: 0.116, text: "[tool] list_files .github/**" },
  { at: 0.138, text: "[tool] read_file README.md" },
  { at: 0.160, text: "[tool] read_file package.json" },
  { at: 0.182, text: "[tool] read_file src/truncate.ts" },
  { at: 0.204, text: "[tool] read_file test/text.test.ts" },
  { at: 0.226, text: "[tool] read_file src/index.ts" },
  { at: 0.248, text: "[tool] find_references truncate" },
  { at: 0.270, text: "[tool] read_file src/slugify.ts" },
  { at: 0.30, text: "## Conventions" },
  { at: 0.32, text: "- No contribution guide found: no CONTRIBUTING*, no .github/, no templates." },
  { at: 0.345, text: "- Matched what the repo already does: `area: summary` commit subjects," },
  { at: 0.36, text: "  a JSDoc example on every exported helper, tests via `npm test`." },
  { at: 0.40, text: "## Diagnosis" },
  { at: 0.42, text: "`truncate` slices at a fixed index and appends the ellipsis after" },
  { at: 0.44, text: "using the whole budget, so results are max + 1 characters and cut" },
  { at: 0.46, text: "mid-word (src/truncate.ts:15)." },
  { at: 0.52, text: "```diff" },
  { at: 0.535, text: "--- a/src/truncate.ts" },
  { at: 0.545, text: "+++ b/src/truncate.ts" },
  { at: 0.56, text: "-  return text.slice(0, max) + ellipsis;" },
  { at: 0.575, text: "+  const budget = max - ellipsis.length;" },
  { at: 0.59, text: "+  …" },
  { at: 0.60, text: "```" },
  { at: 0.66, text: `[agentic-dispatcher] total_cost_usd=${0.200982.toFixed(6)}` },
  { at: 0.68, text: "[agentic-dispatcher] exited · status=succeeded · exit=0" },
  // A run now ends at a frozen preview, as lib/run-finish.ts prints it. Hosted
  // runs cannot run the repository's tests, so verification is "not run"; the
  // secret scan and the draft PR come only when the user publishes.
  { at: 0.73, text: "[preview] ─────────────────────────────" },
  { at: 0.80, text: `[preview] ready for review: "${RUN.prTitle}" (2 file(s), sign-off=false, verification=not run)` },
  { at: 0.90, text: "[preview] nothing has been published; review the patch and evidence, then use Publish on the run page" },
];

/** "What was found" and "Risk & testing", from the run (real, lightly shortened). */
export const DIAGNOSIS =
  "`truncate` ignored both of its documented guarantees. `src/truncate.ts:15` sliced at a fixed index with no regard for word boundaries, then appended the ellipsis after using the whole `max` budget, so `truncate(\"The quick brown fox\", 12)` returned `\"The quick br…\"`: 13 characters, cut inside \"brown\".";

export const RISK = [
  "`npm test` covers four new cases: the word boundary from the issue, a custom ellipsis, a single oversized word, and a budget that lands on a space.",
  "`find_references` shows no internal callers, so the blast radius is the public API.",
  "Flagged for review: length is still counted in UTF-16 code units, as before.",
];

/** The real patch (PR #6), file by file, for the split view. `null` is a gap
 *  that keeps the two sides aligned, as the real split view draws it. */
export const PATCH: Array<{ file: string; before: Array<string | null>; after: string[]; removed: number[]; added: number[] }> = [
  {
    file: "src/truncate.ts",
    before: [
      "export function truncate(text: string, max: number, options: TruncateOptions = {}): string {",
      "  const ellipsis = options.ellipsis ?? \"…\";",
      "  if (text.length <= max) return text;",
      "  return text.slice(0, max) + ellipsis;",
      ...Array<null>(11).fill(null),
      "}",
    ],
    after: [
      "export function truncate(text: string, max: number, options: TruncateOptions = {}): string {",
      "  const ellipsis = options.ellipsis ?? \"…\";",
      "  if (text.length <= max) return text;",
      "",
      "  // The ellipsis counts toward `max`, so it has to come out of the budget first.",
      "  const budget = max - ellipsis.length;",
      "  if (budget <= 0) return ellipsis.slice(0, Math.max(max, 0));",
      "",
      "  let head = text.slice(0, budget);",
      "  if (!/\\s/.test(text.charAt(budget))) {",
      "    const boundary = head.replace(/\\S*$/, \"\");",
      "    if (boundary.trim().length > 0) head = boundary;",
      "  }",
      "",
      "  return head.replace(/\\s+$/, \"\") + ellipsis;",
      "}",
    ],
    removed: [3],
    added: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  },
  {
    file: "test/text.test.ts",
    before: [],
    after: [
      "test(\"truncate ends on a word boundary within max\", () => {",
      "  const result = truncate(\"The quick brown fox\", 12);",
      "  assert.equal(result, \"The quick…\");",
      "  assert.ok(result.length <= 12);",
      "});",
    ],
    removed: [],
    added: [0, 1, 2, 3, 4],
  },
];

export const PATCH_STATS = { files: 2, additions: 35, deletions: 1 };

/** The pull request description (real, PR #6), as GitHub renders it. */
export const PR_BODY: Array<{ heading?: string; text: string }> = [
  { text: "`truncate` now never returns more than `max` characters and never splits a word." },
  { heading: "Root cause", text: "`src/truncate.ts:15` sliced at a fixed index and appended the ellipsis after consuming the full `max` budget, so results were `max + ellipsis.length` characters long and could cut inside a word." },
  { heading: "What changed", text: "The ellipsis length now comes out of `max` up front. If the cut lands inside a word, the partial word is dropped so the result ends on the previous word boundary. `truncate(\"The quick brown fox\", 12)` now returns `\"The quick…\"` (10 characters)." },
  { heading: "Test plan", text: "`npm test`. Four new cases in `test/text.test.ts`, each also checking `result.length <= max`." },
  { text: "Fixes #2" },
  // Added by the publish step since October 23 (lib/disclosure.ts); PR #6 itself predates it.
  { heading: "AI assistance", text: "This change was drafted with opensrcer, an AI coding tool, at the request of the PR author, who reviewed the diff and the test evidence before opening this PR and is responsible for it. Verification: Not verified: the tool could not run code for this change; no tests were run." },
];

// ── EXAMPLE data (illustrative, labelled on screen) ──────────────────────

// Fictional repositories: example rows must never put invented issues in real projects.
export const DISCOVER_ROWS = [
  { repo: "rahulp7801/opensrcer-demo", lang: "TypeScript", stars: "demo", number: 2, title: "truncate cuts mid-word and returns more than max characters", scope: "leaf", severity: "medium", complexity: 2, estimate: "~30m", demo: true },
  { repo: "acme/ledger", lang: "TypeScript", stars: "4.8k", number: 812, title: "Currency formatter drops trailing zeros for JPY", scope: "leaf", severity: "medium", complexity: 2, estimate: "~30m" },
  { repo: "acme/ui-kit", lang: "TypeScript", stars: "12.3k", number: 2290, title: "Docs: Dialog focus-trap example is outdated", scope: "doc", severity: "low", complexity: 1, estimate: "~15m" },
  { repo: "acme/job-queue", lang: "TypeScript", stars: "7.1k", number: 455, title: "Retry backoff ignores the max delay option", scope: "cross", severity: "high", complexity: 4, estimate: "~1.5h" },
  { repo: "acme/router", lang: "TypeScript", stars: "2.6k", number: 1307, title: "parseQuery throws on empty array params", scope: "leaf", severity: "medium", complexity: 2, estimate: "~30m" },
  { repo: "acme/editor", lang: "TypeScript", stars: "18.9k", number: 5521, title: "Split the document store for multi-pane editing", scope: "refactor", severity: "high", complexity: 5, estimate: "~3h" },
] as const;

export const REVIEW_COMMENT = {
  author: "maintainer",
  path: "src/truncate.ts",
  line: 24,
  body: "Nice fix. Could trailing punctuation be trimmed before the ellipsis too? \"The quick, brown\" at 11 gives \"The quick,…\".",
};

export const COMMENT_FIX = [
  "--- a/src/truncate.ts",
  "+++ b/src/truncate.ts",
  "@@ -24,1 +24,1 @@",
  "-  return head.replace(/\\s+$/, \"\") + ellipsis;",
  "+  return head.replace(/[\\s,;:]+$/, \"\") + ellipsis;",
];

export const VERIFY_CHECKS: Array<{ name: string; tone: "pass" | "warn"; detail: string }> = [
  { name: "Scope", tone: "pass", detail: "2 lines changed across 1 file(s) — minimal, focused change" },
  { name: "Minimal change", tone: "pass", detail: "1 functional line(s) added, 0 import(s) — focused on the fix" },
  { name: "Secrets", tone: "pass", detail: "No hardcoded secrets detected in the diff" },
  { name: "Syntax", tone: "pass", detail: "No bracket imbalance detected. Code has not been compiled or tested." },
  { name: "Review alignment", tone: "pass", detail: "Changes target the reviewed file (src/truncate.ts)" },
  { name: "Execution", tone: "warn", detail: "Repository tests were not run. Static checks do not verify behavior." },
];

export const ORG = "acme-corp";
export const ORG_REPOS = [
  { name: "api-gateway", lang: "Go", updated: "Oct 19" },
  { name: "web-app", lang: "TypeScript", updated: "Oct 18" },
  { name: "billing-service", lang: "Python", updated: "Oct 14" },
] as const;

export const FINDINGS = [
  { severity: "critical", kind: "dependabot", pkg: "path-matcher <2.1.4", summary: "Crafted route patterns trigger catastrophic regex backtracking" },
  { severity: "high", kind: "advisory", pkg: "http2-proxy <0.9.0", summary: "Unbounded header frames can exhaust server memory" },
  { severity: "high", kind: "dependabot", pkg: "netaddr <1.3.2", summary: "IPv4-mapped IPv6 addresses bypass the private-range check" },
  { severity: "medium", kind: "advisory", pkg: "yaml-lite <3.0.1", summary: "Deeply nested documents cause a stack overflow" },
] as const;

export const STATS = { runs: 42, patches: 31, prs: 11, spend: 14.82, scans: 128, discover: 9 };

export const ACTIVITY = [
  { kind: "run", text: `run on ${DEMO_REPO} #2 · PR opened`, when: "2m ago" },
  { kind: "scan", text: `scan ${DEMO_REPO}`, when: "6m ago" },
  { kind: "discover", text: "discover search run", when: "9m ago" },
  { kind: "run", text: "run on acme/ui-kit #2290 · PR opened", when: "1h ago" },
  { kind: "run", text: "run on acme/router #1307", when: "3h ago" },
] as const;

/** Earlier real runs on the demo repository (October 20), for the Runs list. */
export const PAST_RUNS = [
  { number: 4, title: "splitCsvLine breaks quoted fields that contain commas", dry: true, duration: "1m 13s", status: "succeeded" },
  { number: 3, title: "parseDuration returns NaN for compound durations like \"1h30m\"", dry: true, duration: "1m 19s", status: "succeeded" },
  { number: 1, title: "slugify leaves stray dashes for punctuation and spaces", dry: false, duration: "1m 03s", status: "PR opened" },
] as const;

// ── Data for the longer tour ──────────────────────────────────────────────

/** EXAMPLE: suggested beginner-friendly issues (fictional repositories). */
export const SUGGESTED = [
  { repo: "acme/ledger", number: 798, lang: "typescript", labels: ["good first issue"], title: "Add the currency code to the invalid-amount error message", updated: "3h ago", comments: 2, stars: "4,812" },
  { repo: "acme/data-tools", number: 311, lang: "python", labels: ["good first issue", "docs"], title: "Document the --dry-run flag in the CLI reference", updated: "5h ago", comments: 0, stars: "2,190" },
  { repo: "acme/ui-kit", number: 2301, lang: "typescript", labels: ["good first issue", "bug"], title: "Tooltip arrow points the wrong way in right-to-left layouts", updated: "1d ago", comments: 4, stars: "12,304" },
  { repo: "acme/forms", number: 88, lang: "python", labels: ["good first issue"], title: "Reject empty strings in optional email fields", updated: "1d ago", comments: 1, stars: "1,027" },
] as const;

/** EXAMPLE: notes typed into the New run form. */
export const RUN_NOTES = "Keep the public API unchanged; add tests for the example in the issue.";

/** EXAMPLE: a reviewer's question on PR #6, and the reply the agent drafts. */
export const QUESTION = {
  author: "maintainer",
  path: "src/truncate.ts",
  line: 19,
  body: "Why not use Intl.Segmenter for the word boundary? It would handle languages that don't use spaces.",
};
export const DRAFTED_REPLY =
  "Good point. Intl.Segmenter would be more accurate for languages that don't separate words with spaces. I kept this change to the documented, space-based behavior so it stays a small bug fix. Happy to follow up with a Segmenter-based version in a separate PR.";

/** EXAMPLE: a run whose patch could not be applied, so nothing was pushed. */
export const FAILED_RUN = {
  repo: "acme/router",
  number: 1307,
  title: "parseQuery throws on empty array params",
  reason: "the patch did not apply cleanly to the current branch; nothing was pushed",
  log: [
    "[agentic-dispatcher] exited · status=succeeded · exit=0",
    "[agentic-pr] starting auto-PR",
    "[agentic-pr] skipped: the patch did not apply cleanly to the current branch;",
    "  nothing was pushed and no pull request was opened",
  ],
};

/** EXAMPLE: the public page for a shared fix. */
export const SHARE = { id: "f_8c41e29a", until: "Nov 21, 2026" };

/** The export a finished run downloads (fields as the real report writes them). */
export const REPORT = [
  "# Dispatch Report",
  "",
  `- **Repo:** ${DEMO_REPO}`,
  "- **Issue:** #2",
  "- **Status:** succeeded",
  "- **Started:** 2026-10-21T02:25:16.448Z",
  "- **Ended:** 2026-10-21T02:26:25.306Z",
  "- **Duration:** 1m 09s",
  "- **Cost:** $0.2010",
  `- **PR:** [#6](https://github.com/${DEMO_REPO}/pull/6)`,
  "",
  "## Patch",
  "",
  "```diff",
  "--- a/src/truncate.ts",
  "+++ b/src/truncate.ts",
  "…",
];
