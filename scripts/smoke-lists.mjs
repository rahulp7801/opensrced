import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let repos = 0, prs = 0;
  const cursors = [];
  await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'list-test', name: 'List tester' } }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings/keys') return route.fulfill({ json: { anthropic: true, gemini: false } });
    if (path === '/api/repos/github') {
      repos++;
      cursors.push(new URL(route.request().url()).searchParams.get("cursor"));
      if (repos === 1) return route.fulfill({ status: 503, json: { error: 'Repository service unavailable.' } });
      return route.fulfill({ json: { repos: [{ nameWithOwner: repos === 3 ? 'acme/second-project' : 'acme/example-project', description: 'Example repo', language: 'TypeScript', stars: 1, forks: 0, updatedAt: new Date().toISOString(), isPrivate: false, source: 'contributed' }], hasMore: repos === 2, nextCursor: repos === 2 ? 'cursor+page/2==' : null } });
    }
    if (path === '/api/discover') return route.fulfill({ json: { repos: [], issues: [], repo_count: 0, issue_count: 0, warnings: ['Some repositories could not be scanned.'] } });
    if (path === '/api/prs/github') {
      prs++;
      return route.fulfill({ json: { login: 'tester', prs: [{ repo: 'acme/example-project', title: 'Fix an issue', number: 1, url: 'https://github.com/acme/example-project/pull/1', state: 'OPEN', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), branch: 'fix', base: 'main', additions: 1, deletions: 1, reviewDecision: 'REVIEW_REQUIRED', isDraft: false, commentCount: 0 }] } });
    }
    return route.fulfill({ json: [] });
  });
  async function settle() {
    await page.evaluate(async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
  }
  await page.goto(base + '/repos');
  await page.getByRole('alert').filter({ hasText: 'Repository service unavailable.' }).waitFor();
  await settle();
  assert.equal(repos, 1, 'a failed page must not start an automatic retry loop');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('link', { name: 'acme/example-project', exact: true }).waitFor();
  assert.equal(repos, 2);
  await page.getByRole('button', { name: 'load more', exact: true }).click();
  await page.getByRole('link', { name: 'acme/second-project', exact: true }).waitFor();
  assert.equal(repos, 3);
  assert.equal(cursors[2], 'cursor+page/2==');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'repository controls fit mobile screens');
  await page.goto(base + '/prs');
  await page.getByText('Fix an issue', { exact: true }).waitFor();
  await page.getByRole('button', { name: /All PRs/ }).click();
  await settle();
  assert.equal(prs, 1, 'switching PR tabs reuses the loaded list');
  await page.getByRole('button', { name: 'refresh', exact: true }).click();
  await page.getByText('PRs refreshed', { exact: true }).waitFor();
  await settle();
  assert.equal(prs, 2, 'refresh issues exactly one request');
  await page.goto(base + '/discover');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Partial results:' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ repositoryRetry: true, cursorPagination: true, mobileRepos: true, singlePrRefresh: true, partialDiscovery: true }));
  await context.close();
} finally { await browser.close(); }
