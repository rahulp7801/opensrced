import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDraft, InvalidDraftError, parseDraft, type PrDraft } from "../pr-check";
import { profileFindings, summarizeProfile, type RepoProfile } from "../repo-profile";

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
  ["a draft far larger than usual", { additions: 400, deletions: 20 }, "size", /changes 420 lines; the \d+ merged outside PRs here change a median of 30\. Consider splitting it\. Test lines count too/],
  ["a large draft without tests", { additions: 400, deletions: 20, files: ["janitor/functions/fill.py"] }, "size", /Consider splitting it\.$/],
];
for (const [name, change, id, text] of MISSES) {
  test(`a draft with ${name} gets a warning that says why`, () => {
    const warning = checkDraft(profile(), { ...GOOD, ...change }).find((c) => c.id === id);
    assert.equal(warning?.status, "warn");
    assert.match(warning.text, text);
  });
}

test("a repository where only collaborators open PRs says so before anything else", () => {
  const closed = checkDraft(profile((p) => { p.status = { pullRequestsEnabled: true, collaboratorsOnly: true, archived: false, mirror: false, elsewhere: null }; }), GOOD);
  assert.deepEqual([closed[0].id, closed[0].status], ["pr-creation", "warn"]);
  assert.match(closed[0].text, /GitHub won't let you open this one\. Offer the branch on the issue/);
  assert.ok(!checkDraft(profile(), GOOD).some((c) => c.id === "pr-creation"));
});

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

test("a docs-only draft isn't asked for tests (pyjanitor #750's dry run)", () => {
  const docs = { ...GOOD, title: "[DOC] Describe the real PR docs preview", files: [".github/pull_request_template.md", "mkdocs/devguide.md", "CHANGELOG.md"] };
  assert.equal(checkDraft(profile(), docs).find((c) => c.id === "tests"), undefined);
  assert.equal(checkDraft(profile(), { ...GOOD, files: ["janitor/functions/fill.py", "CHANGELOG.md"] }).find((c) => c.id === "tests")?.status, "warn", "code still is");
});

test("with too little history, check_pr says so instead of returning nothing (nbQA, earthpy)", () => {
  const quiet = summarizeProfile("acme/quiet", []);
  quiet.aiPolicy = { stance: "allowed", source: "CONTRIBUTING.md", evidence: "AI welcome." };
  const checks = checkDraft(quiet, GOOD);
  const note = checks.find((c) => c.id === "too-little-history");
  assert.equal(note?.status, "note");
  assert.match(note.text, /^Too few merged PRs here to compare this draft with \(0 merged outside PRs in the window\)/);
});

test("with no history to go on, a code draft without a test or an issue link still gets a note for each (itsdangerous: 0 merged outside PRs)", () => {
  const quiet = summarizeProfile("acme/quiet", []);
  const bare = checkDraft(quiet, { ...GOOD, title: "fixed stuff", body: "small fix", files: ["src/acme/serializer.py"], linkedIssue: false });
  assert.deepEqual(["no-tests", "no-issue-link", "too-little-history"].map((id) => bare.find((c) => c.id === id)?.status), ["note", "note", "note"]);
  const tidy = checkDraft(quiet, { ...GOOD, files: ["src/acme/serializer.py", "tests/test_serializer.py"], linkedIssue: true });
  assert.equal(tidy.find((c) => c.id === "no-tests" || c.id === "no-issue-link"), undefined, "a draft with both gets neither");
  // Rust: the test may be in the changed file itself.
  const rust = checkDraft(quiet, { ...GOOD, files: ["ratatui-core/src/buffer/buffer.rs"], linkedIssue: true });
  assert.match(rust.find((c) => c.id === "no-tests")?.text ?? "", /^The draft changes no test files\. Rust tests can sit in the changed file itself/);
  const docs = checkDraft(quiet, { ...GOOD, title: "[DOC] fix a typo", files: ["docs/index.rst"], linkedIssue: true });
  assert.equal(docs.find((c) => c.id === "no-tests"), undefined, "docs have no test to add");
  // Where the project's own habit already judged tests or the link, no second, softer note.
  const judged = checkDraft(profile(), { ...GOOD, files: ["janitor/functions/fill.py"], linkedIssue: false });
  assert.equal(judged.find((c) => c.id === "no-tests" || c.id === "no-issue-link"), undefined);
  assert.equal(judged.find((c) => c.id === "tests")?.status, "warn");
  // Where test files are the habit, a Rust draft without one is still warned (uutils: "No tests, no merge").
  const rustJudged = checkDraft(profile(), { ...GOOD, files: ["src/uu/date/src/date.rs"], linkedIssue: true }).find((c) => c.id === "tests");
  assert.equal(rustJudged?.status, "warn");
});

test("a CLA the project asks for is a note in check_pr and a start finding in the profile (redis)", () => {
  const base = profile();
  const p = { ...base, aiPolicy: { stance: "unknown" as const, source: null, evidence: null, cla: { path: "CONTRIBUTING.md", text: "Only contributions made under the Redis CLA may be accepted." } } };
  const cla = checkDraft(p, GOOD).find((c) => c.id === "cla");
  assert.equal(cla?.status, "note");
  assert.match(cla?.text ?? "", /^The project's CONTRIBUTING\.md asks contributors to sign a Contributor License Agreement: the PR can't be merged until the user has signed it/);
  assert.ok(profileFindings(p).some((f) => f.section === "start" && f.text.startsWith("The project's CONTRIBUTING.md asks contributors to sign a Contributor License Agreement before a PR can be merged")));
  assert.equal(checkDraft(base, GOOD).find((c) => c.id === "cla"), undefined, "no CLA, no note");
});

test("a written procedure warns even without PR history (earthpy: approval before a PR)", () => {
  const quiet = summarizeProfile("acme/quiet", []);
  quiet.aiPolicy = { stance: "unknown", source: null, evidence: null, procedures: [
    { kind: "approval", path: ".github/PULL_REQUEST_TEMPLATE.md", text: "Only submit a PR after getting approval from one of the maintainers." },
  ] };
  const warning = checkDraft(quiet, GOOD).find((c) => c.id === "discussed");
  assert.equal(warning?.status, "warn");
  assert.match(warning.text, /^The project's \.github\/PULL_REQUEST_TEMPLATE\.md asks for a maintainer's approval before a pull request\./);
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
