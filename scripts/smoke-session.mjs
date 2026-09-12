// Exercise real session decryption and settings routes using local-only fake credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { encrypt } from '../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js';
const require = createRequire(import.meta.url);
const { prepareSession, GITHUB_TOKEN_CLAIM } = require('../.test-build/lib/auth-session.js');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Session fixtures are local-only');
const secret = process.env.AUTH0_SECRET;
assert.equal(secret, 'ci-build-only-not-a-real-secret', 'Use the isolated CI server configuration');
const now = Math.floor(Date.now() / 1000);
async function sessionCookie(owner, github = true) {
  const session = await prepareSession({
    user: { sub: owner, name: owner, ...(github ? { [GITHUB_TOKEN_CLAIM]: 'test-github-value' } : {}) },
    tokenSet: { accessToken: 'test-auth0-value', expiresAt: now + 3600 },
    internal: { sid: owner, createdAt: now },
  });
  return '__session=' + await encrypt(session, secret, now + 3600);
}
const alice = await sessionCookie('session-smoke-alice');
const bob = await sessionCookie('session-smoke-bob');
async function request(path, cookie, options = {}) {
  return fetch(base + path, {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { cookie, 'content-type': 'application/json', ...options.headers },
  });
}
const profile = await request('/auth/profile', alice);
assert.equal(profile.status, 200);
assert.deepEqual(await profile.json(), { sub: 'session-smoke-alice', name: 'session-smoke-alice' });
const saved = await request('/api/settings/keys', alice, {
  method: 'POST', body: JSON.stringify({ anthropic: 'test-provider-value', maxSpendUsd: 0.1 }),
});
assert.equal(saved.status, 200);
assert.deepEqual(await saved.json(), { ok: true, anthropic: true, gemini: false, maxSpendUsd: 0.1 });
const keyHeader = saved.headers.getSetCookie().find(value => value.startsWith('opensrcer-keys='));
assert.ok(keyHeader);
assert.match(keyHeader, /httponly/i);
assert.match(keyHeader, /secure/i);
assert.match(keyHeader, /samesite=lax/i);
assert.ok(!keyHeader.includes('test-provider-value'));
const keys = keyHeader.split(';')[0];
const own = await request('/api/settings/keys', alice + '; ' + keys);
assert.equal(own.status, 200);
assert.equal((await own.json()).anthropic, true);
const other = await request('/api/settings/keys', bob + '; ' + keys);
assert.equal(other.status, 200);
assert.equal((await other.json()).anthropic, false, 'An account cannot reuse another account\'s key cookie');
const activity = await request('/api/activity', alice);
assert.equal(activity.status, 200);
assert.equal((await activity.json()).dispatches, 0);
const generatedPrs = await request('/api/prs', alice);
assert.equal(generatedPrs.status, 200);
assert.deepEqual(await generatedPrs.json(), []);
const createdShare = await request('/api/fixes', alice, {
  method: 'POST', body: JSON.stringify({ repo: 'acme/app', fix_response: 'Use a bounded parser.', diff: '--- a/parser.ts\n+++ b/parser.ts\n' }),
});
assert.equal(createdShare.status, 200);
const share = await createdShare.json();
assert.match(share.id, /^s_\d{13}_[a-f0-9]{32}_[a-f0-9]{32}$/);
const publicShare = await request(`/api/fixes/${share.id}`, '');
assert.equal(publicShare.status, 200);
assert.equal((await publicShare.json()).fix_response, 'Use a bounded parser.');
rmSync(`.fixes/${share.id}.json`, { force: true });
for (const path of ['/api/settings/keys', '/api/explore', '/api/fixes', '/api/prs/fix', '/api/prs/reply', '/api/prs/draft-reply', '/api/prs/verify', '/api/prs/push', '/api/crucible/run/agentic', '/api/run/agentic', '/api/graph/query', '/api/graph/generate']) {
  const invalid = await request(path, alice, { method: 'POST', body: 'null' });
  assert.equal(invalid.status, 400, path + ' must reject invalid JSON values without crashing');
  await invalid.text();
}
const cleared = await request('/api/settings/keys', alice + '; ' + keys, { method: 'DELETE' });
assert.equal(cleared.status, 200);
assert.ok(cleared.headers.getSetCookie().some(value => value.startsWith('opensrcer-keys=;')));
const withoutGithub = await sessionCookie('session-smoke-no-github', false);
const live = await request('/api/run/agentic', withoutGithub, {
  method: 'POST', body: JSON.stringify({ repo_url: 'https://github.com/acme/app', issue_number: 1, dry_run: false }),
});
assert.equal(live.status, 401);
assert.match((await live.json()).message, /Sign in with GitHub/);
console.log(JSON.stringify({ realSessionDecryption: true, privateProfile: true, settingsRoundTrip: true, accountIsolation: true, activityAndPrHistory: true, publicShareRoundTrip: true }));
