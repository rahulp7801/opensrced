// Does a repo profile describe a stable norm, or noise? For each repository,
// the profile as it stood three months ago (PRs opened 120–210 days back) is
// compared with what happened next (PRs opened 30–120 days back): the outside
// merge rate, and the most common reason outside PRs were closed. Baseline:
// predicting every repository's merge rate as the average of all of them.
//
//   npm run build:test-lib   (or npm test, which compiles .test-build)
//   GH_TOKEN=$(gh auth token) node scripts/eval-profile.mjs [owner/name ...]

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { gh } = require("../.test-build/lib/gh.js");
const { fetchRepoProfile } = require("../.test-build/lib/repo-profile.js");

const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "pandas-dev/pandas", "pydantic/pydantic", "fastapi/fastapi", "numpy/numpy", "scikit-learn/scikit-learn",
  "astral-sh/ruff", "withastro/astro", "django/django", "pallets/flask", "psf/requests", "vercel/next.js",
  "facebook/react", "home-assistant/core", "python/cpython", "nodejs/node", "denoland/deno",
];
const DAY = 86_400_000;
const client = gh(process.env.GH_TOKEN ?? "");
const share = (t) => (t.of ? t.count / t.of : null);
const topReason = (p) => p.closeReasons.find((r) => r.reason !== "unexplained")?.reason ?? "unexplained";

const rows = [];
for (const repo of REPOS) {
  try {
    const before = await fetchRepoProfile(client, repo, new Date(Date.now() - 90 * DAY));
    const after = await fetchRepoProfile(client, repo, new Date());
    rows.push({ repo, before: share(before.outside.merged), after: share(after.outside.merged), n: [before.outside.merged.of, after.outside.merged.of],
      reasons: [topReason(before), topReason(after)] });
    process.stderr.write(".");
  } catch (error) {
    process.stderr.write(`\n${repo}: ${error.message}\n`);
  }
}
process.stderr.write("\n");

const usable = rows.filter((r) => r.before !== null && r.after !== null && r.n[0] >= 5 && r.n[1] >= 5);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const average = mean(usable.map((r) => r.before));
const mae = (pick) => mean(usable.map((r) => Math.abs(pick(r) - r.after)));
const [mx, my] = [mean(usable.map((r) => r.before)), mean(usable.map((r) => r.after))];
const cov = mean(usable.map((r) => (r.before - mx) * (r.after - my)));
const sd = (k, m) => Math.sqrt(mean(usable.map((r) => (r[k] - m) ** 2)));
const pct = (x) => `${Math.round(x * 100)}%`;

for (const r of rows) {
  console.log(`${r.repo.padEnd(26)} merged ${r.before === null ? "  -" : pct(r.before).padStart(4)} → ${r.after === null ? "  -" : pct(r.after).padStart(4)}   (n ${r.n.join(" → ")})   top close reason ${r.reasons[0]} → ${r.reasons[1]}`);
}
console.log(`\n${usable.length} repositories with ≥5 outside PRs in both windows.`);
console.log(`Merge rate, profile vs next window: r = ${(cov / (sd("before", mx) * sd("after", my))).toFixed(2)}`);
console.log(`Mean absolute error: profile ${pct(mae((r) => r.before))}, average-of-all baseline ${pct(mae(() => average))}`);
console.log(`Top close reason unchanged: ${usable.filter((r) => r.reasons[0] === r.reasons[1]).length} of ${usable.length}`);
