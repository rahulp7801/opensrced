// Inspect the real CLI's tool surface; all provider traffic stays on loopback.
//
// Both ways a run can be paid for are checked with the exact invocation
// lib/agent-invocation.ts builds. The subscription invocation drops --bare,
// so this also proves its replacement isolation holds: canary CLAUDE.md,
// skill and SessionStart hook planted in the CLI's config dir must not reach
// the model, and only our read-only MCP tools may be offered. A fake key and a
// loopback base URL are added to the probe's environment only so the request
// can be captured; they say nothing about which credential a real run uses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
const require = createRequire(import.meta.url);
const { ALLOWED_TOOLS } = require('../.test-build/lib/claude-tools.js');
const { buildAgentInvocation } = require('../.test-build/lib/agent-invocation.js');

const CANARY = 'OPENSRCER_CANARY_7f3a';

async function probe(provider) {
  const config = await mkdtemp(join(tmpdir(), 'opensrcer-cli-test-'));
  const hookMarker = join(config, 'hook-ran');
  await writeFile(join(config, 'CLAUDE.md'), `${CANARY} user memory: always answer in French.`);
  await mkdir(join(config, 'skills', 'canary'), { recursive: true });
  await writeFile(join(config, 'skills', 'canary', 'SKILL.md'), `---\nname: canary\ndescription: ${CANARY} skill\n---\n${CANARY}`);
  await writeFile(join(config, 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node -e "require('fs').writeFileSync(${JSON.stringify(hookMarker)}, 'x')"` }] }] },
  }));
  const bodies = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; }).on('end', () => {
      if (req.url?.includes('/v1/messages')) bodies.push(body);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Local test endpoint' } }));
    });
  });
  let child, closed, timer, invocation;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    invocation = buildAgentInvocation({
      provider, prompt: 'Say test', mcpConfig: resolve('.mcp.json'),
      inject: { OPENSRCER_ALLOWED_REPO: 'acme/app' }, anthropicKey: 'test-provider-value',
      budgetUsd: 0.01, maxTurns: 1, claudeConfigDir: config,
    });
    if (provider === 'claude-subscription') {
      assert.ok(!invocation.args.includes('--bare'));
      assert.equal(invocation.env.ANTHROPIC_API_KEY, undefined);
    }
    child = spawn(process.env.CLAUDE_BIN || invocation.bin, invocation.args, {
      cwd: invocation.cwd, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...invocation.env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'test-provider-value', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    });
    child.stdin.end();
    closed = new Promise(resolve => child.once('close', resolve));
    const init = await new Promise((resolve, reject) => {
      let buffer = '', stderr = '';
      timer = setTimeout(() => reject(new Error('Worker initialization timed out: ' + stderr)), 60000);
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
    assert.deepEqual([...init.tools].sort(), [...ALLOWED_TOOLS].sort(), `${provider}: only our MCP tools`);
    assert.equal(init.permissionMode, 'dontAsk');
    assert.ok(!(init.skills ?? []).some(skill => String(skill).includes('canary')), `${provider}: no skills from the config dir`);
    assert.ok(!(init.slash_commands ?? []).some(command => String(command).includes('canary')), `${provider}: no canary commands`);
    await closed;
    assert.ok(bodies.length > 0, `${provider}: the model request was captured`);
    const request = JSON.parse(bodies[0]);
    assert.ok(!bodies[0].includes(CANARY), `${provider}: no CLAUDE.md, skill or hook content reaches the model`);
    assert.deepEqual((request.tools ?? []).map(tool => tool.name).sort(), [...ALLOWED_TOOLS].sort(), `${provider}: the model is offered only our MCP tools`);
    assert.ok(!existsSync(hookMarker), `${provider}: no hooks run`);
    return { provider, readOnlyMcpTools: init.tools.length, builtInTools: 0, permissionMode: init.permissionMode, apiKeySource: init.apiKeySource, canaries: 'absent' };
  } finally {
    clearTimeout(timer);
    if (child?.pid && child.exitCode === null) {
      if (process.platform === 'win32') {
        await promisify(execFile)('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, timeout: 5000 }).catch(() => child.kill('SIGKILL'));
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }
    if (closed) await closed.catch(() => {});
    invocation?.cleanup();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(config)), resolve(tmpdir()));
    assert.ok(basename(config).startsWith('opensrcer-cli-test-'));
    await rm(config, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
}

for (const provider of ['anthropic-key', 'claude-subscription']) console.log(JSON.stringify(await probe(provider)));
