import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3101';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
let pagesChecked = 0;

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(30_000);
    try {
      const page = await context.newPage();
      const errors = [];
      const authRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (/\/auth\/(login|logout)(?:\?|$)/.test(request.url())) authRequests.push(request.url());
      });

      for (const path of ['/', '/demo', '/login', '/issues', '/dispatches', '/graph']) {
        const response = await page.goto(base + path, { waitUntil: 'load' });
        assert.equal(response.status(), 200, `${width} ${path} must render`);
        await page.locator('main h1').first().waitFor({ state: 'visible' });
        if (['/issues', '/dispatches', '/graph'].includes(path)) {
          const location = new URL(page.url());
          assert.equal(location.pathname, '/login');
          assert.equal(location.searchParams.get('returnTo'), path);
        }
        if (path !== '/' && path !== '/demo') {
          await page.getByRole('heading', { name: 'Sign-in is being configured', exact: true }).waitFor();
          assert.equal(await page.getByRole('link', { name: 'Continue with GitHub', exact: true }).count(), 0);
          assert.equal(await page.getByRole('link', { name: 'Explore the demo', exact: true }).getAttribute('href'), '/demo');
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${width} ${path}`);
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations
          .filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))
          .map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) }));
        assert.deepEqual(serious, [], `accessibility ${width} ${path}`);
        assert.deepEqual(errors, [], `client errors ${width} ${path}`);
        pagesChecked++;
      }

      await page.getByRole('link', { name: 'Explore the demo', exact: true }).click();
      await page.getByRole('tab', { name: 'Bug fix run', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/demo', 'unavailable sign-in must offer a working demo');
      assert.deepEqual(errors, [], `client errors after demo navigation ${width}`);
      assert.deepEqual(authRequests, [], 'unavailable authentication must not trigger login/logout requests');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ pagesChecked, widths: [1440, 390], seriousAccessibilityFindings: 0, authRequests: 0 }));
