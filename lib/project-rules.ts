// "This project's rules" on the review screen: each rule opensrcer found in
// the project's files and how this run handled it, from the frozen preview.
// Pure, so every claim is tied to a recorded field and tested. Older previews
// lack `rules`: those rows say "not recorded" instead of claiming anything.

import type { GlossaryTerm } from "./glossary";
import type { PrPreview } from "./pr-preview";

export type RuleStatus = "done" | "action" | "blocked" | "check" | "unknown" | "none";

/** The visible tag per status (never color alone). */
export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  done: "Done",
  action: "Your action",
  blocked: "Blocked",
  check: "Check",
  unknown: "Not recorded",
  none: "Not needed",
};

export type RuleRow = { id: string; label: string; term?: GlossaryTerm; status: RuleStatus; text: string; detail?: string };

export type RulesPreview = Pick<PrPreview, "profile" | "signoff" | "executed" | "verification" | "blockers" | "warnings" | "body"> &
  Partial<Pick<PrPreview, "rules" | "draft_issue_comment" | "ask_first">>;

const NOT_RECORDED = "Not recorded for this run.";

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The host's disclosure line (lib/disclosure.ts), for previews from before `rules.disclosed`. */
const DISCLOSURE_LINE = "This change was drafted with [opensrcer]";

export function projectRules(p: RulesPreview): RuleRow[] {
  const rows: RuleRow[] = [];
  const profile = p.profile;
  const rules = p.rules;

  // Contribution guide: the files the profile was built from.
  if (!profile) rows.push({ id: "guide", label: "Contribution guide", status: "unknown", text: NOT_RECORDED });
  else {
    const extra = [
      rules?.agent_instructions ? "The project's instructions for AI agents were given to the agent." : "",
      rules?.notes ? `opensrcer also gave the agent its own ${rules.notes} note${rules.notes === 1 ? "" : "s"} for this project.` : "",
    ].filter(Boolean).join(" ");
    rows.push(profile.sources.length
      ? { id: "guide", label: "Contribution guide", status: "done", text: `Read ${list(profile.sources)}`, ...(extra ? { detail: extra } : {}) }
      : { id: "guide", label: "Contribution guide", status: "check", text: "No contribution guide found", detail: "The project has no CONTRIBUTING file opensrcer could read; check its README for how it takes changes." });
  }

  // PR template: told to the agent; the preview records which headings survived.
  const template = { id: "template", label: "PR template", term: "PR template" as const };
  if (!rules) rows.push({ ...template, status: "unknown", text: NOT_RECORDED });
  else if (!rules.pr_template) rows.push({ ...template, status: "none", text: "This project has no PR template" });
  else if (!rules.template_headings) rows.push({ ...template, status: "check", text: "The agent was asked to fill in the project's PR template", detail: "The template has no headings to compare, so check the PR text against it yourself." });
  else if (rules.template_headings.kept === rules.template_headings.total) rows.push({ ...template, status: "done", text: "Followed the project's PR template", detail: `All ${rules.template_headings.total} of its headings are in the PR text.` });
  else rows.push({ ...template, status: "check", text: `The PR text has ${rules.template_headings.kept} of the template's ${rules.template_headings.total} headings`, detail: "Compare the PR text with the project's template before publishing." });

  // Sign-off (DCO): `git commit --signoff` as the user when the profile asks.
  const dco = { id: "dco", label: "Sign-off (DCO)", term: "DCO" as const };
  // `signoff` is recorded on every preview; without a profile, false says nothing.
  if (p.signoff) rows.push({ ...dco, status: "done", text: "Required, added to your commit as you" });
  else rows.push(profile ? { ...dco, status: "none", text: "Not required" } : { ...dco, status: "unknown", text: NOT_RECORDED });

  // CLA: only the contributor can sign it.
  const cla = { id: "cla", label: "CLA", term: "CLA" as const };
  if (!profile) rows.push({ ...cla, status: "unknown", text: NOT_RECORDED });
  else rows.push(profile.cla
    ? { ...cla, status: "action", text: "Required: you must sign it yourself before maintainers can merge", detail: profile.cla }
    : { ...cla, status: "none", text: "No CLA found" });

  // AI policy: a ban is a blocker (lib/contrib-guard.ts aiBanReason); otherwise disclosure.
  const ai = { id: "ai", label: "AI policy" };
  const disclosed = rules ? rules.disclosed : p.body.includes(DISCLOSURE_LINE);
  if (!profile) rows.push({ ...ai, status: "unknown", text: NOT_RECORDED });
  else {
    const where = profile.aiPolicy.source ? `${profile.aiPolicy.source}${profile.aiPolicy.excerpt ? `: "${profile.aiPolicy.excerpt}"` : ""}` : undefined;
    const withWhere = where ? { detail: where } : {};
    if (profile.aiPolicy.stance === "ban") rows.push({ ...ai, status: "blocked", text: "Bans AI-generated contributions: publishing refused", ...withWhere });
    else if (profile.aiPolicy.stance === "disclose") rows.push(disclosed
      ? { ...ai, status: "done", text: "Asks contributors to disclose AI use: disclosure added", ...withWhere }
      : { ...ai, status: "check", text: "Asks contributors to disclose AI use, but disclosure is turned off for this organization", ...withWhere });
    else rows.push(disclosed
      ? { ...ai, status: "done", text: "No AI policy found: disclosure added anyway" }
      : { ...ai, status: "none", text: "No AI policy found; disclosure is turned off for this organization" });
  }

  // Discuss first. Older previews: a comment without ask_first meant "ask first".
  const discuss = { id: "discuss", label: "Discuss first" };
  const asksFirst = rules ? Boolean(rules.discuss_first) : p.ask_first ?? (p.draft_issue_comment ? true : undefined);
  if (asksFirst === undefined) rows.push({ ...discuss, status: "unknown", text: NOT_RECORDED });
  else if (asksFirst) rows.push(p.draft_issue_comment
    ? { ...discuss, status: "action", text: "Asks to discuss before a PR: a comment is drafted for you to post", ...(rules?.discuss_first ? { detail: `Why: ${rules.discuss_first}.` } : {}) }
    : { ...discuss, status: "check", text: "Asks to discuss before a PR", ...(rules?.discuss_first ? { detail: `Why: ${rules.discuss_first}.` } : {}) });

  // Someone else's work: the competing-PR check at run end (publish re-checks).
  const work = { id: "competing", label: "Someone else's work" };
  const found = p.blockers.find((b) => /already targets? this issue/.test(b));
  const competing = rules?.competing_prs ?? (found ? "found" : p.warnings.some((w) => /Could not check for other open PRs/.test(w)) ? "unchecked" : undefined);
  if (competing === "none") rows.push({ ...work, status: "done", text: "No other open pull request targets this issue" });
  else if (competing === "found") rows.push({ ...work, status: "blocked", text: "Another open pull request targets this issue: publishing refused", ...(found ? { detail: found } : {}) });
  else if (competing === "unchecked") rows.push({ ...work, status: "check", text: "Couldn't check for other open pull requests; publishing checks again" });
  else if (competing === "followup") rows.push({ ...work, status: "none", text: "This run updates your own pull request" });
  else if (competing === undefined) rows.push({ ...work, status: "unknown", text: `${NOT_RECORDED} Publishing checks it again.` });
  // "no_issue": a finding run has no issue to compete for; no row.

  // Tests: host-observed verification on the final patch (lib/verify.ts).
  const tests = { id: "tests", label: "Tests", term: "verified" as const };
  const v = p.executed ? p.verification : null;
  if (v?.status === "verified") rows.push({ ...tests, status: "done", text: "Ran the project's tests on the final patch (verified)",
    detail: v.regression === "reproduced" ? "The new test fails without the fix, so it reproduces the bug." : "No test in the patch fails without the fix, so the bug's reproduction is not shown." });
  else if (v?.status === "failed") rows.push({ ...tests, status: "blocked", text: "Tests failed on the final patch: publishing refused", detail: v.reason });
  else rows.push({ ...tests, status: "check", text: "Couldn't run tests: unverified", detail: !p.executed ? "The agent could not run code for this change." : v?.reason ?? "No passing test run was observed on the final patch." });

  return rows;
}

/** The rows as plain text, for the "Ask about this change" context. */
export function rulesText(rows: RuleRow[]): string {
  return rows.map((r) => `- ${r.label}: ${r.text} [${RULE_STATUS_LABEL[r.status]}]${r.detail ? ` (${r.detail})` : ""}`).join("\n");
}
