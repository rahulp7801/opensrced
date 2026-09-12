import { test } from "node:test";
import assert from "node:assert/strict";
import { findGitHubPullUrl, parseGitHubPullUrl } from "../github-pull-url";

test("GitHub pull request URLs are canonical and safe to render", () => {
  assert.deepEqual(parseGitHubPullUrl("https://github.com/acme/widget/pull/42"), {
    url: "https://github.com/acme/widget/pull/42",
    repoFull: "acme/widget",
    prNumber: 42,
  });
  for (const value of [
    "http://github.com/acme/widget/pull/42",
    "https://github.com.evil.test/acme/widget/pull/42",
    "https://github.com/acme/widget/pull/0",
    "https://github.com/acme/widget/pull/42/files",
    "https://user@github.com/acme/widget/pull/42",
    "https://github.com/acme/widget/pull/42?diff=split",
  ]) assert.equal(parseGitHubPullUrl(value), null);
});

test("pull request URLs are found in run output without trusting surrounding text", () => {
  assert.equal(findGitHubPullUrl("opened draft PR: https://github.com/acme/widget/pull/7\n")?.prNumber, 7);
  assert.equal(findGitHubPullUrl("opened: https://github.com/acme/widget/pull/7.evil"), null);
});
