import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { boxEditFile, boxReadFile, boxRunCommand, takeExecConfig } from '../dist/exec-tools.js';

test('takeExecConfig removes the capability from the environment', () => {
  const env = { OPENSRCER_EXEC_URL: 'http://127.0.0.1:1', OPENSRCER_EXEC_TOKEN: 'tok', OTHER: 'x' };
  assert.deepEqual(takeExecConfig(env), { url: 'http://127.0.0.1:1', token: 'tok' });
  assert.equal(env.OPENSRCER_EXEC_URL, undefined);
  assert.equal(env.OPENSRCER_EXEC_TOKEN, undefined);
  assert.equal(takeExecConfig({}), null);
  assert.throws(() => takeExecConfig({ OPENSRCER_EXEC_URL: 'file:///etc', OPENSRCER_EXEC_TOKEN: 't' }), /http/);
});

test('box tools forward the bearer token and surface box errors', async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/run') return reply(200, { exit_code: 1, timed_out: false, duration_ms: 1500, output: 'FAILED test_x', budget_left_ms: 60000 });
    if (req.url === '/read') return reply(200, { start: 1, end: 2, total: 2, lines: ['a', 'b'] });
    return reply(400, { error: 'old_string not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cfg = { url: `http://127.0.0.1:${server.address().port}`, token: 'secret-token' };
  try {
    const out = await boxRunCommand(cfg, { command: 'pytest -x', timeout_s: 5 });
    assert.match(out, /^\$ pytest -x\nexit=1 · 1\.5s/);
    assert.match(out, /FAILED test_x/);
    assert.equal(seen[0].body.timeout_ms, 5000);
    assert.equal(seen[0].body.verify, undefined, 'the agent can never mark its own run as a verification');
    assert.equal(seen[0].auth, 'Bearer secret-token');
    assert.match(await boxReadFile(cfg, { path: 'f.py' }), /1│ a\n2│ b/);
    await assert.rejects(boxEditFile(cfg, { path: 'f.py', old_string: 'x', new_string: 'y' }), /old_string not found/);
  } finally {
    server.close();
  }
});

test('a streamed /run (headers first, whitespace heartbeats, then JSON) is read, asks for no compression, and a late error surfaces', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers['accept-encoding']);
    const first = seen.length === 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(' ');
    setTimeout(() => res.write('   '), 20);
    setTimeout(() => res.end(first
      ? JSON.stringify({ exit_code: 0, timed_out: false, duration_ms: 40, output: 'ok', budget_left_ms: 1000 })
      : JSON.stringify({ error: 'spawn failed' })), 40);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cfg = { url: `http://127.0.0.1:${server.address().port}`, token: 't' };
  try {
    assert.match(await boxRunCommand(cfg, { command: 'true' }), /exit=0/);
    assert.equal(seen[0], 'identity');
    await assert.rejects(boxRunCommand(cfg, { command: 'true' }), /spawn failed/);
  } finally {
    server.close();
  }
});
