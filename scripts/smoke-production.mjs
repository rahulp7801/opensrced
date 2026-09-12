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
  for (const [name, value] of Object.entries(securityHeaders)) assert.equal(response.headers.get(name), value, `${path} ${name}`);
  await response.text();
}
for (const path of ['/api/dispatches', '/api/settings/keys', '/api/activity']) {
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
const latencies = [];
let count = 0;
await Promise.all(Array.from({length: 20}, async () => {
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const response = await fetch(base + '/api/health', {signal: AbortSignal.timeout(15000)});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(['ok', 'degraded'].includes(body.status));
    latencies.push(performance.now() - start);
    count++;
  }
}));
latencies.sort((a,b) => a-b);
console.log(JSON.stringify({pages: paths.length, protectedRequests: 6, healthRequests: count, concurrency: 20, healthP50Ms: Math.round(latencies[100]), healthP95Ms: Math.round(latencies[190]), healthMaxMs: Math.round(latencies.at(-1))}));
