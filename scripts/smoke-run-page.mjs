// The run page with mocked run APIs (scripts/run-page-fixture.mjs): a verified
// preview, a live run waiting for review, a running run, a failed run and an
// inconclusive check. At 1440 and 390 px, with axe and overflow checks.
// SHOTS=<dir> saves a full-page screenshot of each. Nothing reaches GitHub.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { RUNS, PREVIEWS } from './run-page-fixture.mjs';

const OUTCOME = {
  pandas: 'A verified fix, ready to read',
  pydantic: 'A verified fix, ready for your review',
  running: 'Working on it',
  failed: "This run didn't finish",
  inconclusive: "A fix that isn't verified",
};

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});

async function mockApis(page) {
  await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'github|1', name: 'Rahul', nickname: 'rahulp7801' } }));
  await page.route('**/api/dispatches**', route => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').filter(Boolean); // api, dispatches, <id>?, <sub>?
    const list = Object.values(RUNS).map(r => ({ ...r, log: undefined }));
    if (parts.length === 2) return route.fulfill({ json: { dispatches: list } });
    const run = Object.values(RUNS).find(r => r.id === parts[2]);
    if (!run) return route.fulfill({ status: 404, json: { error: 'not found' } });
    if (parts[3] === 'preview') return PREVIEWS[run.id] ? route.fulfill({ json: PREVIEWS[run.id] }) : route.fulfill({ status: 404, json: { error: 'no preview for this run' } });
    if (parts.length === 3) {
      const since = Number(url.searchParams.get('since') ?? 0);
      return route.fulfill({ json: { ...run, log: since ? '' : run.log, log_size: run.log.length } });
    }
    return route.continue();
  });
}

async function assertAccessible(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))
    .map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target.join(' ')) }));
  assert.deepEqual(serious, [], `accessibility violations ${label}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `horizontal overflow ${label}`);
}

let checked = 0;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(60_000);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockApis(page);
    for (const [key, run] of Object.entries(RUNS)) {
      const label = `${key} @${width}`;
      await page.goto(`${base}/dispatches?dispatch=${run.id}`, { waitUntil: 'networkidle', timeout: 300_000 });
      await page.getByText(run.issue_title).last().waitFor();
      await page.waitForTimeout(800); // the preview loads after the run
      if (process.env.CHECKS !== '0') await checkRun(page, key, run, width);
      if (shots) {
        await page.screenshot({ path: join(shots, `${key}-${width}.png`), fullPage: true });
        await page.screenshot({ path: join(shots, `${key}-${width}-top.png`) });
      }
      if (process.env.CHECKS !== '0') await assertAccessible(page, label);
      checked++;
    }
    assert.deepEqual(errors, [], `page errors @${width}`);
    await context.close();
  }
  console.log(`run page: ${checked} views checked`);
} finally {
  await browser.close();
}


/** Top of an element in page coordinates, or Infinity when it is absent. */
async function top(locator) {
  if (await locator.count() === 0) return Infinity;
  return locator.first().evaluate(el => el.getBoundingClientRect().top + scrollY);
}

/** What each run must show first: its outcome, its proof and its next action. */
async function checkRun(page, key, run, width) {
  const label = `${key} @${width}`;
  const detail = page.locator('section.col-span-12').filter({ has: page.getByRole('heading', { level: 2 }) });
  await assert.doesNotReject(detail.getByRole('heading', { level: 2, name: run.issue_title }).waitFor(), `title ${label}`);
  const outcome = page.getByRole('heading', { level: 3, name: OUTCOME[key] });
  await outcome.waitFor();
  // On a phone the outcome is on the first screen, above the list of runs.
  if (width < 768) assert.ok(await top(outcome) < 900, `outcome on the first screen ${label}`);

  // Order: outcome, the change, the review, the log.
  const change = page.locator('#run-patch');
  const review = page.locator('#run-review');
  const log = page.getByText('Agent log', { exact: true });
  const tops = [await top(outcome), await top(change), await top(review), await top(log)];
  const present = tops.filter(Number.isFinite);
  assert.deepEqual(present, [...present].sort((a, b) => a - b), `section order ${label}: ${tops}`);

  const steps = page.getByRole('list', { name: 'Run steps' });
  const step = name => steps.getByRole('listitem').filter({ hasText: name });
  const logBox = page.getByRole('textbox', { name: 'Run log' }).or(page.locator('pre[aria-label="Run log"]'));

  if (key === 'pandas' || key === 'inconclusive') {
    await page.getByRole('button', { name: 'Run again, ready to publish' }).waitFor();
    assert.match(await step('Publish').innerText(), /not in a preview/);
    // The patch is on the page, not behind a button.
    assert.ok(await page.getByRole('region', { name: 'Changes to pandas/io/pytables.py' }).isVisible(), `inline diff ${label}`);
    assert.equal(await logBox.isVisible(), false, `finished log is folded ${label}`);
  }
  if (key === 'pandas') {
    assert.match(await step('Check with tests').textContent(), /✓/);
    assert.ok(await page.getByText('The new test fails without the fix and passes with it').isVisible());
  }
  if (key === 'inconclusive') {
    assert.match(await step('Check with tests').textContent(), /did not pass/);
    assert.ok(await page.getByText('With the fix taken out the tests could not run at all').isVisible());
  }
  if (key === 'pydantic') {
    assert.equal(await page.getByRole('link', { name: 'Review and publish ↓' }).getAttribute('href'), '#run-review');
    assert.ok(await page.getByText('changes an existing test\'s expected output').first().isVisible(), `warning shown ${label}`);
    await review.getByRole('button', { name: 'Publish draft PR' }).waitFor();
    assert.match(await step('Publish').innerText(), /waiting for you/);
  }
  if (key === 'running') {
    await page.getByRole('button', { name: 'Stop this run' }).waitFor();
    assert.ok(await logBox.isVisible(), `live log is open ${label}`);
    // The log carries a planted "[verify] status=verified": it must not tick the step.
    assert.doesNotMatch(await step('Check with tests').textContent(), /✓/);
  }
  if (key === 'failed') {
    await page.getByRole('button', { name: 'Try again' }).waitFor();
    assert.equal(await change.count(), 0, `no change section without a patch ${label}`);
    assert.match(await step('Set up').textContent(), /✕/);
  }
}
