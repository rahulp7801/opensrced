import { test } from "node:test";
import assert from "node:assert/strict";
import { notReadyLabel } from "../issues";

// Real label names from pandas, VS Code, React, numpy, Next.js, pydantic and CPython (lowercased, as scoreIssue sees them).
const notReady: Array<[string, RegExp]> = [
  ["needs triage", /triage/], ["needs-triage", /triage/], ["pending", /triage/], ["triage-needed", /triage/], ["status: unconfirmed", /triage/], ["type: needs investigation", /triage/],
  ["needs info", /information/], ["~info-needed", /information/], ["resolution: needs more information", /information/], ["repro-steps-needed", /information/],
  ["please add a complete reproduction", /information/], ["*not-reproducible", /information/], ["awaiting author response", /information/],
  ["needs discussion", /discussed/], ["54 - needs decision", /discussed/], ["under-discussion", /discussed/], ["type: discussion", /discussed/],
  ["blocked", /Blocked/], ["wontfix", /non-actionable/], ["duplicate", /non-actionable/], ["invalid", /non-actionable/],
];
for (const [label, reason] of notReady) {
  test(`"${label}" is not ready`, () => assert.match(notReadyLabel([label]) ?? "", reason));
}

test("labels that mean ready, or are about pull requests, pass", () => {
  for (const label of ["triaged", "ai-triaged", "needs tests", "needs backport to 3.13", "awaiting review", "good first issue", "bug", "54 - needs work", "56 - needs release note.", ""]) {
    assert.equal(notReadyLabel([label]), null, label);
  }
  assert.equal(notReadyLabel([]), null);
});

test("the first not-ready label found wins, regardless of the other labels", () => {
  assert.match(notReadyLabel(["bug", "good first issue", "needs triage"]) ?? "", /triage/);
});
