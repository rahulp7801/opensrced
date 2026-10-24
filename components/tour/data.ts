// Data the product tour replays. The issue, the run's tool calls, the patch and
// the pull request are taken from a real run on the public demo repository
// (rahulp7801/opensrcer-demo, issue #2 -> hosted, verified run -> draft PR #7, October 24, 2026).
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
  id: "c_1792871013551_0adfa89a9f16",
  seconds: 53,
  cost: 0.0981,
  budget: 2,
  pr: 7,
  branch: "opensrcer/issue-2-0adfa89a9f16",
  prTitle: "Fix truncate to respect max length and word boundaries",
};

/** The run log, as the Runs page streams it. `at` is the share of the run (0-1)
 *  when the line appears. The lines are the real run's (October 24, 2026, hosted
 *  with a test machine: 53 s, $0.098), shortened where they repeat. */
export const RUN_LOG: Array<{ at: number; text: string }> = [
  { at: 0.00, text: "[profile] dco=false cla=none template=no agent-rules=no ai-policy=unknown ai-trailer=none sources=none" },
  { at: 0.01, text: "[exec] mode=remote (exec VM provided by the web app)" },
  { at: 0.02, text: "[setup] no environment recipe for this repository; the agent installs what it needs" },
  { at: 0.03, text: `[agentic-dispatcher] repo: ${DEMO_REPO}  issue: #2` },
  { at: 0.04, text: "[agentic-dispatcher] guardrails: cap=budget --max-budget-usd=1 --max-turns=120 · timeout=1200s" },
  { at: 0.06, text: "[tool] repo_info" },
  { at: 0.08, text: "[tool] find_definition truncate" },
  { at: 0.10, text: "[tool] read_file src/truncate.ts" },
  { at: 0.12, text: "[tool] list_files test/**" },
  { at: 0.14, text: "[tool] read_file test/text.test.ts" },
  { at: 0.16, text: "[tool] read_file package.json" },
  { at: 0.18, text: "[tool] grep ." },
  { at: 0.20, text: "[tool] read_file README.md" },
  { at: 0.30, text: "## Conventions" },
  { at: 0.32, text: "No contribution guide (CONTRIBUTING, PR template) found in this repo. Observed conventions from the codebase itself: tests live in `test/text.test.ts` using Node's built-in `node:test` + `node:assert/strict`, run via `npm test`. No lint/format config files are present." },
  { at: 0.40, text: "## Diagnosis" },
  { at: 0.42, text: "`truncate` in `src/truncate.ts:15` (original) simply did `text.slice(0, max) + ellipsis`, which never accounted for the ellipsis's length against `max`, and sliced at a fixed character offset with no awareness of word boundaries." },
  { at: 0.48, text: "[tool] edit_file src/truncate.ts" },
  { at: 0.50, text: "[tool] edit_file test/text.test.ts" },
  { at: 0.53, text: "[tool] run_command node --version && node --experimental-strip-types --test \"test/**/*.test.ts\"" },
  { at: 0.55, text: "All tests pass. No separate linter config found (no eslint/prettier config files), so no lint step to run." },
  { at: 0.62, text: "[agentic-dispatcher] total_cost_usd=0.098148" },
  { at: 0.64, text: "[agentic-dispatcher] exited · status=succeeded · exit=0" },
  { at: 0.66, text: "[exec] final patch = git diff of the workspace (1481 bytes)" },
  { at: 0.70, text: "[verify] re-running 1 test and 0 lint command(s) on the final patch" },
  { at: 0.74, text: "[verify] status=verified regression=reproduced" },
  { at: 0.76, text: "[verify] reason=declared tests pass, and fail with the source change reverted" },
  { at: 0.78, text: "[verify] test: node --experimental-strip-types --test \"test/**/*.test.ts\"" },
  { at: 0.79, text: "[verify]   exit=0 · 0.2s" },
  { at: 0.81, text: "[verify] fail-before: (source change reverted) node --experimental-strip-types --test \"test/**/*.test.ts\"" },
  { at: 0.82, text: "[verify]   exit=1 · 0.2s" },
  { at: 0.86, text: "[preview] ─────────────────────────────" },
  { at: 0.88, text: `[preview] ready for review: "${RUN.prTitle}" (2 file(s), sign-off=false, verification=verified)` },
  { at: 0.92, text: "[preview] nothing has been published; review the patch and evidence, then use Publish on the run page" },
];

/** "What was found" and "Risk & testing", from the run (real, lightly shortened). */
export const DIAGNOSIS =
  "`truncate` in `src/truncate.ts:15` simply did `text.slice(0, max) + ellipsis`: it never counted the ellipsis against `max`, so the result could be longer than `max`, and it sliced at a fixed offset with no awareness of word boundaries, so it could cut in the middle of a word. Both contradict the function's own documented contract.";

export const RISK = [
  "The change is in the core slicing logic of `truncate`. The function is pure and self-contained, with no other call sites in `src/`.",
  "Two new tests cover the issue's exact example and a cut that already lands on a space; all 6 tests pass.",
  "When `max` is smaller than the ellipsis it's handled defensively, but not separately tested.",
];

/** The real patch (PR #7), file by file, for the split view. `null` is a gap
 *  that keeps the two sides aligned, as the real split view draws it. */
export const PATCH: Array<{ file: string; before: Array<string | null>; after: string[]; removed: number[]; added: number[] }> = [
  {
    file: "src/truncate.ts",
    before: [
      "export function truncate(text: string, max: number, options: TruncateOptions = {}): string {",
      "  const ellipsis = options.ellipsis ?? \"…\";",
      "  if (text.length <= max) return text;",
      "  return text.slice(0, max) + ellipsis;",
      ...Array<null>(8).fill(null),
      "}",
    ],
    after: [
      "export function truncate(text: string, max: number, options: TruncateOptions = {}): string {",
      "  const ellipsis = options.ellipsis ?? \"…\";",
      "  if (text.length <= max) return text;",
      "  if (max <= ellipsis.length) return ellipsis.slice(0, max);",
      "",
      "  const budget = max - ellipsis.length;",
      "  let truncated = text.slice(0, budget);",
      "  if (text[budget] !== \" \") {",
      "    const lastSpace = truncated.lastIndexOf(\" \");",
      "    if (lastSpace > 0) truncated = truncated.slice(0, lastSpace);",
      "  }",
      "  return truncated.trimEnd() + ellipsis;",
      "}",
    ],
    removed: [3],
    added: [3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    file: "test/text.test.ts",
    before: [],
    after: [
      "test(\"truncate ends on a word boundary and keeps the ellipsis within max\", () => {",
      "  const result = truncate(\"The quick brown fox\", 12);",
      "  assert.equal(result, \"The quick…\");",
      "  assert.ok(result.length <= 12);",
      "});",
      "",
      "test(\"truncate does not need to back up when the cut already lands on a space\", () => {",
      "  assert.equal(truncate(\"The quick brown fox\", 10), \"The quick…\");",
      "});",
    ],
    removed: [],
    added: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  },
];

export const PATCH_STATS = { files: 2, additions: 19, deletions: 1 };

/** The pull request description (real, PR #7, byte for byte apart from the link markup),
 *  as GitHub renders it. `spot` names what the stage can spotlight. */
export const PR_BODY: Array<{ heading?: string; text: string; spot?: string }> = [
  { heading: "Summary", text: "`truncate` could return strings longer than `max` (because the ellipsis wasn't counted) and could split a word mid-way, both contradicting the function's documented behavior." },
  { heading: "Root cause", text: "`src/truncate.ts` sliced the input at a fixed offset of `max` characters and then appended the ellipsis on top, instead of reserving space for the ellipsis within the `max` budget, and it never looked for a word boundary before cutting." },
  { heading: "What changed", text: "- Reserve `ellipsis.length` characters out of `max` before slicing (`budget = max - ellipsis.length`).\n- If the character right after the cut point is not whitespace (i.e., the cut falls inside a word), back up to the last space within the truncated slice so words aren't split.\n- Trim trailing whitespace before appending the ellipsis.\n- Guard the degenerate case where `max` is smaller than the ellipsis itself." },
  { heading: "Tests", text: "Added two cases in `test/text.test.ts`: the exact example from the issue (`truncate(\"The quick brown fox\", 12) === \"The quick…\"`, length ≤ 12) and a case where the cut point already lands on a space (no word-boundary backup needed)." },
  { text: "Fixes #2" },
  { heading: "Tests run", text: "- `node --experimental-strip-types --test \"test/**/*.test.ts\"` — passed (0.2s)\n- Regression check: With the source change reverted (test changes kept) the tests fail; with it they pass." },
  { text: "Result: verified (declared tests pass, and fail with the source change reverted).", spot: "pr-verified" },
  { heading: "AI assistance", text: "This change was drafted with opensrcer, an AI coding tool, at the request of the PR author, who reviewed the diff and the test evidence before opening this PR and is responsible for it.\n- Model: claude-sonnet-5 (Anthropic), driven through Claude Code with repository-scoped tools.\n- Verification: The tool re-ran the commands under \"Tests run\" on the final patch: they pass, and the new test fails without the fix.", spot: "pr-ai" },
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
  line: 23,
  body: "Nice fix. Could trailing punctuation be trimmed before the ellipsis too? \"The quick, brown\" at 11 gives \"The quick,…\".",
};

export const COMMENT_FIX = [
  "--- a/src/truncate.ts",
  "+++ b/src/truncate.ts",
  "@@ -23,1 +23,1 @@",
  "-  return truncated.trimEnd() + ellipsis;",
  "+  return truncated.replace(/[\\s,;:]+$/, \"\") + ellipsis;",
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

/** EXAMPLE: a reviewer's question on PR #7, and the reply the agent drafts. */
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
  "- **Started:** 2026-10-24T19:43:51.479Z",
  "- **Ended:** 2026-10-24T19:44:44.363Z",
  "- **Duration:** 0m 53s",
  "- **Cost:** $0.0981",
  `- **PR:** [#7](https://github.com/${DEMO_REPO}/pull/7)`,
  "",
  "## Patch",
  "",
  "```diff",
  "--- a/src/truncate.ts",
  "+++ b/src/truncate.ts",
  "…",
];
