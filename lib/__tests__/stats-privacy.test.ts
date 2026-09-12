import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("activity excludes other users and preserves simultaneous scan counters", async () => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-stats-"));
  process.chdir(root);
  try {
    const stats = await import("../stats");
    mkdirSync(".dispatches");
    for (const [id, owner, repo, status] of [
      ["own", "alice", "alice/project", "succeeded"],
      ["own-failed", "alice", "alice/other", "failed"],
      ["private", "bob", "private-org/secret", "failed"],
    ]) {
      writeFileSync(`.dispatches/${id}.json`, JSON.stringify({ id, auth0_user_id: owner }));
      writeFileSync(`.dispatches/${id}.log`, `[agentic-dispatcher] 2026-09-11T00:00:00Z repo: ${repo} issue: 1\n\`\`\`diff\n+change\n\`\`\`\nexited at 2026-09-11T00:01:00Z · status=${status}\n`);
    }
    await Promise.all(Array.from({ length: 20 }, () => stats.recordScan("alice/project", "alice")));
    await stats.recordScan("private-org/secret", "bob");
    const summary = await stats.getStatsSummary("alice");
    assert.equal(summary.scans, 20);
    assert.equal(summary.dispatches, 2);
    assert.equal(summary.patchesGenerated, 2);
    assert.equal(summary.successRate, 0.5);
    assert.ok(!JSON.stringify(summary).includes("private-org"));
    const cached = JSON.parse(readFileSync(".dispatches/own.json", "utf8"));
    assert.deepEqual(cached.stats, { cost_usd: null, has_diff: true });
    writeFileSync(".dispatches/own.log", "corrupted after the aggregate was cached");
    assert.equal((await stats.getStatsSummary("alice")).patchesGenerated, 2);
    assert.equal((await stats.getStatsSummary("bob")).scans, 1);
    assert.equal((await stats.getStatsSummary("unknown")).dispatches, 0);
    const { loadPRsFromLogs } = await import("../pr-loader");
    for (const [id, owner, repo] of [["own", "alice", "alice/project"], ["private", "bob", "private-org/secret"]]) {
      writeFileSync(`.dispatches/${id}.json`, JSON.stringify({ id, auth0_user_id: owner, pr_url: `https://github.com/${repo}/pull/1` }));
    }
    const prs = await loadPRsFromLogs("alice");
    assert.equal(prs.length, 1);
    assert.equal(prs[0].repo, "alice/project");
    assert.equal((await loadPRsFromLogs("unknown")).length, 0);
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
});
