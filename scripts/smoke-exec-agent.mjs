// A scripted stand-in for `claude -p`, for end-to-end checks of everything
// around the model: the dispatcher spawns it through buildAgentInvocation
// (OPENSRCER_AGENT_BIN=node + this script via OPENSRCER_AGENT_ARGS), it
// starts the real MCP server from --mcp-config with the env it was given,
// calls the real tools in the order a plan file lists, and prints Claude
// Code's stream-json events. No model, no spend.
//
// Plan: .dispatches/smoke-plan.json  { "steps": [{ "tool", "args" }], "final": "<answer>" }
// The `repo` argument is filled in from OPENSRCER_ALLOWED_REPO.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const sdk = (p) => pathToFileURL(path.join(root, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', p)).href;
const { Client } = await import(sdk('client/index.js'));
const { StdioClientTransport } = await import(sdk('client/stdio.js'));

const argv = process.argv.slice(2);
const config = JSON.parse(readFileSync(argv[argv.indexOf('--mcp-config') + 1], 'utf8')).mcpServers['opensrcer-repo-tools'];
// The agent runs from an empty per-run directory; the plan lives in the app root.
const plan = JSON.parse(readFileSync(path.join(root, '.dispatches', 'smoke-plan.json'), 'utf8'));
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const transport = new StdioClientTransport({ command: config.command, args: config.args, env: process.env, stderr: 'ignore' });
const client = new Client({ name: 'smoke-exec-agent', version: '1' });
await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name);
emit({ type: 'assistant', message: { content: [{ type: 'text', text: `[smoke-agent] tools offered: ${tools.join(', ')}\n` }] } });
let failed = 0;
for (const step of plan.steps) {
  const args = { repo: process.env.OPENSRCER_ALLOWED_REPO, ...step.args };
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: `mcp__opensrcer-repo-tools__${step.tool}`, input: args }] } });
  const result = await client.callTool({ name: step.tool, arguments: args }, undefined, { timeout: 30 * 60_000 });
  const text = (result.content ?? []).map((c) => c.text ?? '').join('');
  if (result.isError) failed++;
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: `\n[smoke-agent] ${step.tool} ${result.isError ? 'ERROR' : 'ok'}: ${text.slice(0, 600)}\n` }] } });
}
await client.close();
emit({ type: 'assistant', message: { content: [{ type: 'text', text: `\n${plan.final}\n` }] } });
emit({ type: 'result', subtype: failed ? 'error_during_execution' : 'success', is_error: failed > 0, total_cost_usd: 0, num_turns: plan.steps.length });
process.exit(0);
