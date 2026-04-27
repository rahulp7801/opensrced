// Trigger an agentic dispatch end-to-end with NO push.
//
// Usage: npx tsx scripts/trigger-agentic.ts <repo> <issue#>
//
// Env knobs we set explicitly:
//   OPENSRCER_AGENTIC_AUTO_PR=0   — suppress fork/branch/commit/push/draft-PR
//   ANTHROPIC_API_KEY             — read from .env.local automatically by Next loader,
//                                    but this is a standalone script so we re-load it.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local manually since this isn't a Next.js route. We can't
// use dotenv (not installed); just parse the simple KEY=value form.
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}
process.env.OPENSRCER_AGENTIC_AUTO_PR = "0"; // Hard rule: no PR.

const [, , repo, issueArg] = process.argv;
if (!repo || !issueArg) {
  console.error("Usage: npx tsx scripts/trigger-agentic.ts <owner/repo> <issue#>");
  process.exit(1);
}
const issueNumber = Number(issueArg);
if (!Number.isFinite(issueNumber)) {
  console.error("issue# must be numeric");
  process.exit(1);
}

import { startAgenticDispatch } from "../lib/agentic-dispatcher.ts";

console.log(`[test] AUTO_PR suppressed: process.env.OPENSRCER_AGENTIC_AUTO_PR=${process.env.OPENSRCER_AGENTIC_AUTO_PR}`);
console.log(`[test] target: ${repo} #${issueNumber}`);

const d = startAgenticDispatch(repo, issueNumber, {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  // No org context, no maxSpend override — leaf-path budget will apply
  // automatically if the issue classifies as leaf/doc.
});

console.log(`[test] dispatch id=${d.id}`);
console.log(`[test] log path=${d.log_path}`);
console.log(`[test] streaming log (Ctrl-C to stop watching)…`);
console.log("─".repeat(70));

let lastSize = 0;
const interval = setInterval(() => {
  if (!existsSync(d.log_path)) return;
  try {
    const buf = readFileSync(d.log_path, "utf8");
    if (buf.length > lastSize) {
      process.stdout.write(buf.slice(lastSize));
      lastSize = buf.length;
    }
  } catch {
    /* file might be in flux */
  }
}, 500);

// Stop watching once the dispatch is done. We poll the registry
// indirectly by checking for the [agentic-dispatcher] close marker.
const stopWhenClosed = setInterval(() => {
  if (!existsSync(d.log_path)) return;
  const buf = readFileSync(d.log_path, "utf8");
  if (
    buf.includes("[agentic-dispatcher] close") ||
    buf.includes("[agentic-dispatcher] timeout") ||
    buf.includes("[agentic-dispatcher] spawn error")
  ) {
    clearInterval(interval);
    clearInterval(stopWhenClosed);
    // Final flush
    setTimeout(() => {
      const final = readFileSync(d.log_path, "utf8");
      if (final.length > lastSize) {
        process.stdout.write(final.slice(lastSize));
      }
      console.log("\n" + "─".repeat(70));
      console.log("[test] dispatch finished. Log is at:", d.log_path);
      process.exit(0);
    }, 1000);
  }
}, 1000);
