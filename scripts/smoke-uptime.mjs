// Light production check for the scheduled uptime workflow (.github/workflows/uptime.yml).
// About seven requests, none to rate-limited routes, so it can run every 30 minutes.
// A failed run is the alert: GitHub emails the repository owner.
// Usage: SMOKE_BASE_URL=https://opensrced.vercel.app node scripts/smoke-uptime.mjs
import assert from 'node:assert/strict';

const base = process.env.SMOKE_BASE_URL || 'https://opensrced.vercel.app';
const timings = {};

async function get(path, init = {}) {
  const start = performance.now();
  const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });
  timings[path.split('?')[0]] = Math.round(performance.now() - start);
  return response;
}

// Up, and every hosted dependency configured (a deleted env var shows up here first).
const health = await get('/api/health');
assert.equal(health.status, 200, 'health endpoint');
const body = await health.json();
assert.equal(body.status, 'ok', `health is ${body.status}; missing: ${(body.missing ?? []).join(', ')}`);

// Public pages render the current product.
const landing = await get('/');
assert.equal(landing.status, 200, 'landing page');
assert.match(await landing.text(), /Pull requests out\./, 'landing page content');
const privacy = await get('/privacy');
assert.equal(privacy.status, 200, 'privacy page');
await privacy.text();
const card = await get('/opengraph-image');
assert.equal(card.status, 200, 'share card');
assert.equal(card.headers.get('content-type'), 'image/png', 'share card type');
await card.arrayBuffer();

// The auth gate holds, and a forged sign-in callback still lands on the login page.
const api = await get('/api/dispatches');
assert.equal(api.status, 401, 'anonymous API access must be refused');
await api.text();
const callback = await get('/auth/callback?code=forged&state=forged');
assert.ok([302, 303, 307].includes(callback.status), `callback error must redirect, got ${callback.status}`);
assert.match(callback.headers.get('location') ?? '', /\/login\?error=signin$/);
await callback.text();

console.log(JSON.stringify({ ok: true, base, ms: timings }));
