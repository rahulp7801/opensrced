import assert from 'node:assert/strict';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';

async function request(path) {
  return fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
}

for (const path of ['/', '/demo', '/login']) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} should remain available`);
  assert.equal(response.headers.get('x-auth'), 'not-configured', `${path} should report missing auth`);
}

const login = await request('/login');
const loginHtml = await login.text();
assert.match(loginHtml, /Sign-in is being configured/);
assert.doesNotMatch(loginHtml, /href="\/auth\/login/);

const health = await request('/api/health');
assert.equal(health.status, 200);
const healthJson = await health.json();
assert.equal(healthJson.status, 'degraded');
assert.equal(healthJson.deps.auth0_config, false);
assert.ok(healthJson.missing.includes('auth0_config'));

for (const path of ['/api/activity', '/auth/login']) {
  const response = await request(path);
  assert.equal(response.status, 503, `${path} should fail predictably`);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await response.json(), { error: 'Authentication is not configured for this deployment.' });
}

console.log(JSON.stringify({ publicPages: 3, health: 'degraded', protectedStatus: 503 }));
