import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local activity and generated PR histories stay within product windows", async () => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-history-window-"));
  process.chdir(root);
  try {
    mkdirSync(".dispatches");
    for (let i = 0; i < 120; i++) {
      const id = `d_run_${String(i).padStart(3, "0")}`;
      writeFileSync(`.dispatches/${id}.json`, JSON.stringify({
        id,
        auth0_user_id: "alice",
        repo_url: "https://github.com/acme/app",
        mode: "agentic",
        dry_run: false,
        issue_number: i + 1,
        started_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        status: "succeeded",
        log_path: `.dispatches/${id}.log`,
        stats: { cost_usd: 0.01, has_diff: true },
      }));
    }

    const stats = await import("../stats");
    const summary = await stats.getStatsSummary("alice");
    assert.equal(summary.dispatches, 50);
    assert.equal(summary.dispatchWindow, 50);

    for (let i = 0; i < 120; i++) {
      const id = `d_run_${String(i).padStart(3, "0")}`;
      const path = `.dispatches/${id}.json`;
      const record = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(path, JSON.stringify({ ...record, pr_url: `https://github.com/acme/app/pull/${i + 1}` }));
    }
    const { loadPRsFromLogs } = await import("../pr-loader");
    assert.equal((await loadPRsFromLogs("alice")).length, 100);
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
});
