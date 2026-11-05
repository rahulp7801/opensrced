// Invite-only preview: what anonymous, signed-in-but-not-invited and invited
// visitors can reach. Run against a server BUILT and started with
// OPENSRCER_ACCESS=invite OPENSRCER_INVITED_GITHUB_IDS=4242 and the CI Auth0
// settings (the landing page and layout are prerendered, so the mode is fixed
// at build time). Sessions are forged with the local-only CI secret.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encrypt } from '../node_modules/@auth0/nextjs-auth0/dist/server/cookies.js';
const require = createRequire(import.meta.url);
const { prepareSession } = require('../.test-build/lib/auth-session.js');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3100';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Session fixtures are local-only');
const secret = process.env.AUTH0_SECRET;
assert.equal(secret, 'ci-build-only-not-a-real-secret', 'Use the isolated CI server configuration');
const now = Math.floor(Date.now() / 1000);
async function sessionCookie(sub) {
  const session = await prepareSession({
    user: { sub, name: sub },
    tokenSet: { accessToken: 'test-auth0-value', expiresAt: now + 3600 },
    internal: { sid: sub, createdAt: now },
  });
  return '__session=' + await encrypt(session, secret, now + 3600);
}
const invited = await sessionCookie('github|4242');
const outsider = await sessionCookie('github|1111');
async function request(path, cookie = '', options = {}) {
  const response = await fetch(base + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json', origin: base, ...options.headers } });
  const text = await response.text();
  return { status: response.status, location: response.headers.get('location') ?? '', text };
}
const redirectsTo = (r, path) => [302, 303, 307, 308].includes(r.status) && new URL(r.location, base).pathname + new URL(r.location, base).search === path;

// Anonymous: the teaser, sign-in, privacy and shared fixes only.
const home = await request('/');
assert.equal(home.status, 200);
assert.match(home.text, /Private preview/);
assert.match(home.text, /Pick an issue/, 'the teaser says how it works');
// A path no route serves is a real 404, not a sign-in wall.
for (const path of ['/nope', '/terms']) assert.equal((await request(path)).status, 404, path);
assert.match(home.text, /Pull requests out\./);
assert.doesNotMatch(home.text, /One place for the whole contribution/, 'the full landing page stays private');
for (const path of ['/login', '/privacy', '/demo/stage']) assert.equal((await request(path)).status, 200, path);
// /demo is the demo's old address: it forwards to the stage demo.
assert.ok(redirectsTo(await request('/demo'), '/demo/stage'), '/demo forwards to the stage demo');
assert.match(home.text, /href="\/demo\/stage"/, 'the teaser links to the demo');
for (const path of ['/discover', '/issues', '/dispatches', '/crucible', '/graph', '/prs/acme/app/1']) {
  const r = await request(path);
  assert.ok([302, 303, 307].includes(r.status) && new URL(r.location, base).pathname === '/login', `${path} must ask for sign-in, got ${r.status} ${r.location}`);
}
assert.equal((await request('/api/dispatches')).status, 401);
assert.deepEqual(JSON.parse((await request('/api/access')).text), { inviteOnly: true, signedIn: false, invited: false });
const sitemap = await request('/sitemap.xml');
assert.match(sitemap.text, /\/demo\/stage</, 'the public demo is in the sitemap');

// Signed in without an invite: told it is invite-only, and owns nothing.
assert.deepEqual(JSON.parse((await request('/api/access', outsider)).text), { inviteOnly: true, signedIn: true, invited: false });
assert.equal((await request('/demo/stage', outsider)).status, 200, 'the demo is public to everyone');
for (const path of ['/discover', '/crucible', '/login']) {
  assert.ok(redirectsTo(await request(path, outsider), '/?access=invite-only'), `${path} must send an outsider to the preview page`);
}
for (const path of ['/api/dispatches', '/api/settings/keys', '/api/activity', '/api/prs']) {
  assert.equal((await request(path, outsider)).status, 403, path);
}
const share = await request('/api/fixes', outsider, { method: 'POST', body: JSON.stringify({ repo: 'acme/app', fix_response: 'x', diff: '--- a/x\n+++ b/x\n' }) });
assert.ok([401, 403].includes(share.status), `an outsider cannot create shared fixes, got ${share.status}`);
const run = await request('/api/run/agentic', outsider, { method: 'POST', body: JSON.stringify({ repo_url: 'https://github.com/acme/app', issue_number: 1, dry_run: true }) });
assert.equal(run.status, 403, 'an outsider cannot start runs');

// Invited: the app as usual.
assert.deepEqual(JSON.parse((await request('/api/access', invited)).text), { inviteOnly: true, signedIn: true, invited: true });
assert.equal((await request('/discover', invited)).status, 200);
assert.equal((await request('/api/dispatches', invited)).status, 200);
assert.equal((await request('/api/settings/keys', invited)).status, 200);
assert.ok(redirectsTo(await request('/login', invited), '/discover'), 'an invited account goes straight to the app');

// The harness: personal tokens, never a way around the invite.
const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const malformed = await request('/api/harness/profile?repo=acme/app', '', bearer('not-a-token'));
assert.equal(malformed.status, 401, 'a malformed token stops at the session gate');
const unknownToken = await request('/api/harness/events', '', { method: 'POST', body: '{}', ...bearer(`osh_${'a'.repeat(32)}`) });
assert.equal(unknownToken.status, 401, 'an unknown token is refused by the route');
assert.match(unknownToken.text, /not valid/);
assert.equal((await request('/api/me/tokens', outsider, { method: 'POST', body: JSON.stringify({ name: 'x' }) })).status, 403, 'an outsider cannot create tokens');
const made = await request('/api/me/tokens', invited, { method: 'POST', body: JSON.stringify({ name: 'smoke' }) });
assert.equal(made.status, 201);
const { token, id } = JSON.parse(made.text);
const event = await request('/api/harness/events', '', { method: 'POST', body: JSON.stringify({ type: 'pr_opened', repo: 'acme/app' }), ...bearer(token) });
assert.equal(event.status, 204, 'an invited account\'s token records events');
assert.equal((await request(`/api/me/tokens/${id}`, invited, { method: 'DELETE' })).status, 204);
assert.equal((await request('/api/harness/events', '', { method: 'POST', body: JSON.stringify({ type: 'pr_opened', repo: 'acme/app' }), ...bearer(token) })).status, 401, 'a revoked token stops at once');

console.log(JSON.stringify({ anonymous: 'teaser only', outsider: 'redirected and refused', invited: 'full app', harness: 'token-gated' }));
