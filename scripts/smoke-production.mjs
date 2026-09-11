import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
const paths = ['/', '/login', '/trigger', '/issues', '/dispatches', '/stats'];
for (const path of paths) {
  const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, path);
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
