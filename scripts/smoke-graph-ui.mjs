import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { encrypt } from '../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Session fixtures are local-only');
assert.equal(process.env.AUTH0_SECRET, 'ci-build-only-not-a-real-secret');
const now = Math.floor(Date.now() / 1000);
const session = await encrypt({ user: { sub: 'graph-test', name: 'Graph tester' }, tokenSet: { accessToken: 'test-auth0-value', expiresAt: now + 3600 }, internal: { sid: 'graph-test', createdAt: now } }, process.env.AUTH0_SECRET, now + 3600);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
let releaseBuild, releaseQuery;
try {
  const context = await browser.newContext();
  context.setDefaultTimeout(15000);
  await context.addCookies([{ name: '__session', value: session, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const sse = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  let builds = 0, queries = 0;
  await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'graph-test', name: 'Graph tester' } }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings/keys') return route.fulfill({ json: { anthropic: true } });
    if (path.endsWith('/viz')) return route.fulfill({ status: route.request().method() === 'HEAD' ? 404 : 200, contentType: 'text/html', body: '<p>Graph fixture</p>' });
    if (path === '/api/graph/generate') {
      builds++;
      const current = builds;
      if (current === 1) assert.equal(route.request().postDataJSON().repo_url, 'acme/project.name');
      if (current === 3) await new Promise(resolve => { releaseBuild = resolve; });
      return route.fulfill({ contentType: 'text/event-stream', body: sse(current === 1 ? [{ error: 'Build fixture failed' }, { status: 'done' }] : [{ status: 'done', engine: 'graphify' }]) }).catch(() => {});
    }
    if (path === '/api/graph/query') {
      queries++;
      const current = queries;
      if (current === 3) await new Promise(resolve => { releaseQuery = resolve; });
      return route.fulfill({ contentType: 'text/event-stream', body: sse(current === 1 ? [{ text: 'Partial answer' }] : current === 2 ? [{ error: 'Query fixture failed' }, { done: true }] : [{ text: 'Complete answer' }, { done: true }]) }).catch(() => {});
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(base + '/graph?repo=https://github.com/acme/project.name');
  const repoInput = page.getByLabel('GitHub repository', { exact: true });
  await page.getByRole('button', { name: 'build graph', exact: true }).click();
  await page.getByText('Error: Build fixture failed', { exact: true }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.getByRole('button', { name: 'build graph', exact: true }).click();
  await page.locator('iframe').waitFor();
  await page.getByRole('button', { name: 'stats', exact: true }).click();
  await page.getByText('The answer stream ended before completion. Please retry.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'stats', exact: true }).click();
  await page.getByText('Query fixture failed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'stats', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Query cancelled.', { exact: true }).waitFor();
  releaseQuery?.();
  await page.getByRole('button', { name: 'stats', exact: true }).click();
  await page.getByText('Complete answer', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'rebuild', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  await repoInput.fill('acme/other');
  releaseBuild?.();
  await page.getByRole('button', { name: 'build graph', exact: true }).waitFor();
  await page.evaluate(async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
  assert.equal(await page.locator('iframe').count(), 0, 'old build cannot mark the next repository ready');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ dottedRepository: true, terminalFailures: true, truncatedAnswer: true, cancelAndRetry: true, repositorySwitch: true }));
  await context.close();
} finally { releaseBuild?.(); releaseQuery?.(); await browser.close(); }
