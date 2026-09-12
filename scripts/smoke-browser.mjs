import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
let pagesChecked = 0;
let landingVitals = null;

async function assertUsableControls(page, label) {
  const problems = await page.locator('button:visible, [role="button"]:visible, input:visible, select:visible, textarea:visible').evaluateAll(elements =>
    elements.flatMap((element, index) => {
      const rect = element.getBoundingClientRect();
      const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
      const labels = 'labels' in element ? element.labels : null;
      const name = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.getAttribute('title') || labels?.length || (!isField && element.textContent?.trim());
      const issues = [];
      if (!name) issues.push(`${index}: missing accessible name`);
      if (rect.width < 24 || rect.height < 24) issues.push(`${index}: ${Math.round(rect.width)}x${Math.round(rect.height)} target`);
      return issues;
    }),
  );
  assert.deepEqual(problems, [], `unusable controls ${label}`);
}

async function assertNoSeriousAccessibilityViolations(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))
    .map(violation => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map(node => ({ target: node.target.join(' '), html: node.html, summary: node.failureSummary })),
    }));
  assert.deepEqual(serious, [], `accessibility violations ${label}`);
}

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    if (width === 1440) await context.addInitScript(() => {
      const vitals = { cls: 0, lcp: 0 };
      Object.defineProperty(window, '__opensrcerVitals', { value: vitals });
      if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) vitals.cls += entry.value ?? 0;
        }).observe({ type: 'layout-shift', buffered: true });
      }
      if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
        new PerformanceObserver(list => {
          const entries = list.getEntries();
          vitals.lcp = entries.at(-1)?.startTime ?? vitals.lcp;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }
    });
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
        await page.waitForLoadState('load');
        for (const [name, key] of [['Codebase explorer', 'explore'], ['Security scan', 'security'], ['Private repo flow', 'crucible'], ['Bug fix run', 'dispatch']]) {
          const tab = page.getByRole('tab', { name, exact: true });
          await tab.click();
          await page.waitForFunction(tabKey => document.getElementById(`demo-tab-${tabKey}`)?.getAttribute('aria-selected') === 'true', key);
          const action = main.getByRole('button', { name: name === 'Security scan' ? /Start scan/ : name === 'Private repo flow' ? /Connect GitHub Org/ : /Start walkthrough/ });
          await action.waitFor();
          assert.equal(await tab.getAttribute('aria-selected'), 'true');
          if (name === 'Private repo flow') {
            await action.click();
            await main.getByRole('button', { name: /Install & Authorize/ }).click();
            await main.getByText('acme-corp connected', { exact: true }).waitFor();
          }
        }
        await page.getByRole('tab', { name: 'Bug fix run', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        await page.locator('#demo-explore').getByRole('button', { name: /Start walkthrough/ }).waitFor();
        assert.equal(await page.getByRole('tab', { name: 'Codebase explorer', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByRole('tablist').evaluate(element => element.scrollWidth > element.clientWidth), false, 'demo tabs must all fit without horizontal scrolling');
      }
      await assertUsableControls(page, `${width} ${path}`);
      await assertNoSeriousAccessibilityViolations(page, `${width} ${path}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${width} ${path}`);
      assert.deepEqual(errors, [], `client errors ${path}`);
      if (width === 1440 && path === '/') {
        await page.waitForTimeout(250);
        landingVitals = await page.evaluate(() => window.__opensrcerVitals);
        assert.ok(landingVitals.lcp > 0 && landingVitals.lcp < 2_500, `landing LCP ${landingVitals.lcp}ms`);
        assert.ok(landingVitals.cls < 0.1, `landing CLS ${landingVitals.cls}`);
      }
      pagesChecked++;
    }
    await page.goto(base + '/login?returnTo=https%3A%2F%2Fevil.example');
    assert.equal(
      await page.getByRole('link', { name: 'Continue with GitHub', exact: true }).getAttribute('href'),
      '/auth/login?returnTo=%2F',
      'login return target must stay on this application',
    );
    assert.deepEqual(authNavigations, [], 'login/logout must not be prefetched');
    await context.close();
  }

  // Client interaction test only: fake session/data, intercept every mutation.
  // Real Auth0 and provider workflows remain a separate deployment release gate.
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.setItem('opensrcer-bookmarks', '{"stale":true}'); } catch {}
    window.__notificationPromptCount = 0;
    if (typeof Notification !== "undefined") {
      Notification.requestPermission = async () => {
        window.__notificationPromptCount += 1;
        return "default";
      };
    }
  });
  context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
  const page = await context.newPage();
  const interactionErrors = [];
  page.on('pageerror', error => interactionErrors.push(error.message));
  const onboardingOrgRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/crucible/orgs') onboardingOrgRequests.push(request.url());
  });
  await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'test-user', name: 'Test User' } }));
  const run = { id: 'test-preview', repo_url: 'https://github.com/acme/app', mode: 'agentic', dry_run: true, issue_number: 1, started_at: new Date().toISOString(), status: 'failed', log: '', log_size: 0 };
  const activeRun = { ...run, id: 'test-active', status: 'running' };
  const huntRun = { ...run, id: 'test-hunt', repo_url: '', mode: 'hunt', issue_number: undefined };
  const submissions = [];
  const settings = [];
  let keyAvailable = true;
  let cancelAttempts = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/run/agentic') {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { dispatch_id: submissions.length === 1 ? 'test-retry' : 'test-preview' } });
    }
    if (url.pathname === '/api/dispatches') return route.fulfill({ json: { dispatches: [activeRun, run, huntRun] } });
    if (url.pathname === '/api/dispatches/test-active') return route.fulfill({ json: activeRun });
    if (url.pathname === '/api/dispatches/test-preview' || url.pathname === '/api/dispatches/test-retry') return route.fulfill({ json: { ...run, id: url.pathname.split('/').at(-1) } });
    if (url.pathname === '/api/dispatches/test-active/cancel') {
      cancelAttempts++;
      return cancelAttempts === 1
        ? route.fulfill({ status: 503, json: { error: 'Worker stop failed for test.' } })
        : route.fulfill({ status: 202, json: { ok: true } });
    }
    if (url.pathname === '/api/issues/suggested') return route.fulfill({ json: { issues: [{ repo: 'acme/compiler', title: 'Improve parser diagnostics', number: 72, url: 'https://github.com/acme/compiler/issues/72', labels: ['good first issue'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: 1, language: 'TypeScript', stars: 24300 }], filteredOut: 0 } });
    if (url.pathname === '/api/issues/scan') return route.fulfill({ json: { repo: 'acme/app', total: 1, solvable: 1, issues: [{ number: 1, title: 'Fix parser error', body: 'Fix the parser.', labels: ['bug'], url: 'https://github.com/acme/app/issues/1', author: 'test', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), comments: 0, category: 'bug', severity: 'low', complexity: 1, est_minutes: 5, solvable: true, reason: 'Small fix', scope: { bucket: 'leaf', confidence: 'high', files: ['parser.ts'], symbols: [], reason: 'Parser file' } }] } });
    if (url.pathname === '/api/discover') return route.fulfill({ json: { repo_count: 0, issue_count: 0, issues: [], warnings: [] } });
    if (url.pathname === '/api/activity') return route.fulfill({ json: {
      dispatchWindow: 50, scans: 128, discoverRuns: 9, dispatches: 42, prsCreated: 11,
      bugsSquashed: 0, totalCostUsd: 14.82, patchesGenerated: 31, successRate: 0.74, prRate: 0.26,
      biggestContributions: [{ prUrl: 'https://github.com/acme/compiler/pull/91', repoFull: 'acme/compiler', stars: 24300, issueNumber: 418, dispatchId: 'd_visual_123456789', startedAt: new Date().toISOString() }],
      recentActivity: [{ kind: 'dispatch', ts: new Date().toISOString(), repo: 'acme/compiler', issueNumber: 418, prUrl: 'https://github.com/acme/compiler/pull/91' }, { kind: 'scan', ts: new Date(Date.now() - 3600000).toISOString(), repo: 'acme/parser' }],
    } });
    if (url.pathname === '/api/repos/github') return route.fulfill({ json: { repos: [{ nameWithOwner: 'acme/compiler', description: 'A production compiler with a deliberately long repository description.', language: 'TypeScript', stars: 24300, forks: 900, updatedAt: new Date().toISOString(), isPrivate: false, source: 'contributed' }], hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/prs/github') return route.fulfill({ json: { login: 'test-user', prs: [{ repo: 'acme/compiler', title: 'Handle malformed parser input without hanging the worker', number: 91, url: 'https://github.com/acme/compiler/pull/91', state: 'OPEN', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), branch: 'fix/parser', base: 'main', additions: 18, deletions: 4, reviewDecision: 'CHANGES_REQUESTED', isDraft: false, commentCount: 2 }] } });
    if (url.pathname === '/api/settings/keys') {
      if (route.request().method() === 'GET' && page.url().includes('settings_load_failure=1')) {
        return route.fulfill({ status: 503, json: { error: 'Settings unavailable for test.' } });
      }
      if (route.request().method() === 'POST') {
        settings.push(route.request().postDataJSON());
        if (settings.length === 1) return route.fulfill({ status: 400, json: { error: 'Settings rejected for test.' } });
      }
      return route.fulfill({ json: { anthropic: keyAvailable, gemini: false, maxSpendUsd: 2 } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(base + '/dispatches?dispatch=test-preview');
  await page.getByRole('link', { name: 'Find', exact: true }).waitFor();
  await page.getByText('Repository discovery', { exact: true }).waitFor();
  await page.getByText('Issue #1', { exact: true }).first().waitFor();
  await assertUsableControls(page, 'authenticated dispatches');
  await assertNoSeriousAccessibilityViolations(page, 'authenticated dispatches');
  for (const label of ['Find', 'Fix', 'Ship', 'Explore']) {
    assert.equal(await page.getByRole('link', { name: label, exact: true }).count(), 1, `${label} navigation needs an accessible name`);
  }
  const helpButton = page.getByRole('button', { name: 'Open help', exact: true });
  await helpButton.click();
  await page.getByRole('dialog', { name: 'Quick help', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'close', 'help moves focus into the dialog');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Escape closes help');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open help');
  assert.equal(await helpButton.evaluate(element => element === document.activeElement), true, 'help returns focus to its trigger');
  assert.equal(await page.evaluate(() => window.__notificationPromptCount), 0, 'runs page must not prompt for notifications on load');
  assert.equal(await page.getByText('Add an Anthropic API key', { exact: true }).count(), 0, 'completed onboarding stays hidden');
  assert.equal(onboardingOrgRequests.length, 0, 'onboarding must not fetch optional organization state');
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/run/agentic')),
    page.getByRole('button', { name: 'retry', exact: true }).click(),
  ]);
  await page.waitForURL('**/dispatches?dispatch=test-retry');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].dry_run, true, 'retry must preserve preview');
  assert.equal(submissions[0].issue_number, 1);
  await page.goto(base + '/dispatches?dispatch=test-active');
  await page.getByRole('button', { name: /stop/ }).click();
  await page.getByRole('button', { name: 'confirm kill', exact: true }).click();
  await page.getByRole('alert').getByText('Worker stop failed for test.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'confirm kill', exact: true }).click();
  await page.getByRole('button', { name: /stop/ }).waitFor();
  assert.equal(cancelAttempts, 2, 'a failed stop remains retryable');
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
  await page.goto(base + '/crucible?settings_load_failure=1');
  await page.getByText('Could not load settings.', { exact: true }).waitFor();
  assert.equal(await page.getByText('unavailable', { exact: true }).count(), 2, 'failed settings reads must leave the loading state');
  await page.goto(base + '/crucible');
  const keyInput = page.getByLabel('Anthropic API key', { exact: true });
  await page.getByLabel('Gemini API key', { exact: true }).waitFor();
  await assertUsableControls(page, 'authenticated settings');
  await assertNoSeriousAccessibilityViolations(page, 'authenticated settings');
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
  assert.equal(await page.getByText('Anthropic key required', { exact: true }).count(), 0, 'Gemini is optional');

  keyAvailable = false;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('opensrcer-keys-updated')));
  await page.goto(base + '/trigger');
  await page.getByText('Anthropic key required', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'missing-key banner must fit mobile');
  await assertNoSeriousAccessibilityViolations(page, 'mobile missing-key banner');

  await page.goto(base + '/issues');
  const activeFindLabel = page.getByRole('link', { name: 'Find', exact: true }).getByText('Find', { exact: true });
  await activeFindLabel.waitFor();
  assert.equal(await activeFindLabel.isVisible(), true, 'active task label stays visible on mobile');
  const suggestedFix = page.getByRole('link', { name: 'fix this', exact: true });
  await suggestedFix.waitFor();
  assert.equal(await suggestedFix.evaluate(element => getComputedStyle(element).opacity), '1', 'suggested issue action stays visible on touch layouts');
  assert.equal(await page.getByText('Scan a repository.', { exact: true }).count(), 0, 'manual scan form does not repeat its empty instructions');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'authenticated issues must fit mobile');
  await assertNoSeriousAccessibilityViolations(page, 'authenticated mobile issues');

  await page.goto(base + '/discover');
  await page.getByRole('button', { name: 'Discover', exact: true }).waitFor();
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/discover'),
    page.getByLabel('minimum stars', { exact: true }).press('Enter'),
  ]);
  await page.getByText('No repos matched.', { exact: false }).waitFor();
  assert.deepEqual(interactionErrors, [], 'malformed saved bookmarks must not crash discovery');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'authenticated discovery must fit mobile');

  await page.goto(base + '/stats');
  await page.getByRole('heading', { name: 'Biggest contributions', exact: true }).waitFor();
  await page.getByText('acme/parser', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'authenticated stats must fit mobile');
  await assertNoSeriousAccessibilityViolations(page, 'authenticated mobile stats');

  await page.goto(base + '/repos');
  await page.getByRole('link', { name: 'Graph', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /Contributed to/ }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'authenticated repositories must fit mobile');
  await assertUsableControls(page, 'authenticated mobile repositories');
  await assertNoSeriousAccessibilityViolations(page, 'authenticated mobile repositories');

  await page.goto(base + '/prs');
  await page.getByText('Handle malformed parser input without hanging the worker', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /Inbox/ }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'authenticated pull requests must fit mobile');
  await assertUsableControls(page, 'authenticated mobile pull requests');
  await assertNoSeriousAccessibilityViolations(page, 'authenticated mobile pull requests');

  await context.close();
  console.log(JSON.stringify({ pagesChecked, viewports: [1440, 390], landingVitals, controlTargets: true, accessibility: 'serious-and-critical', helpDialog: true, previewRetry: true, issueActions: 2, settingsRecovery: true, authenticatedMobilePages: ['issues', 'stats', 'repos', 'prs'], authPrefetch: false }));
} finally { await browser.close(); }
