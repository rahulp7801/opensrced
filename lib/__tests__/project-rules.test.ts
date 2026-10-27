import { test } from "node:test";
import assert from "node:assert/strict";
import { projectRules, rulesText, RULE_STATUS_LABEL, type RulesPreview } from "../project-rules";
import { buildPreview, templateHeadings, type PreviewRules } from "../pr-preview";
import type { ContribProfile } from "../contrib-profile";
import type { Verification } from "../verify";

const verified: Verification = { status: "verified", reason: "1 test command passed", plan: { setup: [], test: ["pytest"], lint: [] }, regression: "reproduced", evidence: [] };

const rules = (over: Partial<PreviewRules> = {}): PreviewRules => ({
  pr_template: false, template_headings: null, agent_instructions: false, notes: 0, discuss_first: null, competing_prs: "none", disclosed: true, ...over,
});

const base = (over: Partial<RulesPreview> = {}): RulesPreview => ({
  profile: { dco: false, cla: null, aiPolicy: { stance: "unknown", source: null, excerpt: null }, aiTrailer: null, sources: ["CONTRIBUTING.md"] },
  signoff: false, executed: true, verification: verified, blockers: [], warnings: [], body: "Fixes #1", rules: rules(), ...over,
});

const row = (p: RulesPreview, id: string) => projectRules(p).find((r) => r.id === id);

test("each rule maps to its row text and status", () => {
  const cases: Array<[string, RulesPreview, string, string | undefined, string?]> = [
    ["guide", base({ profile: { ...base().profile!, sources: ["CONTRIBUTING.md", "AGENTS.md", ".github/pull_request_template.md"] } }), "Read CONTRIBUTING.md, AGENTS.md and .github/pull_request_template.md", "done"],
    ["guide", base({ profile: { ...base().profile!, sources: [] } }), "No contribution guide found", "check"],
    ["template", base(), "This project has no PR template", "none"],
    ["template", base({ rules: rules({ pr_template: true, template_headings: { total: 3, kept: 3 } }) }), "Followed the project's PR template", "done", "All 3 of its headings are in the PR text."],
    ["template", base({ rules: rules({ pr_template: true, template_headings: { total: 3, kept: 1 } }) }), "The PR text has 1 of the template's 3 headings", "check"],
    ["template", base({ rules: rules({ pr_template: true, template_headings: null }) }), "The agent was asked to fill in the project's PR template", "check"],
    ["dco", base({ signoff: true, profile: { ...base().profile!, dco: true } }), "Required, added to your commit as you", "done"],
    ["dco", base(), "Not required", "none"],
    ["cla", base({ profile: { ...base().profile!, cla: "Sign the Meta CLA at https://code.facebook.com/cla." } }), "Required: you must sign it yourself before maintainers can merge", "action", "Sign the Meta CLA at https://code.facebook.com/cla."],
    ["cla", base(), "No CLA found", "none"],
    ["ai", base({ profile: { ...base().profile!, aiPolicy: { stance: "disclose", source: "CONTRIBUTING.md", excerpt: "Disclose AI use." } } }), "Asks contributors to disclose AI use: disclosure added", "done", 'CONTRIBUTING.md: "Disclose AI use."'],
    ["ai", base({ profile: { ...base().profile!, aiPolicy: { stance: "ban", source: "AI_POLICY.md", excerpt: "We do not accept AI-generated PRs." } } }), "Bans AI-generated contributions: no code is written", "blocked"],
    ["ai", base({ profile: { ...base().profile!, aiPolicy: { stance: "welcome", source: "docs/contributing.md", excerpt: "We welcome the use of AI when contributing to Pydantic." } } }), "Welcomes AI-assisted contributions: disclosure added", "done", 'docs/contributing.md: "We welcome the use of AI when contributing to Pydantic."'],
    ["ai", base(), "No AI policy found: disclosure added anyway", "done"],
    ["ai", base({ rules: rules({ disclosed: false }) }), "No AI policy found; disclosure is turned off for this organization", "none"],
    ["discuss", base({ draft_issue_comment: "Hi", rules: rules({ discuss_first: 'the issue is labeled "needs discussion"' }) }), "Asks to discuss before a PR: a comment is drafted for you to post", "action", 'Why: the issue is labeled "needs discussion".'],
    ["competing", base(), "No other open pull request targets this issue", "done"],
    ["competing", base({ rules: rules({ competing_prs: "found" }), blockers: ["1 open pull request already targets this issue (https://github.com/o/r/pull/2)."] }), "Another open pull request targets this issue: publishing refused", "blocked", "1 open pull request already targets this issue (https://github.com/o/r/pull/2)."],
    ["competing", base({ rules: rules({ competing_prs: "unchecked" }) }), "Couldn't check for other open pull requests; publishing checks again", "check"],
    ["competing", base({ rules: rules({ competing_prs: "followup" }) }), "This run updates your own pull request", "none"],
    ["tests", base(), "Ran the project's tests on the final patch (verified)", "done", "The new test fails without the fix, so it reproduces the bug."],
    ["tests", base({ verification: { ...verified, status: "unverified", reason: "no test command declared" } }), "Couldn't run tests: unverified", "check", "no test command declared"],
    ["tests", base({ executed: false, verification: null }), "Couldn't run tests: unverified", "check", "The agent could not run code for this change."],
    ["tests", base({ verification: { ...verified, status: "failed", reason: "pytest exited 1" } }), "Tests failed on the final patch: publishing refused", "blocked", "pytest exited 1"],
  ];
  for (const [id, preview, text, status, detail] of cases) {
    const r = row(preview, id);
    assert.ok(r, `${id}: row present`);
    assert.equal(r.text, text, `${id}`);
    assert.equal(r.status, status, `${id}: ${text}`);
    if (detail !== undefined) assert.equal(r.detail, detail, `${id} detail`);
  }
});

test("rows without a rule are left out: no discuss-first rule, no issue to compete for", () => {
  assert.equal(row(base(), "discuss"), undefined);
  assert.equal(row(base({ rules: rules({ competing_prs: "no_issue" }) }), "competing"), undefined);
});

test("an older preview without rules never claims a rule was followed", () => {
  // Shape of a preview stored before `rules` existed (no profile on a finding run).
  const old: RulesPreview = { profile: null, signoff: false, executed: false, verification: null, blockers: [], warnings: [], body: "Fixes #1" };
  const rows = projectRules(old);
  for (const id of ["guide", "template", "dco", "cla", "ai", "discuss", "competing"]) {
    assert.equal(rows.find((r) => r.id === id)?.status, "unknown", `${id} is not recorded`);
  }
  assert.match(rows.find((r) => r.id === "competing")!.text, /Not recorded for this run\. Publishing checks it again\./);
  assert.equal(rows.every((r) => r.status !== "done"), true, "nothing is marked done");
});

test("an older preview with a profile falls back to what it did record", () => {
  const old: RulesPreview = { ...base({ signoff: true, profile: { ...base().profile!, dco: true } }), rules: undefined, ask_first: true, draft_issue_comment: "Hi",
    body: "Fixes #1\n\n### AI assistance\n\nThis change was drafted with [opensrcer](https://github.com/rahulp7801/opensrced), an AI coding tool." };
  assert.equal(row(old, "template")?.status, "unknown");
  assert.equal(row(old, "dco")?.text, "Required, added to your commit as you");
  assert.equal(row(old, "ai")?.text, "No AI policy found: disclosure added anyway", "disclosure read from the host's own line");
  assert.equal(row(old, "discuss")?.status, "action");
  assert.equal(row({ ...old, draft_issue_comment: undefined, ask_first: undefined }, "discuss")?.status, "unknown");
  assert.equal(row({ ...old, ask_first: false }, "discuss"), undefined, "ask_first=false recorded no discuss rule");
  assert.equal(row({ ...old, blockers: ["2 open pull requests already target this issue (a, b)."] }, "competing")?.status, "blocked");
  assert.equal(row({ ...old, warnings: ["Could not check for other open PRs on this issue; publishing re-checks it."] }, "competing")?.status, "check");
  assert.equal(row({ ...old, body: "Fixes #1" }, "ai")?.status, "none", "no host disclosure line, no claim");
});

test("every status has a visible label, and the text form carries it", () => {
  const rows = projectRules(base({ profile: { ...base().profile!, cla: "Sign it." } }));
  for (const r of rows) assert.ok(RULE_STATUS_LABEL[r.status]);
  assert.match(rulesText(rows), /- CLA: Required: you must sign it yourself before maintainers can merge \[Your action\] \(Sign it\.\)/);
});

const profile = (over: Partial<ContribProfile> = {}): ContribProfile => ({
  repo: "o/r", dco: false, cla: null, prTemplate: null, agentInstructions: null, aiPolicy: { stance: "unknown", source: null, excerpt: null }, aiTrailer: null, notes: [], discussFirst: null, sources: [], ...over,
});

test("buildPreview records the rules the panel shows", () => {
  const template = "<!-- # Not a heading -->\n## Summary\n\n## How did you test this change?\n";
  const preview = buildPreview({ title: "fix", body: "## Summary\nx\n\n## How did you test this change?\npytest", diff: "", profile: profile({ prTemplate: template, agentInstructions: "be nice", notes: ["a", "b"] }),
    verification: null, executed: false, model: "m", provider: "Anthropic", privateOrg: false, discussFirst: "asks first", competingPrs: "unchecked", diagnosis: "  The cause.  " });
  assert.deepEqual(preview.rules, { pr_template: true, template_headings: { total: 2, kept: 2 }, agent_instructions: true, notes: 2, discuss_first: "asks first", competing_prs: "unchecked", disclosed: true });
  assert.equal(preview.diagnosis, "The cause.");
  const partial = buildPreview({ title: "fix", body: "Summary: x", diff: "", profile: profile({ prTemplate: template }), verification: null, executed: false, model: "m", provider: "Anthropic", privateOrg: false });
  assert.deepEqual(partial.rules?.template_headings, { total: 2, kept: 0 }, "a heading word in prose is not the heading");
  assert.equal(partial.rules?.competing_prs, "no_issue");
  assert.equal(partial.diagnosis, undefined);
  const none = buildPreview({ title: "fix", body: "b", diff: "", profile: null, verification: null, executed: false, model: "m", provider: "Anthropic", privateOrg: false });
  assert.deepEqual(none.rules, { pr_template: false, template_headings: null, agent_instructions: false, notes: 0, discuss_first: null, competing_prs: "no_issue", disclosed: true });
});

test("templateHeadings skips HTML comments and empty input", () => {
  assert.deepEqual(templateHeadings(""), []);
  assert.deepEqual(templateHeadings("<!--\n## Hidden\n-->\n### Summary ###\ntext\n#nospace"), ["Summary"]);
});
