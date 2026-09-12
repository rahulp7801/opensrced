import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const paths = ['/', '/login', '/trigger', '/issues', '/dispatches', '/stats'];
const securityHeaders = {
  'content-security-policy': "frame-ancestors 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
};
for (const path of paths) {
  const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, path);
  for (const [name, value] of Object.entries(securityHeaders)) {
    const actual = response.headers.get(name);
    if (name === 'content-security-policy') {
      assert.ok(actual?.includes(value), `${path} ${name}`);
      assert.ok(!actual.includes("'unsafe-eval'"), `${path} must not allow unsafe-eval in production`);
    }
    else assert.equal(actual, value, `${path} ${name}`);
  }
  assert.equal(response.headers.get('x-powered-by'), null, `${path} must not disclose its framework`);
  await response.text();
}
for (const path of ['/api/dispatches', '/api/settings/keys', '/api/activity', '/api/local-profile']) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 401, path);
  await response.text();
}
for (const headers of [{}, {'next-router-prefetch': '1'}, {'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware'}]) {
  const response = await fetch(base + '/api/run/agentic', { method: 'POST', headers, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 401, 'anonymous mutation must be blocked');
  await response.text();
}
const missingFixId = '00000000-0000-4000-8000-000000000000';
const missingFix = await fetch(`${base}/api/fixes/${missingFixId}`, { signal: AbortSignal.timeout(15000) });
assert.equal(missingFix.status, 404);
assert.equal(missingFix.headers.get('cache-control'), 'private, no-store');
assert.equal(missingFix.headers.get('x-robots-tag'), 'noindex, nofollow');
await missingFix.text();
const sharedFixPage = await fetch(`${base}/fix/${missingFixId}`, { signal: AbortSignal.timeout(15000) });
assert.equal(sharedFixPage.status, 200);
assert.match(await sharedFixPage.text(), /<meta name="robots" content="noindex, nofollow"/);

const robots = await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(15000) });
assert.equal(robots.status, 200);
const robotsText = await robots.text();
assert.match(robotsText, /Disallow: \/api\//);
const sitemapUrl = robotsText.match(/^Sitemap: (https?:\/\/\S+)$/m)?.[1];
assert.ok(sitemapUrl, "robots.txt must advertise an absolute sitemap URL");
const metadataOrigin = new URL(sitemapUrl).origin;
assert.equal(new URL(sitemapUrl).pathname, "/sitemap.xml");
const sitemap = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
assert.equal(sitemap.status, 200);
const sitemapText = await sitemap.text();
const escapedOrigin = metadataOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
assert.match(sitemapText, new RegExp(`<loc>${escapedOrigin}</loc>`));
assert.match(sitemapText, new RegExp(`<loc>${escapedOrigin}/demo</loc>`));
assert.doesNotMatch(sitemapText, /\/fix\//);

const privateCruciblePage = await fetch(`${base}/crucible/orgs/smoke-test`, {
  redirect: 'manual',
  signal: AbortSignal.timeout(15000),
});
assert.equal(privateCruciblePage.status, 307);
const privateCrucibleLocation = new URL(privateCruciblePage.headers.get('location'), base);
assert.equal(privateCrucibleLocation.pathname, '/login');
assert.equal(privateCrucibleLocation.searchParams.get('returnTo'), '/crucible/orgs/smoke-test');
await privateCruciblePage.text();

async function load(path, expectedStatus, requests, concurrency) {
  const latencies = [];
  let completed = 0;
  await Promise.all(Array.from({length: concurrency}, async (_, worker) => {
    for (let i = worker; i < requests; i += concurrency) {
      const start = performance.now();
      const response = await fetch(base + path, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, expectedStatus, path);
      await response.arrayBuffer();
      latencies.push(performance.now() - start);
      completed++;
    }
  }));
  latencies.sort((a, b) => a - b);
  return {
    requests: completed,
    p50Ms: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
    p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    maxMs: Math.round(latencies.at(-1)),
  };
}

const [landingLoad, authBoundaryLoad] = await Promise.all([
  load('/', 200, 60, 12),
  load('/api/dispatches', 401, 60, 12),
]);
const latencies = [];
let count = 0;
await Promise.all(Array.from({length: 20}, async () => {
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const response = await fetch(base + '/api/health', {signal: AbortSignal.timeout(15000)});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(['ok', 'degraded'].includes(body.status));
    assert.equal(body.deps.auth0_config, true, 'health must verify Auth0 configuration');
    latencies.push(performance.now() - start);
    count++;
  }
}));
latencies.sort((a,b) => a-b);
console.log(JSON.stringify({pages: paths.length, protectedRequests: 8, landingLoad, authBoundaryLoad, healthRequests: count, concurrency: 20, healthP50Ms: Math.round(latencies[100]), healthP95Ms: Math.round(latencies[190]), healthMaxMs: Math.round(latencies.at(-1))}));
