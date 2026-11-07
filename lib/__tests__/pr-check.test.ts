import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDraft, InvalidDraftError, parseDraft, type PrDraft } from "../pr-check";
import { summarizeProfile, type RepoProfile } from "../repo-profile";

const tally = (count: number, of: number) => ({ count, of, examples: [`https://github.com/acme/app/pull/${count}`] });

/** A profile where merged outside PRs link issues, change tests and add changelog entries. */
function profile(overrides: (p: RepoProfile) => void = () => {}): RepoProfile {
  const p = summarizeProfile("acme/app", []);
  p.outside.merged = tally(10, 20);
  p.outside.linkedMerged = tally(8, 10);
  p.outside.testsMerged = tally(9, 10);
  p.outside.medianLinesMerged = 30;
  p.conventions = { ...p.conventions, title: "bracket", changelogPath: "CHANGELOG.md", changelogTally: tally(7, 10), signOffShare: 0.9, titleTally: tally(8, 10) };
  p.aiPolicy = { stance: "unknown", source: null, evidence: null };
  overrides(p);
  return p;
}

const GOOD: PrDraft = {
  title: "[ENH] Add a fill method", body: "Fixes #12. Written with help from Claude; I reviewed every line.",
  files: ["janitor/functions/fill.py", "tests/functions/test_fill.py", "CHANGELOG.md"], additions: 40, deletions: 5, linkedIssue: true, signedOff: true,
};

test("a draft that follows every norm has no warnings", () => {
  const checks = checkDraft(profile(), GOOD);
  assert.deepEqual(checks.filter((c) => c.status === "warn"), []);
  assert.deepEqual(checks.map((c) => c.id).sort(), ["changelog", "linked-issue", "sign-off", "tests", "title"].sort());
});

const MISSES: Array<[string, Partial<PrDraft>, string, RegExp]> = [
  ["no linked issue", { linkedIssue: false, body: "Adds fill. AI-assisted." }, "linked-issue", /80% of merged outside PRs here link an issue/],
  ["no tests", { files: ["janitor/functions/fill.py", "CHANGELOG.md"] }, "tests", /90% of merged outside PRs here change tests; this draft changes none/],
  ["no changelog entry", { files: ["janitor/functions/fill.py", "tests/test_fill.py"] }, "changelog", /7 of 10 merged PRs here added a changelog entry, in CHANGELOG\.md/],
  ["the wrong title style", { title: "Add a fill method" }, "title", /a tag in brackets/],
  ["unsigned commits", { signedOff: false }, "sign-off", /git commit -s/],
  ["a draft far larger than usual", { additions: 400, deletions: 20 }, "size", /changes 420 lines; merged outside PRs here change a median of 30/],
];
for (const [name, change, id, text] of MISSES) {
  test(`a draft with ${name} gets a warning that says why`, () => {
    const warning = checkDraft(profile(), { ...GOOD, ...change }).find((c) => c.id === id);
    assert.equal(warning?.status, "warn");
    assert.match(warning.text, text);
  });
}

test("the project's AI rules come first: a ban, a missing disclosure, assignment first", () => {
  const banned = checkDraft(profile((p) => { p.aiPolicy = { stance: "banned", source: "CONTRIBUTING.md", evidence: "No AI." }; }), GOOD);
  assert.equal(banned[0].id, "ai-policy");
  assert.match(banned[0].text, /does not accept AI-generated contributions \(CONTRIBUTING\.md\)/);

  const disclose = profile((p) => { p.aiPolicy = { stance: "disclosure-required", source: "AGENTS.md", evidence: "disclose" }; });
  assert.equal(checkDraft(disclose, { ...GOOD, body: "Fixes #12." }).find((c) => c.id === "ai-disclosure")?.status, "warn");
  assert.equal(checkDraft(disclose, GOOD).find((c) => c.id === "ai-disclosure")?.status, "ok");

  const assigned = checkDraft(profile((p) => { p.closeReasons = [{ reason: "not_assigned", count: 19, of: 29, examples: [] }]; }), GOOD);
  assert.match(assigned.find((c) => c.id === "assigned")!.text, /19 of 29 recently closed outside PRs/);
  assert.equal(assigned[0].status, "warn", "warnings sort first");
});

test("norms most merged PRs don't follow, or that rest on too few PRs, are not enforced", () => {
  const rare = profile((p) => {
    p.conventions.changelogTally = tally(3, 52); // pydantic: release PRs only
    p.outside.linkedMerged = tally(1, 14);
    p.outside.testsMerged = tally(2, 3); // below MIN_SAMPLE
    p.conventions.title = "none";
  });
  const checks = checkDraft(rare, { ...GOOD, files: ["src/a.py"], linkedIssue: false });
  assert.equal(checks.find((c) => c.id === "changelog")?.status, "note");
  for (const id of ["linked-issue", "tests", "title"]) assert.equal(checks.find((c) => c.id === id), undefined, id);
  assert.equal(checkDraft(profile(), { ...GOOD, signedOff: undefined }).find((c) => c.id === "sign-off"), undefined, "unknown sign-off is not judged");
});

const BAD_DRAFTS: Array<[string, unknown]> = [
  ["nothing", undefined],
  ["no title", { ...GOOD, title: "  " }],
  ["a non-string body", { ...GOOD, body: 3 }],
  ["files that aren't a list", { ...GOOD, files: "a.py" }],
  ["an empty path", { ...GOOD, files: [""] }],
  ["negative line counts", { ...GOOD, additions: -1 }],
  ["fractional line counts", { ...GOOD, deletions: 1.5 }],
  ["linkedIssue missing", { ...GOOD, linkedIssue: undefined }],
  ["signedOff not a boolean", { ...GOOD, signedOff: "yes" }],
];
for (const [name, input] of BAD_DRAFTS) {
  test(`parseDraft refuses ${name}`, () => {
    assert.throws(() => parseDraft(input), InvalidDraftError);
  });
}

test("parseDraft keeps a valid draft, trims the title and caps the description", () => {
  const draft = parseDraft({ ...GOOD, title: "  [ENH] x  ", body: "b".repeat(70_000), signedOff: undefined });
  assert.equal(draft.title, "[ENH] x");
  assert.equal(draft.body.length, 65_000);
  assert.equal("signedOff" in draft, false);
});
