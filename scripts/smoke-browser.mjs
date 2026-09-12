import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const browser = await chromium.launch({ headless: true });
let pagesChecked = 0;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
    const page = await context.newPage();
    const errors = [];
    const authNavigations = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/auth\/(login|logout)/.test(request.url())) authNavigations.push(request.url()); });
    for (const path of ['/', '/demo', '/login', '/issues', '/dispatches', '/trigger', '/stats']) {
      await page.goto(base + path, { waitUntil: 'domcontentloaded' });
      const main = page.locator('main');
      await main.locator('h1').first().waitFor({ state: 'visible' });
      if (['/issues', '/dispatches', '/trigger', '/stats'].includes(path)) {
        await main.getByRole('heading', { name: 'Sign in to continue', exact: true }).waitFor();
        assert.equal(await main.getByText(/HTTP 401|Retrying/).count(), 0);
      }
      if (path === '/demo') {
        for (const name of ['Codebase explorer', 'Security scan', 'Private repo flow', 'Bug fix pipeline']) {
          await page.getByRole('button', { name, exact: true }).click();
          await main.getByRole('button', { name: name === 'Security scan' ? /Start scan/ : name === 'Private repo flow' ? /Connect GitHub Org/ : /Start walkthrough/ }).waitFor();
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${width} ${path}`);
      assert.deepEqual(errors, [], `client errors ${path}`);
      pagesChecked++;
    }
    assert.deepEqual(authNavigations, [], 'login/logout must not be prefetched');
    await context.close();
  }

  // Client interaction test only: fake session/data, intercept every mutation.
  // Real Auth0 and provider workflows remain a separate deployment release gate.
  const context = await browser.newContext();
  context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
    const page = await context.newPage();
  await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'test-user', name: 'Test User' } }));
  const run = { id: 'test-preview', repo_url: 'https://github.com/acme/app', mode: 'agentic', dry_run: true, issue_number: 1, started_at: new Date().toISOString(), status: 'failed', log: '', log_size: 0 };
  const submissions = [];
  const settings = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/run/agentic') {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { dispatch_id: submissions.length === 1 ? 'test-retry' : 'test-preview' } });
    }
    if (url.pathname === '/api/dispatches') return route.fulfill({ json: { dispatches: [run] } });
    if (url.pathname === '/api/dispatches/test-preview' || url.pathname === '/api/dispatches/test-retry') return route.fulfill({ json: { ...run, id: url.pathname.split('/').at(-1) } });
    if (url.pathname === '/api/issues/suggested') return route.fulfill({ json: { issues: [], filteredOut: 0 } });
    if (url.pathname === '/api/issues/scan') return route.fulfill({ json: { repo: 'acme/app', total: 1, solvable: 1, issues: [{ number: 1, title: 'Fix parser error', body: 'Fix the parser.', labels: ['bug'], url: 'https://github.com/acme/app/issues/1', author: 'test', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), comments: 0, category: 'bug', severity: 'low', complexity: 1, est_minutes: 5, solvable: true, reason: 'Small fix', scope: { bucket: 'leaf', confidence: 'high', files: ['parser.ts'], symbols: [], reason: 'Parser file' } }] } });
    if (url.pathname === '/api/settings/keys') {
      if (route.request().method() === 'POST') {
        settings.push(route.request().postDataJSON());
        if (settings.length === 1) return route.fulfill({ status: 400, json: { error: 'Settings rejected for test.' } });
      }
      return route.fulfill({ json: { anthropic: true, gemini: false, maxSpendUsd: 2 } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(base + '/dispatches?dispatch=test-preview');
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/run/agentic')),
    page.getByRole('button', { name: 'retry', exact: true }).click(),
  ]);
  await page.waitForURL('**/dispatches?dispatch=test-retry');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].dry_run, true, 'retry must preserve preview');
  assert.equal(submissions[0].issue_number, 1);
  for (const preview of [true, false]) {
    await page.goto(base + '/issues?repo=acme/app');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/run/agentic')),
      page.getByRole('button', { name: preview ? 'preview' : 'solve & open PR', exact: true }).click(),
    ]);
    assert.equal(submissions.at(-1).dry_run, preview);
    assert.equal(submissions.at(-1).issue_number, 1);
    await page.waitForURL('**/dispatches?dispatch=test-preview');
  }
  assert.equal(submissions.length, 3);
  console.log('Checking settings recovery');
  await page.goto(base + '/crucible');
  const keyInput = page.getByLabel('Anthropic API key', { exact: true });
  await page.getByLabel('Gemini API key', { exact: true }).waitFor();
  await keyInput.fill('test-replacement-value');
  await page.getByRole('button', { name: '$0.10', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '$0.10', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings rejected for test.', { exact: true }).waitFor();
  assert.equal(await keyInput.inputValue(), 'test-replacement-value', 'failed saves preserve the input');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  assert.equal(await keyInput.inputValue(), '');
  assert.equal(settings.at(-1).maxSpendUsd, 0.1);
  assert.equal(await page.getByText('API keys needed for this page', { exact: true }).count(), 0, 'Gemini is optional');

  await context.close();
  console.log(JSON.stringify({ pagesChecked, viewports: [1440, 390], previewRetry: true, issueActions: 2, settingsRecovery: true, authPrefetch: false }));
} finally { await browser.close(); }
