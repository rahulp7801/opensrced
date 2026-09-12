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
  let fixes = 0, explanations = 0, verifications = 0, drafts = 0, pushes = 0, diffs = 0;
  let thirdStarted;
  const thirdRequest = new Promise(resolve => { thirdStarted = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings/keys') return route.fulfill({ json: { anthropic: true, gemini: false } });
    if (path === '/api/prs/review') return route.fulfill({ json: {
      pr: { title: 'Parser fix', state: 'OPEN', url: 'https://github.com/acme/app/pull/1', branch: 'fix-parser', headRepo: 'team/renamed-fork', base: 'main', author: 'contributor' },
      comments: [{ id: 1, author: 'reviewer', body: 'Handle the empty array.', path: 'parser.ts', line: 1, diffHunk: null, createdAt: new Date().toISOString(), type: 'review', inReplyTo: null, isOwnComment: false }],
    } });
    if (path === '/api/prs/fix') {
      fixes++;
      if (fixes === 3) {
        await new Promise(resolve => { releaseFix = resolve; thirdStarted(); });
      }
      return route.fulfill({ contentType: 'text/event-stream', body: sse(fixes === 2 ? [{ text: patch }] : fixes === 4 ? [{ text: patch }, { error: 'Provider rejected this fix.' }, { done: true }] : [{ text: patch }, { done: true }]) }).catch(() => {});
    }
    if (path === '/api/prs/diff') {
      diffs++;
      return diffs === 1 ? route.fulfill({ status: 503, json: { error: 'Diff service unavailable' } }) : route.fulfill({ json: { diff: '--- a/parser.ts\n+++ b/parser.ts\n@@ -1 +1 @@\n-oldValue\n+newValue\n' } });
    }
    if (path === '/api/prs/push') {
      pushes++;
      assert.equal(route.request().postDataJSON().repo, 'team/renamed-fork');
      return route.fulfill({ status: 503, json: { error: 'network failure: push outcome unknown' } });
    }
    if (path === '/api/prs/verify') { verifications++; return route.fulfill({ status: 503, json: { error: 'Verification service unavailable.' } }); }
    if (path === '/api/prs/draft-reply' && route.request().postDataJSON().comment_body === 'Handle the empty array.') {
      drafts++;
      return route.fulfill({ contentType: 'text/event-stream', body: sse(drafts === 1 ? [{ text: 'Incomplete draft' }, { error: 'Draft provider failed.' }] : drafts === 2 ? [{ text: 'Truncated draft' }] : [{ text: 'I added the empty-array guard.' }, { done: true }]) });
    }
    if (path === '/api/prs/draft-reply') { explanations++; return route.fulfill({ contentType: 'text/event-stream', body: sse([{ text: 'I handled empty arrays.' }, { done: true }]) }); }
    return route.fulfill({ json: {} });
  });
  await page.goto(base + '/prs/acme/app/1');
  await page.getByRole('button', { name: 'show diff', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Diff service unavailable' }).waitFor();
  await page.getByRole('button', { name: 'Retry diff', exact: true }).click();
  await page.getByText('+newValue', { exact: true }).waitFor();
  assert.equal(diffs, 2);
  await page.getByRole('button', { name: 'hide diff', exact: true }).click();
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
  await page.getByRole('button', { name: 'push fix', exact: true }).click();
  await page.getByText('network failure: push outcome unknown', { exact: true }).waitFor();
  await page.waitForTimeout(2200); // Exceeds the old automatic retry delay.
  assert.equal(pushes, 1, 'uncertain writes must not be automatically repeated');
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
  await page.getByRole('button', { name: 'quick fix', exact: true }).click();
  await page.getByText('Provider rejected this fix.', { exact: true }).first().waitFor();
  await page.getByText('failed', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Complete', { exact: true }).count(), 0, 'a later done event cannot erase a provider error');
  await page.getByRole('button', { name: 'draft reply', exact: true }).click();
  await page.getByText('Draft provider failed.', { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'send reply', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'draft reply', exact: true }).click();
  await page.getByText(/The response ended before completion/).first().waitFor();
  await page.getByRole('button', { name: 'draft reply', exact: true }).click();
  await page.locator('textarea').filter({ visible: true }).first().waitFor();
  assert.ok((await page.locator('textarea').evaluateAll(nodes => nodes.map(node => node.value))).includes('I added the empty-array guard.'));
  assert.equal(drafts, 3);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ commentRefreshes: 3, explanations, verificationFailureHandled: true, truncatedFixRejected: true, cancellation: true, draftRecovery: true, terminalFailure: true, correctPushTarget: true, noWriteRetry: true, diffRetry: true }));
  await context.close();
} finally { releaseFix?.(); await browser.close(); }
