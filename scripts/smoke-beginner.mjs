// The first-contribution path, with a fake session and mocked APIs: setup that
// says why and what it costs, checked beginner issues, a preview that leads
// somewhere, the publish explanation, the result of publishing, what happens
// next, and the inline glossary. At 1440 and 390 px, with axe and target-size
// checks. Nothing here reaches GitHub or a model.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});

async function assertUsableControls(page, label) {
  const problems = await page.locator('button:visible, [role="button"]:visible, input:visible, select:visible, textarea:visible').evaluateAll(elements =>
    elements.flatMap((element, index) => {
      const rect = element.getBoundingClientRect();
      const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
      const labels = 'labels' in element ? element.labels : null;
      const name = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.getAttribute('title') || labels?.length || (!isField && element.textContent?.trim());
      const issues = [];
      if (!name) issues.push(`${index}: missing accessible name`);
      if (rect.width < 24 || rect.height < 24) issues.push(`${index} ${element.textContent?.trim().slice(0, 30)}: ${Math.round(rect.width)}x${Math.round(rect.height)} target`);
      return issues;
    }),
  );
  assert.deepEqual(problems, [], `unusable controls ${label}`);
}

async function assertAccessible(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))
    .map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target.join(' ')) }));
  assert.deepEqual(serious, [], `accessibility violations ${label}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow ${label}`);
}

const now = new Date().toISOString();
const log = ['[agentic-dispatcher] repo: acme/app', '## Diagnosis', '', 'An empty input reaches parse unchecked.', '',
  '```diff', '--- a/parser.ts', '+++ b/parser.ts', '@@ -1 +1 @@', '-return items[0];', '+return items[0] ?? null;', '```', ''].join('\n');
const run = { repo_url: 'https://github.com/acme/app', mode: 'agentic', issue_number: 1, issue_title: 'Parser crashes on empty input', started_at: now, ended_at: now, status: 'succeeded', has_preview: true };
const runs = {
  'b-dry': { ...run, id: 'b-dry', dry_run: true, pr_status: 'none' },
  'b-ready': { ...run, id: 'b-ready', dry_run: false, pr_status: 'awaiting_review' },
  'b-ask': { ...run, id: 'b-ask', dry_run: false, pr_status: 'awaiting_review' },
};
const preview = {
  title: 'fix(parser): handle empty input (#1)', body: 'Fixes #1', files: ['parser.ts'], signoff: true, executed: true,
  verification: { status: 'verified', reason: 'npm test passed' }, blockers: [], warnings: [],
  confirmation: "I've read this change and can explain it to reviewers.", draft_issue_comment: "Hi, I'd like to help with this.", ask_first: false,
};
const previews = {
  'b-dry': { ...preview, publishable: false },
  'b-ready': { ...preview, publishable: true },
  'b-ask': { ...preview, publishable: true, ask_first: true, warnings: ['Maintainers ask for discussion first: the issue is labeled "needs discussion".'] },
};

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(60_000);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const starts = [];
    let publishes = 0;
    // Section 7 switches the list pages to these answers.
    let lists = false;
    let reposReply = 'error';
    await page.route('**/auth/profile', route => route.fulfill({ json: { sub: 'beginner', name: 'First Timer' } }));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/settings/keys') return route.fulfill({ json: { anthropic: false, ready: false, gemini: false, maxSpendUsd: 2, offered: ['anthropic-key'], providerOrder: ['anthropic-key'] } });
      if (path === '/api/dispatches') return route.fulfill({ json: { dispatches: Object.values(runs) } });
      if (path === '/api/run/agentic') { starts.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { dispatch_id: 'b-ready' } }); }
      const m = /^\/api\/dispatches\/([^/]+)(\/preview|\/publish)?$/.exec(path);
      if (m) {
        if (m[2] === '/preview') return route.fulfill({ json: previews[m[1]] });
        if (m[2] === '/publish') { publishes++; return route.fulfill({ json: { ok: true, pr_url: 'https://github.com/acme/app/pull/12', tests: 'passed' } }); }
        // The whole log on every poll keeps the page polling: a publish must survive a poll answer.
        return route.fulfill({ json: { ...runs[m[1]], log, log_size: log.length } });
      }
      if (path === '/api/issues/suggested') return route.fulfill({ json: { issues: [{ repo: 'acme/compiler', title: 'Improve parser diagnostics', number: 72, url: 'https://github.com/acme/compiler/issues/72', labels: ['good first issue'], createdAt: now, updatedAt: now, comments: 1, language: 'TypeScript', stars: 24300 }], filteredOut: 0 } });
      if (path === '/api/issues/scan' && new URL(route.request().url()).searchParams.get('repo') === 'acme/app') return route.fulfill({ json: { repo: 'acme/app', total: 1, solvable: 1, issues: [{
        number: 1, title: 'Fix parser error', body: 'Fix the parser.', labels: ['bug', 'good first issue'], url: 'https://github.com/acme/app/issues/1', author: 'maint',
        created_at: now, updated_at: now, comments: 0, category: 'bug', severity: 'low', complexity: 1, est_minutes: 5, solvable: true, reason: 'Small fix',
        scope: { bucket: 'leaf', confidence: 'high', files: ['parser.ts'], symbols: [], reason: 'One file is named in the issue.' } }] } });
      if (path === '/api/issues/scan') return route.fulfill({ json: { repo: 'acme/compiler', total: 0, solvable: 0, issues: [] } });
      if (lists && path === '/api/repos/github') return reposReply === 'error'
        ? route.fulfill({ status: 500, json: { error: 'Internal server error' } })
        : route.fulfill({ json: { repos: [], hasMore: false, nextCursor: null } });
      if (lists && path === '/api/prs/github') return route.fulfill({ json: { login: 'first-timer', prs: [{ repo: 'acme/app', title: 'Handle empty input', number: 12, url: 'https://github.com/acme/app/pull/12',
        state: 'OPEN', createdAt: now, updatedAt: now, branch: 'fix', base: 'main', additions: 2, deletions: 1, reviewDecision: 'CHANGES_REQUESTED', isDraft: false, commentCount: 1 }] } });
      if (path === '/api/prs/review') return route.fulfill({ json: {
        pr: { title: 'fix(parser): handle empty input (#1)', state: 'OPEN', url: 'https://github.com/acme/app/pull/12', branch: 'opensrcer/1-b-ready', headRepo: 'first-timer/app', base: 'main', author: 'first-timer' },
        comments: [{ id: 1, author: 'maint', body: 'Can you also handle whitespace?', path: 'parser.ts', line: 1, diffHunk: null, createdAt: now, type: 'review', inReplyTo: null, isOwnComment: false }],
      } });
      if (path === '/api/prs/lifecycle') return route.fulfill({ json: { followups: false, state: 'open', ci: 'failed', mergeable_state: 'dirty', linked_issue: 1,
        recent: [{ kind: 'conflict', at: now }, { kind: 'ci_failed', at: now, checks: [{ name: 'lint', url: 'https://github.com/acme/app/actions/runs/1' }] }],
        pending_replies: 1, can_fix_ci: true, can_address_review: true } });
      return route.fulfill({ json: {} });
    });

    // 1. Setup explains why a key is needed and what a run costs, on phones too.
    await page.goto(base + '/issues');
    const setup = page.getByRole('complementary', { name: 'Account setup' });
    await setup.getByText('Set up how the AI agent is paid for', { exact: true }).waitFor();
    const why = setup.getByText(/each run stops at \$2\.00/);
    assert.equal(await why.isVisible(), true, `${width}: the cost explanation is visible`);
    assert.equal(await setup.getByText(/subscription/).count(), 0, 'no subscription is promised where only a key is offered');
    // Suggested issues go through the scanner's check, not straight to a run.
    await page.getByText('unassigned, with no linked pull request', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Fix issue', exact: true }).getAttribute('href'), '/issues?repo=acme%2Fcompiler&issue=72');
    await assertUsableControls(page, `${width} issues`);
    await assertAccessible(page, `${width} issues`);
    await page.goto(base + '/issues?repo=acme%2Fcompiler&issue=72');
    await page.getByText('Issue #72 is not in this scan', { exact: false }).waitFor();

    // 2. A preview is not a dead end: it says why it can't publish and offers the way forward.
    await page.goto(base + '/dispatches?dispatch=b-dry');
    await page.getByText(/so it can't be published/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Publish draft PR' }).count(), 0);
    await assertUsableControls(page, `${width} preview run`);
    await assertAccessible(page, `${width} preview run`);
    await page.getByRole('button', { name: 'Run again, ready to publish', exact: true }).click();
    await page.waitForURL('**/dispatches?dispatch=b-ready');
    assert.deepEqual(starts.at(-1), { repo_url: 'https://github.com/acme/app', issue_number: 1, dry_run: false }, 'the rerun is publishable and for the same issue');

    // 3. Before publishing: what will happen, in plain steps, with the words explained inline.
    const gate = page.getByRole('region', { name: 'Review before publishing' });
    await gate.getByRole('heading', { name: 'What happens when you publish', exact: true }).waitFor();
    await gate.getByText(/your own copy of the project on your GitHub account \(a fork\)/).waitFor();
    await gate.getByText(/signed off as the project asks/).waitFor();
    const fork = gate.getByRole('button', { name: /^fork/ });
    assert.equal(await fork.getAttribute('aria-expanded'), 'false');
    await fork.focus();
    await page.keyboard.press('Enter');
    assert.equal(await fork.getAttribute('aria-expanded'), 'true', 'the glossary opens by keyboard');
    await gate.getByRole('note').filter({ hasText: "You can't change someone else's project directly" }).waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await fork.getAttribute('aria-expanded'), 'false', 'and closes again');
    await gate.getByText('Not sure the maintainers want this? Ask on the issue first (optional)', { exact: true }).waitFor();
    await assertUsableControls(page, `${width} publish gate`);
    await assertAccessible(page, `${width} publish gate`);

    // 4. Publishing shows its result and what happens next, instead of nothing.
    await gate.getByRole('checkbox').check();
    await gate.getByRole('button', { name: 'Publish draft PR', exact: true }).click();
    await page.getByText('Draft PR #12 opened', { exact: true }).waitFor();
    assert.equal(publishes, 1);
    assert.equal(await page.getByRole('button', { name: 'Publish draft PR' }).count(), 0, 'no second publish button');
    await page.getByRole('heading', { name: 'What happens next', exact: true }).waitFor();
    await page.getByText(/click "Ready for review" there/).waitFor();
    await page.getByText("Don't chase people.", { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Follow it here', exact: true }).getAttribute('href'), '/prs/acme/app/12');
    await assertUsableControls(page, `${width} published`);
    await assertAccessible(page, `${width} published`);

    // 5. Where maintainers ask to discuss first, the drafted comment is the suggestion.
    await page.goto(base + '/dispatches?dispatch=b-ask');
    await page.getByText('Suggested instead: ask on the issue first.', { exact: false }).waitFor();

    // 6. The PR page: next steps on request, follow-up words explained, no internal names.
    await page.goto(base + '/prs/acme/app/12');
    const help = page.getByText('New to this? What happens next, and how to answer reviewers', { exact: true });
    await help.click();
    await page.getByText('After your pull request opens', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^CI/ }).first().click();
    await page.getByRole('note').filter({ hasText: 'automatic checks' }).waitFor();
    assert.equal(await page.getByText(/poller/).count(), 0, 'no internal names on the PR page');
    await page.getByText(/needs updating \(a rebase\)/).waitFor();
    await assertUsableControls(page, `${width} PR page`);
    await assertAccessible(page, `${width} PR page`);

    // 7. Plain words, one set of run buttons, nothing to pay twice for, and
    // controls a thumb can hit (40px on a phone).
    lists = true;
    async function thumbSized(locator, what) {
      const box = await locator.boundingBox();
      assert.ok(box, `${width}: ${what} is on screen`);
      const min = width === 390 ? 40 : 24;
      assert.ok(box.width >= min && box.height >= min, `${width}: ${what} is ${Math.round(box.width)}x${Math.round(box.height)}, under ${min}px`);
    }
    await page.goto(base + '/issues?repo=acme%2Fapp&issue=1');
    const row = page.locator('#issue-row-1');
    await row.getByText('Fix parser error', { exact: true }).waitFor();
    assert.deepEqual(await row.locator('.tag').allTextContents(), ['new', 'bug', 'good first issue'], 'a label that repeats the category is shown once');
    assert.equal(await row.getByRole('button', { name: 'Fix parser error' }).getAttribute('aria-expanded'), 'true');
    assert.equal(await row.getByRole('button', { name: 'Fix it (you review first)', exact: true }).count(), 1, 'an expanded row shows its run buttons once');
    assert.equal(await row.getByRole('button', { name: 'Preview patch', exact: true }).count(), 1);
    assert.equal(await row.getByText('one file', { exact: true }).count(), 1, 'the scope is in plain words');
    assert.equal(await row.getByText('leaf', { exact: true }).count(), 0);
    const anyTime = page.getByRole('button', { name: 'Any time', exact: true });
    assert.equal(await anyTime.evaluate(el => el.getBoundingClientRect().right <= el.closest('section').getBoundingClientRect().right), true, 'the Opened filters are not clipped');
    for (const [what, locator] of [
      ['Filters', page.getByRole('button', { name: 'Filters' })],
      ['a language chip', page.getByRole('button', { name: 'javascript', exact: true })],
      ['a label chip', page.getByRole('button', { name: 'Good first issue', exact: true })],
      ['the issue number link', row.getByRole('link', { name: /Open on GitHub/ })],
      ['Any time', anyTime],
      ['onboarding dismiss', page.getByRole('button', { name: 'Dismiss onboarding', exact: true })],
    ]) await thumbSized(locator, what);
    await assertUsableControls(page, `${width} scanned issues`);
    await assertAccessible(page, `${width} scanned issues`);

    await page.goto(base + '/trigger');
    const publishable = page.getByRole('button', { name: 'publishable (you review first)', exact: true });
    assert.equal(await publishable.getAttribute('aria-pressed'), 'true', 'new runs default to publishable');
    await page.getByText('Set up how runs are paid for in', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start publishable run', exact: true }).isDisabled(), true, 'no run starts without a payment method');
    assert.equal(await page.getByText(/start a worker/).count(), 0, 'no worker jargon');
    for (const [what, locator] of [
      ['the publishable toggle', publishable],
      ['the preview toggle', page.getByRole('button', { name: 'preview', exact: true })],
      ['the preview glossary button', page.getByRole('button', { name: /^preview.*what's this/ })],
      ['View run history', page.getByRole('link', { name: 'View run history', exact: true })],
    ]) await thumbSized(locator, what);
    await assertAccessible(page, `${width} new run`);

    await page.goto(base + '/dispatches?dispatch=b-ask');
    await page.getByText('Suggested instead: ask on the issue first.', { exact: false }).waitFor();
    assert.equal(await page.getByText('Pipelines', { exact: true }).count(), 0, 'the list is called Runs');
    assert.equal(await page.getByText('deep', { exact: true }).count(), 0, 'no unexplained deep chip');
    assert.equal(await page.locator('a[href="/dispatches?dispatch=b-dry"]').innerText().then(text => text.includes('b-dry')), false, 'no bare run ids on rows');
    await page.getByText('Run ID (for support):', { exact: false }).waitFor();
    const runLog = page.getByLabel('Run log', { exact: true });
    for (const name of ['Download report', 'Show terminal colors', 'Search log']) {
      const tool = page.getByRole('button', { name, exact: true });
      await thumbSized(tool, name);
      const [toolBox, logBox] = [await tool.boundingBox(), await runLog.boundingBox()];
      assert.ok(toolBox.y + toolBox.height <= logBox.y + 1 || toolBox.y >= logBox.y + logBox.height, `${width}: ${name} does not cover the log`);
    }
    const steps = await page.evaluate(() => [...document.querySelectorAll('span')]
      .filter(el => /^[✓○●×] (clone|explore|patch|test|PR)$/.test(el.textContent.trim()))
      .map(el => Math.round(el.getBoundingClientRect().height)));
    assert.equal(steps.length, 5);
    assert.ok(steps.every(height => height < 30), `${width}: each run step stays on one line (${steps})`);
    await thumbSized(page.getByRole('button', { name: 'copy comment', exact: true }), 'copy comment');
    await assertUsableControls(page, `${width} runs`);
    await assertAccessible(page, `${width} runs`);

    await page.goto(base + '/prs');
    await page.getByText('Needs your action', { exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: 'Needs your action' }).count(), 0, 'no x glyph that reads as a close button');
    await page.getByText(/a quick fix looks at the file being discussed; a deep fix explores the whole project first/).waitFor();
    assert.equal(await page.getByText('Dashboard PRs', { exact: true }).count(), 0);
    for (const name of [/^Inbox/, /^All PRs/, /^Opened with opensrcer/]) await thumbSized(page.getByRole('tab', { name }), `the ${name} tab`);
    await assertAccessible(page, `${width} pull requests`);

    reposReply = 'error';
    await page.goto(base + '/repos');
    const failure = page.getByRole('alert').filter({ hasText: "Couldn't load your repos from GitHub." });
    await failure.waitFor();
    assert.equal(await failure.getByText('Internal server error').count(), 0, 'a bare server error is not shown as the message');
    const retry = failure.getByRole('button', { name: 'Retry', exact: true });
    await thumbSized(retry, 'Retry');
    await assertAccessible(page, `${width} repos error`);
    reposReply = 'empty';
    await retry.click();
    await page.getByText('No repos here yet.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Find a beginner issue', exact: true }).getAttribute('href'), '/issues');
    assert.equal(await page.getByRole('link', { name: 'Discover projects', exact: true }).getAttribute('href'), '/discover');
    await assertAccessible(page, `${width} repos empty`);

    assert.deepEqual(errors, [], `client errors ${width}`);
    await context.close();
  }
  console.log(JSON.stringify({ beginnerPath: true, viewports: [1440, 390], accessibility: 'serious-and-critical' }));
} finally { await browser.close(); }
