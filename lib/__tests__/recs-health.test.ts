import { test } from "node:test";
import assert from "node:assert/strict";
import { firstMaintainerResponseHours, isMaintainer, median, repoHealth, responsiveness, type PrRecord } from "../recs/health";

const at = (hours: number) => new Date(Date.UTC(2026, 9, 1) + hours * 3_600_000).toISOString();
const event = (hours: number, authorAssociation: string, login = "maint") => ({ createdAt: at(hours), authorAssociation, author: { login } });

test("isMaintainer: owners, members and collaborators only", () => {
  for (const yes of ["OWNER", "MEMBER", "COLLABORATOR"]) assert.equal(isMaintainer(yes), true);
  for (const no of ["CONTRIBUTOR", "NONE", "FIRST_TIME_CONTRIBUTOR", "", null, undefined]) assert.equal(isMaintainer(no), false);
});

test("firstMaintainerResponseHours: the first maintainer who isn't the author or a bot", () => {
  const events = [event(1, "NONE", "rando"), event(2, "MEMBER", "dependabot[bot]"), event(3, "MEMBER", "author"), event(5, "COLLABORATOR"), event(4, "OWNER")];
  assert.equal(firstMaintainerResponseHours(at(0), "author", events), 4);
  assert.equal(firstMaintainerResponseHours(at(0), "author", [event(1, "NONE")]), null);
  assert.equal(firstMaintainerResponseHours(at(0), "author", []), null);
  // A comment timestamped before the issue (clock skew, imports) is ignored.
  assert.equal(firstMaintainerResponseHours(at(10), "author", [event(1, "OWNER")]), null);
  assert.throws(() => firstMaintainerResponseHours("not a date", "a", []), /Invalid createdAt/);
});

test("median: odd, even, empty", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

const pr = (state: PrRecord["state"], authorAssociation: string, responseHours: number | null, mergedHoursAgo?: number, login = "dev"): PrRecord => ({
  createdAt: at(0), state, authorAssociation, author: { login }, responseHours,
  mergedAt: mergedHoursAgo === undefined ? null : new Date(Date.UTC(2026, 9, 11) - mergedHoursAgo * 3_600_000).toISOString(),
});

test("repoHealth: medians, outsider merge rate and days since the last merge", () => {
  const now = new Date(Date.UTC(2026, 9, 11));
  const health = repoHealth([2, 10, 30], [
    pr("MERGED", "CONTRIBUTOR", 4, 48),
    pr("CLOSED", "NONE", 8),
    pr("OPEN", "FIRST_TIME_CONTRIBUTOR", null),
    pr("MERGED", "MEMBER", 1, 24), // a maintainer's own PR: counts for "last merge" only
    pr("CLOSED", "NONE", 1, undefined, "renovate[bot]"),
  ], now);
  assert.equal(health.issueResponseHours, 10);
  assert.equal(health.prResponseHours, 6);
  assert.equal(health.outsiderMergeRate, 0.5);
  assert.equal(health.daysSinceLastMerge, 1);
  assert.deepEqual(health.sample, { issues: 3, prs: 5, outsiderPrs: 3 });
  assert.equal(health.computedAt, now.toISOString());
});

test("repoHealth: no data gives nulls, not zeros", () => {
  const health = repoHealth([], []);
  assert.deepEqual([health.issueResponseHours, health.prResponseHours, health.outsiderMergeRate, health.daysSinceLastMerge], [null, null, null, null]);
});

test("responsiveness: fast scores 1, slow 0, linear between, unknown neutral, stale repos 0", () => {
  assert.equal(responsiveness({ issueResponseHours: 5, prResponseHours: 70 }), 1);
  assert.equal(responsiveness({ issueResponseHours: 24 * 30 }), 0);
  const mid = responsiveness({ prResponseHours: (72 + 24 * 14) / 2 });
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
  // The slower of the two medians decides.
  assert.equal(responsiveness({ issueResponseHours: 1, prResponseHours: 24 * 30 }), 0);
  for (const unknown of [null, undefined, {}]) assert.equal(responsiveness(unknown), 0.5);
  assert.equal(responsiveness({ issueResponseHours: 1, daysSinceLastMerge: 400 }), 0);
});
