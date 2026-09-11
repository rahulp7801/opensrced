import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileTool } from '../dist/tools.js';
import { traceFlowTool } from '../dist/graph.js';

test('cached source and graphs require current GitHub access, separately for each credential', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opensrcer-access-'));
  const keys = ['OPENSRCER_CACHE_DIR', 'OPENSRCER_ALLOWED_REPO', 'OPENSRCER_REPO_REF', 'GITHUB_TOKEN'];
  const previous = keys.map(key => process.env[key]);
  let now = Date.now(), requests = 0, revoked = false;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.github.com/repos/owner/private');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const allowed = options.headers.Authorization === 'Bearer test-alice' && !revoked;
    return Response.json({}, { status: allowed ? 200 : 404 });
  });
  try {
    process.env.OPENSRCER_CACHE_DIR = root;
    process.env.OPENSRCER_ALLOWED_REPO = 'owner/private';
    delete process.env.OPENSRCER_REPO_REF;
    process.env.GITHUB_TOKEN = 'test-alice';
    const repo = path.join(root, 'owner__private');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await writeFile(path.join(repo, 'source.txt'), 'private test fixture');
    const args = { repo: 'owner/private', path: 'source.txt' };
    const results = await Promise.all(Array.from({ length: 10 }, () => readFileTool(args)));
    assert.ok(results.every(result => result.includes('private test fixture')));
    assert.equal(requests, 1, 'parallel tools share the authorization check');
    process.env.GITHUB_TOKEN = 'test-bob';
    await assert.rejects(readFileTool(args), /not accessible/);
    await assert.rejects(traceFlowTool('owner/private', 'secret'), /not accessible/);
    delete process.env.GITHUB_TOKEN;
    await assert.rejects(readFileTool(args), /not accessible/);
    process.env.GITHUB_TOKEN = 'test-alice';
    revoked = true;
    now += 61_000;
    await assert.rejects(readFileTool(args), /not accessible/);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('opensrcer-access-'));
    await rm(root, { recursive: true, force: true });
  }
});
