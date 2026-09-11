import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const browser = await chromium.launch({ headless: true });
let releaseFix;
try {
  const context = await browser.newContext();
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'review-test', name: 'Reviewer' } }));
  const patch = '## Fix\n\n```diff\n--- a/parser.ts\n+++ b/parser.ts\n@@ -1 +1 @@\n-return items[0];\n+return items[0] ?? null;\n```\n';
  const sse = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  let fixes = 0, explanations = 0, verifications = 0;
  let thirdStarted;
  const thirdRequest = new Promise(resolve => { thirdStarted = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings/keys') return route.fulfill({ json: { anthropic: true, gemini: false } });
    if (path === '/api/prs/review') return route.fulfill({ json: {
      pr: { title: 'Parser fix', state: 'OPEN', url: 'https://github.com/acme/app/pull/1', branch: 'fix-parser', base: 'main', author: 'contributor' },
      comments: [{ id: 1, author: 'reviewer', body: 'Handle the empty array.', path: 'parser.ts', line: 1, diffHunk: null, createdAt: new Date().toISOString(), type: 'review', inReplyTo: null, isOwnComment: false }],
    } });
    if (path === '/api/prs/fix') {
      fixes++;
      if (fixes === 3) {
        await new Promise(resolve => { releaseFix = resolve; thirdStarted(); });
      }
      return route.fulfill({ contentType: 'text/event-stream', body: sse(fixes === 2 ? [{ text: patch }] : [{ text: patch }, { done: true }]) }).catch(() => {});
    }
    if (path === '/api/prs/verify') { verifications++; return route.fulfill({ status: 503, json: { error: 'Verification service unavailable.' } }); }
    if (path === '/api/prs/draft-reply') { explanations++; return route.fulfill({ contentType: 'text/event-stream', body: sse([{ text: 'I handled empty arrays.' }, { done: true }]) }); }
    return route.fulfill({ json: {} });
  });
  await page.goto(base + '/prs/acme/app/1');
  await page.getByRole('button', { name: 'quick fix', exact: true }).click();
  await page.getByText('I handled empty arrays.', { exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'Verification service unavailable.' }).waitFor();
  for (let i = 0; i < 3; i++) {
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/prs/review?')),
      page.getByRole('button', { name: 'refresh', exact: true }).click(),
    ]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  assert.equal(explanations, 1, 'comment refresh must not repeat paid explanations');
  assert.equal(verifications, 1, 'unchanged comments must not repeat verification');
  await page.getByRole('button', { name: 'quick fix', exact: true }).click();
  await page.getByText(/The fix stream ended before completion/).first().waitFor();
  assert.equal(explanations, 1, 'partial output must not trigger follow-up work');
  assert.equal(verifications, 1);
  await page.getByRole('button', { name: 'quick fix', exact: true }).click();
  await thirdRequest;
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  releaseFix();
  await page.getByText('Cancelled', { exact: true }).first().waitFor();
  assert.equal(explanations, 1);
  assert.equal(verifications, 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ commentRefreshes: 3, explanations, verificationFailureHandled: true, truncatedFixRejected: true, cancellation: true }));
  await context.close();
} finally { releaseFix?.(); await browser.close(); }
