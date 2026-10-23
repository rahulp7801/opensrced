// Inspect a Codex run's real tool surface with the exact invocation
// lib/agent-invocation.ts builds. No ChatGPT plan is used: model traffic goes
// to a loopback stub. The stub asks for two apply_patch writes (outside and
// inside the run's cwd); the read-only sandbox must refuse both.
//
//   OPENSRCER_CODEX_BIN=/path/to/codex node scripts/smoke-codex-tools.mjs
//   (Windows: point it at codex.exe, not the npm codex.cmd shim)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { buildAgentInvocation } = require('../.test-build/lib/agent-invocation.js');

const home = mkdtempSync(join(tmpdir(), 'opensrcer-codex-test-'));
mkdirSync(join(home, '.codex'));
const outside = join(home, 'outside-canary.txt').replaceAll('\\', '/');
const usage = { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 };
const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const patch = (path, n) => ({ type: 'response.output_item.done', item: { type: 'custom_tool_call', id: `ctc_${n}`, call_id: `call_${n}`, name: 'apply_patch', status: 'completed', input: `*** Begin Patch\n*** Add File: ${path}\n+pwned\n*** End Patch\n` } });

let invocation, inside;
const requests = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; }).on('end', () => {
    requests.push(JSON.parse(body));
    const id = `resp_${requests.length}`;
    const items = requests.length === 1
      ? [patch(outside, 1), patch(inside, 2)]
      : [{ type: 'response.output_item.done', item: { type: 'message', role: 'assistant', id: `msg_${id}`, content: [{ type: 'output_text', text: 'done' }] } }];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sse([{ type: 'response.created', response: { id } }, ...items, { type: 'response.completed', response: { id, usage } }]));
  });
});
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  invocation = buildAgentInvocation({
    provider: 'codex-subscription', prompt: 'Make the files.', mcpConfig: resolve('.mcp.json'),
    inject: { OPENSRCER_ALLOWED_REPO: 'acme/app' }, budgetUsd: 0.01, maxTurns: 1,
  });
  inside = join(invocation.cwd, 'inside-canary.txt').replaceAll('\\', '/');
  const prompt = invocation.args.pop();
  const args = [...invocation.args,
    '-c', 'model_provider="probe"', '-c', `model_providers.probe.base_url="http://127.0.0.1:${server.address().port}/v1"`,
    '-c', 'model_providers.probe.name="probe"', '-c', 'model_providers.probe.wire_api="responses"',
    '-c', 'model_providers.probe.env_key="PROBE_KEY"', '-c', 'model_providers.probe.request_max_retries=0',
    '-c', 'model_providers.probe.stream_max_retries=0', '-m', 'gpt-5.5', prompt];
  const env = { ...invocation.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), PROBE_KEY: 'probe' };
  writeFileSync(join(home, '.codex', 'AGENTS.md'), 'user-level instructions (loaded by Codex from CODEX_HOME)');
  const child = spawn(process.env.OPENSRCER_CODEX_BIN || invocation.bin, args, { env, cwd: invocation.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('codex timed out')); }, 180000);
    child.once('error', reject);
    child.once('exit', c => { clearTimeout(timer); resolve(c); });
  });
  assert.equal(code, 0);
  const tools = requests[0].tools.map(t => t.name ?? t.type).sort();
  // Measured with codex-cli 0.164: the remaining built-ins cannot run commands,
  // read local files, or write (apply_patch is refused below).
  assert.deepEqual(tools, ['apply_patch', 'list_mcp_resource_templates', 'list_mcp_resources', 'read_mcp_resource', 'request_user_input', 'tool_search']);
  const search = requests[0].tools.find(t => t.type === 'tool_search');
  assert.match(search.description, /opensrcer-repo-tools/);
  assert.equal(requests[0].store, false);
  const outputs = requests[1].input.filter(item => item.type === 'custom_tool_call_output').map(item => item.output);
  assert.equal(outputs.length, 2);
  for (const output of outputs) assert.match(output, /rejected/);
  assert.ok(!existsSync(outside) && !existsSync(inside), 'read-only sandbox refused both writes');
  console.log(JSON.stringify({ tools, patches: 'rejected', outside: existsSync(outside), inside: existsSync(inside) }));
} finally {
  invocation?.cleanup();
  server.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
