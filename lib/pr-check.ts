// A pull request draft, checked against the project's measured norms
// (lib/repo-profile.ts) before it is opened. The harness's agent describes the
// draft from the local checkout; nothing here sees the code. Each check says
// what the project does, with the figure behind it, so the contributor decides.
//
// Fixed rules over the profile's numbers: no model, no guessing. A norm is
// enforced (status "warn") only when most merged PRs follow it (HABIT); below
// that it is at most a note.

import { changelogLocation, TEST_PATH, TITLE_PATTERNS } from "./maintainer-prefs";
import { engagementAdvice, MIN_SAMPLE, type RepoProfile, type Tally } from "./repo-profile";

/** A norm counts as a habit at this share of merged PRs. */
export const HABIT = 0.5;
/** A draft this many times the median merged size is called out. */
export const SIZE_FACTOR = 3;
const MAX_FILES = 3000;
const MAX_TEXT = 65_000;

export type PrDraft = {
  title: string;
  body: string;
  /** Repository paths the draft changes. */
  files: string[];
  additions: number;
  deletions: number;
  /** The body closes or links an issue ("Fixes #12"). */
  linkedIssue: boolean;
  /** Every commit carries "Signed-off-by:". Unknown when absent. */
  signedOff?: boolean;
};

export type Check = { id: string; status: "ok" | "warn" | "note"; text: string; examples: string[] };

export class InvalidDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDraftError";
  }
}

/** The draft from untrusted input, checked field by field. Throws InvalidDraftError. */
export function parseDraft(input: unknown): PrDraft {
  const d = (input ?? {}) as Record<string, unknown>;
  const text = (key: string, max: number) => {
    if (typeof d[key] !== "string") throw new InvalidDraftError(`${key} must be a string.`);
    return (d[key] as string).slice(0, max);
  };
  const count = (key: string) => {
    const n = d[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new InvalidDraftError(`${key} must be a whole number of lines.`);
    return n;
  };
  if (!Array.isArray(d.files) || d.files.length > MAX_FILES || !d.files.every((f) => typeof f === "string" && f.length > 0 && f.length < 500)) {
    throw new InvalidDraftError(`files must be a list of up to ${MAX_FILES} repository paths.`);
  }
  if (typeof d.linkedIssue !== "boolean") throw new InvalidDraftError("linkedIssue must be true or false.");
  if (d.signedOff !== undefined && typeof d.signedOff !== "boolean") throw new InvalidDraftError("signedOff must be true, false or left out.");
  const title = text("title", 300).trim();
  if (!title) throw new InvalidDraftError("title must not be empty.");
  return {
    title, body: text("body", MAX_TEXT), files: d.files as string[], additions: count("additions"), deletions: count("deletions"),
    linkedIssue: d.linkedIssue, ...(d.signedOff === undefined ? {} : { signedOff: d.signedOff as boolean }),
  };
}

const share = (t: Tally | null | undefined) => (t && t.of >= MIN_SAMPLE ? t.count / t.of : null);
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** The body says AI helped (any common wording or tool name). */
const DISCLOSES_AI = /\b(AI|LLM|Claude|Copilot|ChatGPT|GPT-\d|Gemini|Codex|Cursor|generated with|assisted by|AI[- ]assisted)\b/i;

/** The draft against the profile, most important first. Pure. */
export function checkDraft(p: RepoProfile, draft: PrDraft): Check[] {
  const checks: Check[] = [];
  const add = (id: string, status: Check["status"], text: string, examples: string[] = []) => checks.push({ id, status, text, examples });
  const ai = p.aiPolicy;

  // 1. Whether to open it at all, and how.
  if (ai?.stance === "banned") add("ai-policy", "warn", `This project does not accept AI-generated contributions${ai.source ? ` (${ai.source})` : ""}. Don't open this PR with AI-written code.`);
  else if (ai?.stance === "disclosure-required") {
    add("ai-disclosure", DISCLOSES_AI.test(draft.body) ? "ok" : "warn", DISCLOSES_AI.test(draft.body)
      ? "The description discloses AI assistance, as the project asks."
      : `The project asks contributors to disclose AI assistance${ai.source ? ` (${ai.source})` : ""}; the description doesn't mention it.`);
  } else if (!DISCLOSES_AI.test(draft.body)) add("ai-disclosure", "note", "The description doesn't mention AI assistance. Say so if AI helped, even where the project doesn't ask.");
  const advice = engagementAdvice(p);
  if (advice?.reason === "not_assigned") add("assigned", "warn", `${advice.count} of ${advice.of} recently closed outside PRs here were opened without being assigned to the issue. Make sure a maintainer assigned it to you.`);
  if (advice?.reason === "discuss_first") add("discussed", "warn", `${advice.count} of ${advice.of} recently closed outside PRs here were closed because the approach wasn't agreed first. Make sure it was agreed on the issue.`);
  for (const f of (ai?.agentFiles ?? []).slice(0, 2)) add("agent-file", "note", `The project's ${f.path} has instructions for this kind of change: check the draft follows them.`);

  // 2. What merged PRs here have.
  const o = p.outside;
  const linkedShare = share(o.linkedMerged);
  if (linkedShare !== null && linkedShare >= HABIT) {
    add("linked-issue", draft.linkedIssue ? "ok" : "warn", draft.linkedIssue
      ? "The description links an issue, like most merged PRs here."
      : `${pct(linkedShare)} of merged outside PRs here link an issue ("Fixes #123"); this description doesn't.`, o.linkedMerged.examples);
  }
  const touchesTests = draft.files.some((f) => TEST_PATH.test(f));
  const testsShare = share(o.testsMerged);
  if (testsShare !== null && testsShare >= HABIT) {
    add("tests", touchesTests ? "ok" : "warn", touchesTests
      ? "The draft changes tests, like most merged PRs here."
      : `${pct(testsShare)} of merged outside PRs here change tests; this draft changes none.`, o.testsMerged.examples);
  }
  const c = p.conventions;
  const changelogShare = share(c.changelogTally);
  if (c.changelogPath && changelogShare !== null) {
    const hasEntry = draft.files.some((f) => changelogLocation(f) !== null);
    add("changelog", hasEntry ? "ok" : changelogShare >= HABIT ? "warn" : "note", hasEntry
      ? "The draft adds a changelog entry."
      : `${c.changelogTally!.count} of ${c.changelogTally!.of} merged PRs here added a changelog entry, in ${c.changelogPath}; this draft has none.`, c.changelogTally!.examples);
  }
  if (c.title !== "none") {
    const fits = TITLE_PATTERNS[c.title].test(draft.title);
    const style = { conventional: 'Conventional Commits ("fix: …")', prefix: 'the area first ("area: …")', bracket: 'a tag in brackets ("[DOC] …")' }[c.title];
    add("title", fits ? "ok" : "warn", fits ? `The title follows the project's style: ${style}.` : `PR titles here use ${style}; "${draft.title}" doesn't.`, c.titleTally?.examples ?? []);
  }
  if (c.signOffShare !== null && c.signOffShare >= 0.6 && draft.signedOff !== undefined) {
    add("sign-off", draft.signedOff ? "ok" : "warn", draft.signedOff ? "Commits are signed off." : 'Commits here are signed off ("git commit -s"); this draft\'s aren\'t.');
  }
  const lines = draft.additions + draft.deletions;
  if (o.medianLinesMerged && o.merged.count >= MIN_SAMPLE && lines > SIZE_FACTOR * o.medianLinesMerged) {
    add("size", "warn", `The draft changes ${lines} lines; merged outside PRs here change a median of ${o.medianLinesMerged}. Consider splitting it.`);
  }
  const order = { warn: 0, note: 1, ok: 2 } as const;
  return checks.sort((a, b) => order[a.status] - order[b.status]);
}
