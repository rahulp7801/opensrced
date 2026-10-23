import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aiBanReason, competingPrReason, discussFirstReason, draftIssueComment, openPrsFromTimeline, prCaps, publishedInLastDay, type TimelineEvent,
} from "../contrib-guard";

test("openPrsFromTimeline: recorded facebook/react#37837 timeline has 4 competing open PRs", () => {
  const events = JSON.parse(readFileSync(path.join(process.cwd(), "lib/__tests__/fixtures/react-37837-timeline.json"), "utf8")) as TimelineEvent[];
  const prs = openPrsFromTimeline(events);
  assert.deepEqual(prs.map((p) => p.number).sort(), [37838, 37858, 37877, 37880]);
  assert.match(competingPrReason(prs)!, /^4 open pull requests already target this issue/);
});

test("openPrsFromTimeline ignores closed PRs, issues and non-references", () => {
  const events: TimelineEvent[] = [
    { event: "cross-referenced", source: { issue: { number: 1, state: "closed", pull_request: {} } } },
    { event: "cross-referenced", source: { issue: { number: 2, state: "open" } } },
    { event: "commented" },
    { event: "cross-referenced", source: { issue: { number: 3, state: "open", pull_request: {}, html_url: "u3" } } },
    { event: "cross-referenced", source: { issue: { number: 3, state: "open", pull_request: {}, html_url: "u3" } } },
  ];
  assert.deepEqual(openPrsFromTimeline(events), [{ number: 3, url: "u3", author: null }]);
  assert.equal(openPrsFromTimeline([]).length, 0);
  assert.equal(competingPrReason([]), null);
});

test("discussFirstReason: labels and contribution-guide wording", () => {
  assert.match(discussFirstReason("", ["bug", "Needs Discussion"])!, /labeled "Needs Discussion"/);
  assert.match(discussFirstReason("Please open an issue first and wait to be assigned.", [])!, /discuss or get assigned/);
  assert.match(discussFirstReason("Changes should be discussed in an issue before you start work.", [])!, /discuss/);
  assert.equal(discussFirstReason("Run the tests before sending a PR.", ["bug", "good first issue"]), null);
});

test("caps: defaults, overrides, and the 24h window", () => {
  const saved = { a: process.env.OPENSRCER_PRS_PER_REPO, b: process.env.OPENSRCER_DAILY_PR_CAP };
  try {
    delete process.env.OPENSRCER_PRS_PER_REPO; delete process.env.OPENSRCER_DAILY_PR_CAP;
    assert.deepEqual(prCaps(), { perRepo: 1, daily: 3 });
    process.env.OPENSRCER_DAILY_PR_CAP = "0"; process.env.OPENSRCER_PRS_PER_REPO = "-2";
    assert.deepEqual(prCaps(), { perRepo: 1, daily: 0 });
  } finally {
    for (const [k, v] of [["OPENSRCER_PRS_PER_REPO", saved.a], ["OPENSRCER_DAILY_PR_CAP", saved.b]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(publishedInLastDay(["2026-10-23T01:00:00Z", "2026-10-22T11:00:00Z", undefined, "2026-10-22T13:00:00Z"], now), 2);
});

test("aiBanReason and the drafted issue comment", () => {
  assert.equal(aiBanReason({ aiPolicy: { stance: "disclose", source: "x", excerpt: "y" } }), null);
  assert.match(aiBanReason({ aiPolicy: { stance: "ban", source: "AI_POLICY.md", excerpt: "We do not accept AI-generated code." } })!, /AI_POLICY\.md/);
  const comment = draftIssueComment("The parser drops the exponent.", true);
  assert.match(comment, /The parser drops the exponent\./);
  assert.match(comment, /Would a PR along these lines be welcome/);
  assert.match(comment, /AI assistance/);
  assert.match(draftIssueComment(null, false), /have not been able to run the tests/);
});
