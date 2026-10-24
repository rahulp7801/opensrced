import { test } from "node:test";
import assert from "node:assert/strict";
import { AFTER_PUBLISH, paymentSummary, publishSteps } from "../beginner-guide";

test("a new PR: fork, branch, draft from your account with the AI note, nothing merged", () => {
  const steps = publishSteps({ files: 2, signoff: false });
  assert.equal(steps.length, 4);
  assert.match(steps[0], /fork/);
  assert.match(steps[1], /2 files/);
  assert.doesNotMatch(steps.join(" "), /signed off/, "no sign-off claim when the project does not ask");
  assert.match(steps[2], /draft pull request from your account/);
  assert.match(steps[2], /AI disclosure/);
  assert.match(steps[3], /Nothing is merged/);
});

test("sign-off is mentioned only when the project asks for it; one file is singular", () => {
  const steps = publishSteps({ files: 1, signoff: true });
  assert.match(steps[1], /\(1 file\) as one commit/);
  assert.match(steps[1], /signed off as the project asks/);
});

test("a follow-up adds one commit to the existing PR and posts no comment", () => {
  const steps = publishSteps({ files: 3, signoff: true, followupPr: "https://github.com/a/b/pull/1" });
  assert.equal(steps.length, 2);
  assert.match(steps[0], /one new commit to your pull request, signed off/);
  assert.match(steps[1], /No comment is posted/);
  assert.doesNotMatch(steps.join(" "), /fork/);
});

for (const files of [-1, 1.5, Number.NaN]) {
  test(`publishSteps rejects files=${files}`, () => {
    assert.throws(() => publishSteps({ files, signoff: false }), RangeError);
  });
}

test("publishSteps accepts an empty patch count without inventing files", () => {
  assert.match(publishSteps({ files: 0, signoff: false })[1], /\(0 files\)/);
});

test("after-publish guidance covers the draft, waiting, not pinging, reviews, follow-ups", () => {
  const text = AFTER_PUBLISH.map((s) => `${s.title} ${s.body}`).join(" ");
  for (const needle of [/Ready for review/, /few days/, /@-mention/, /review comment/, /follow-ups/]) assert.match(text, needle);
});

test("hosted: only an API key is offered, so no subscription is promised; the cap is shown", () => {
  const text = paymentSummary({ offered: ["anthropic-key"], maxSpendUsd: 2 });
  assert.match(text, /Anthropic API key/);
  assert.match(text, /stops at \$2\.00/);
  assert.doesNotMatch(text, /subscription/);
  assert.match(text, /free/);
});

for (const [offered, plans] of [
  [["claude-subscription", "anthropic-key"], "Claude"],
  [["codex-subscription", "anthropic-key"], "ChatGPT"],
  [["claude-subscription", "codex-subscription", "anthropic-key"], "Claude or ChatGPT"],
] as const) {
  test(`local: ${offered.join("+")} names the ${plans} subscription`, () => {
    const text = paymentSummary({ offered: [...offered], maxSpendUsd: 0.5 });
    assert.match(text, new RegExp(`the ${plans} subscription`));
    assert.match(text, /\$0\.50/);
  });
}

for (const maxSpendUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`paymentSummary rejects maxSpendUsd=${maxSpendUsd}`, () => {
    assert.throws(() => paymentSummary({ offered: [], maxSpendUsd }), RangeError);
  });
}
