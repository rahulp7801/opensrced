import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import assert from 'node:assert/strict';

const root = mkdtempSync(join(tmpdir(), 'opensrcer-graph-smoke-'));
try {
  const source = join(root, 'source');
  const output = join(root, 'output');
  mkdirSync(source);
  writeFileSync(join(source, 'example.py'), "def greet(name):\n    return 'hello ' + name\n\ndef main():\n    return greet('world')\n");
  execFileSync(process.env.OPENSRCER_GRAPH_PYTHON || 'python', ['-I', '-m', 'graphify', 'update', '.'], { cwd: source, env: { ...process.env, GRAPHIFY_OUT: output }, timeout: 60_000, stdio: 'pipe' });
  const graph = JSON.parse(readFileSync(join(output, 'graph.json'), 'utf8'));
  assert.ok(graph.nodes.some(node => node.label.includes('greet')));
  assert.ok(graph.links.some(edge => edge.relation === 'calls'));
  assert.ok(readFileSync(join(output, 'graph.html'), 'utf8').includes('vis-network@9.1.6'));
  console.log(JSON.stringify({ nodes: graph.nodes.length, edges: graph.links.length, html: true }));
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('opensrcer-graph-smoke-'));
  rmSync(root, { recursive: true, force: true });
}
