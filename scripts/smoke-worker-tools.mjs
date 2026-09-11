// Inspect the real CLI's tool surface; all provider traffic stays on loopback.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
const require = createRequire(import.meta.url);
const { READ_ONLY_CLAUDE_ARGS, ALLOWED_TOOLS } = require('../.test-build/lib/claude-tools.js');
const { childEnv } = require('../.test-build/lib/child-env.js');
const config = await mkdtemp(join(tmpdir(), 'opensrcer-cli-test-'));
const server = createServer((req, res) => {
  req.resume();
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Local test endpoint' } }));
});
let child, closed, timer;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  child = spawn(process.env.CLAUDE_BIN || 'claude', [
    '-p', 'Say test', '--mcp-config', resolve('.mcp.json'), ...READ_ONLY_CLAUDE_ARGS,
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
  ], { windowsHide: true, detached: process.platform !== 'win32', env: childEnv({
    ANTHROPIC_API_KEY: 'test-provider-value',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    OPENSRCER_ALLOWED_REPO: 'acme/app',
  }) });
  closed = new Promise(resolve => child.once('close', resolve));
  const init = await new Promise((resolve, reject) => {
    let buffer = '', stderr = '';
    timer = setTimeout(() => reject(new Error('Worker initialization timed out: ' + stderr)), 30000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
    child.once('error', reject);
    child.once('close', () => reject(new Error('Worker exited before initialization: ' + stderr)));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'system' && event.subtype === 'init') resolve(event);
      }
    });
  });
  assert.deepEqual([...init.tools].sort(), [...ALLOWED_TOOLS].sort());
  assert.equal(init.permissionMode, 'dontAsk');
  console.log(JSON.stringify({ readOnlyMcpTools: init.tools.length, builtInTools: 0, permissionMode: init.permissionMode }));
} finally {
  clearTimeout(timer);
  if (child?.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      await promisify(execFile)('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, timeout: 5000 }).catch(() => child.kill('SIGKILL'));
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  }
  if (closed) await closed;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.equal(dirname(resolve(config)), resolve(tmpdir()));
  assert.ok(basename(config).startsWith('opensrcer-cli-test-'));
  await rm(config, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
}
