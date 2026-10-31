import { test } from "node:test";
import assert from "node:assert/strict";
import type { TimelineEvent } from "../contrib-guard";
import { closingObjection, SPAM, spamSignals, type OpenedPr } from "../record/signals";

const pr = (repo: string, createdAt: string, merged = false): OpenedPr => ({ repo, createdAt, merged });

test("spamSignals: ratio and bursts at the thresholds", () => {
  assert.deepEqual(spamSignals([]), { opened: 0, merged: 0, mergedRatio: null, bursts: [] });
  const normal = [pr("a/x", "2026-10-01T10:00:00Z", true), pr("a/x", "2026-10-02T10:00:00Z"), pr("b/y", "2026-10-03T10:00:00Z", true), pr("b/y", "2026-10-03T11:00:00Z")];
  assert.deepEqual(spamSignals(normal), { opened: 4, merged: 2, mergedRatio: 0.5, bursts: [] });
  // Exactly the thresholds on one UTC day: a burst. One fewer PR or repo: none.
  const day = (prs: number, repos: number) => Array.from({ length: prs }, (_, i) => pr(`o/r${i % repos}`, `2026-10-05T${String(i % 24).padStart(2, "0")}:00:00Z`));
  assert.deepEqual(spamSignals(day(SPAM.burstPrs, SPAM.burstRepos)).bursts, [{ day: "2026-10-05", prs: SPAM.burstPrs, repos: SPAM.burstRepos }]);
  assert.deepEqual(spamSignals(day(SPAM.burstPrs - 1, SPAM.burstRepos)).bursts, []);
  assert.deepEqual(spamSignals(day(SPAM.burstPrs, SPAM.burstRepos - 1)).bursts, []);
  // Repos compare case-insensitively; a bad date is skipped, not a crash.
  assert.equal(spamSignals([pr("A/X", "2026-10-05T01:00:00Z"), pr("a/x", "2026-10-05T02:00:00Z"), pr("a/x", "not a date")]).opened, 3);
});

const comment = (body: string, author_association = "MEMBER"): TimelineEvent => ({ event: "commented", body, author_association, user: { login: "m" }, html_url: "u" });

test("closingObjection: a maintainer's AI or spam objection, quoted; others' comments and neutral closes are not", () => {
  assert.match(closingObjection([comment("Thanks. Happy to review a human-written PR!")])!, /human-written/);
  assert.equal(closingObjection([comment("Closing: this is spam.")]), "Closing: this is spam.");
  assert.equal(closingObjection([comment("Low-effort AI slop, sorry.")]), "Low-effort AI slop, sorry.");
  for (const events of [
    [], [comment("Closing as a duplicate of #12. Thanks!")], [comment("this is spam", "NONE")], [comment("this is spam", "CONTRIBUTOR")],
    [{ ...comment("spam"), event: "labeled" }],
  ]) assert.equal(closingObjection(events), null, JSON.stringify(events).slice(0, 80));
});
