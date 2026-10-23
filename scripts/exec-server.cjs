// Exec box server. Runs INSIDE the credential-free box (a Docker container
// locally, a separate Sandbox VM when hosted, or a scrubbed host process
// under the explicit `host` opt-in) and owns a private copy of the target
// repository at EXEC_ROOT. The agent reaches it only through the MCP tools in
// mcp-server/src/exec-tools.ts; the dispatcher reaches it through
// lib/exec-box.ts. See PLAN.md (contrib-engine) for the threat model.
//
// Zero dependencies on purpose: it is mounted read-only into a stock image
// and must start without an install step.
//
// Every request carries `Authorization: Bearer $EXEC_TOKEN`. The token is a
// capability for this one box, so the repository code running here could
// read it from the environment without gaining anything; it is still
// removed from the environment that commands inherit.
//
// Endpoints (JSON in, JSON out unless noted):
//   GET  /health                       status, budget used
//   POST /init   (tar.gz body)         unpack the repo, commit a baseline
//   POST /read   {path, line_start?, line_end?}
//   POST /write  {path, content}
//   POST /edit   {path, old_string, new_string, replace_all?}
//   POST /run    {command, timeout_ms?}
//   POST /diff                         patch of the box against the baseline

'use strict';
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN = process.env.EXEC_TOKEN || '';
const ROOT = path.resolve(process.env.EXEC_ROOT || '/work');
const PORT = Number(process.env.EXEC_PORT || 7070);
const HOST = process.env.EXEC_HOST || '0.0.0.0';
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const CMD_TIMEOUT_MS = num('EXEC_CMD_TIMEOUT_MS', 10 * 60_000);
const TOTAL_MS = num('EXEC_TOTAL_MS', 45 * 60_000);
const OUTPUT_BYTES = num('EXEC_OUTPUT_BYTES', 64 * 1024);
const MAX_LIFETIME_MS = num('EXEC_MAX_LIFETIME_MS', 90 * 60_000);
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;

if (TOKEN.length < 32) {
  process.stderr.write('exec-server: EXEC_TOKEN must be at least 32 chars\n');
  process.exit(2);
}
for (const key of Object.keys(process.env)) if (key.startsWith('EXEC_')) delete process.env[key];

// Directories and caches that tools create but that are never part of a fix.
const EXCLUDES = [
  '.venv/', 'venv/', 'node_modules/', '__pycache__/', '*.pyc', '.pytest_cache/', '.mypy_cache/',
  '.ruff_cache/', '*.egg-info/', '.eggs/', '.tox/', '.nox/', '.cache/', '.coverage', 'coverage/',
  '.opensrcer/',
];

let initialized = false;
let usedMs = 0;
const running = new Set();

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'pipe' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function shutdown(code) {
  for (const child of running) killTree(child);
  process.exit(code);
}
// Self-destruct, so a host that crashed mid-run leaves no box behind
// (docker runs it with --rm, so the container goes with it).
setTimeout(() => shutdown(0), MAX_LIFETIME_MS).unref();
process.on('SIGTERM', () => shutdown(0));

/** Resolve a repo-relative path inside ROOT. Rejects absolute paths, `..`,
 *  Git metadata and symlinked components, so a tool call cannot touch the
 *  baseline repository or anything outside the checkout. */
function contained(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 4096 || /[\0:]/.test(rel) || path.isAbsolute(rel) || /^[\\/]/.test(rel)) {
    throw new HttpError(400, 'path must be repository-relative');
  }
  const parts = rel.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..' || /^\.git[ .]*$/i.test(p))) throw new HttpError(400, 'path must refer to repository source');
  let current = ROOT;
  for (const part of parts) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new HttpError(400, 'path crosses a symlink'); }
    catch (error) { if (error instanceof HttpError) throw error; if (error.code !== 'ENOENT') throw error; }
  }
  if (current === ROOT) throw new HttpError(400, 'path must name a file');
  return current;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function requireInit() {
  if (!initialized) throw new HttpError(409, 'box is not initialized');
}

/** Keep the head and the tail of long output: the tail of a test run is
 *  where the verdict is, the head is where setup failed. */
function capOutput(text) {
  if (Buffer.byteLength(text) <= OUTPUT_BYTES) return { output: text, truncated: false };
  const half = Math.floor(OUTPUT_BYTES / 2);
  const omitted = Buffer.byteLength(text) - 2 * half;
  return { output: `${text.slice(0, half)}\n\n[... ${omitted} bytes omitted ...]\n\n${text.slice(-half)}`, truncated: true };
}

function runShell(command, timeoutMs, input) {
  return new Promise((resolve) => {
    const started = Date.now();
    const shell = process.platform === 'win32' ? 'bash.exe' : 'bash';
    const child = spawn(shell, ['-c', command], {
      cwd: ROOT,
      env: { ...process.env, CI: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONUNBUFFERED: '1', GIT_TERMINAL_PROMPT: '0' },
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    running.add(child);
    // Hold at most 4x the cap in memory; capOutput trims to the cap.
    const limit = OUTPUT_BYTES * 4;
    let head = '';
    let tail = '';
    let total = 0;
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      total += chunk.length;
      if (head.length < limit / 2) head += s.slice(0, limit / 2 - head.length);
      else tail = (tail + s).slice(-limit / 2);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    if (input) { child.stdin.on('error', () => {}); input.pipe(child.stdin); }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const finish = (exitCode, signal, spawnError) => {
      clearTimeout(timer);
      running.delete(child);
      const durationMs = Date.now() - started;
      const joined = tail ? `${head}\n[... ${total - head.length - tail.length} bytes omitted ...]\n${tail}` : head;
      resolve({ exit_code: exitCode, signal: signal || null, timed_out: timedOut, duration_ms: durationMs,
        ...capOutput(spawnError ? `${joined}\n${spawnError}` : joined) });
    };
    child.on('error', (error) => finish(null, null, `spawn failed: ${error.message}`));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, 'request too large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

const handlers = {
  'GET /health': async () => ({ ok: true, initialized, used_ms: usedMs, budget_ms: TOTAL_MS }),

  'POST /init': async (req) => {
    if (initialized) throw new HttpError(409, 'box is already initialized');
    fs.mkdirSync(ROOT, { recursive: true });
    if (fs.readdirSync(ROOT).length > 0) throw new HttpError(409, 'box root is not empty');
    const unpack = await runShell('tar -xzf - -C .', CMD_TIMEOUT_MS, req);
    if (unpack.exit_code !== 0) throw new HttpError(400, `could not unpack repository: ${unpack.output.slice(-500)}`);
    // A baseline commit inside the box, so `git diff` and pre-commit work for
    // the agent and /diff is exact. This repository is box-local; nothing on
    // the host ever runs Git against it.
    // -f: the archive holds exactly the tracked files, including any that
    // upstream force-added past its own .gitignore.
    const base = await runShell(
      // autocrlf off: byte-exact working tree even when the host backend's
      // global Git config (Git for Windows) would convert line endings.
      'git init -q && git config core.autocrlf false && git add -A -f && ' +
      'git -c user.name=opensrcer -c user.email=opensrcer@localhost commit -q --no-verify -m baseline && git rev-parse HEAD',
      CMD_TIMEOUT_MS,
    );
    if (base.exit_code !== 0) throw new HttpError(500, `baseline commit failed: ${base.output.slice(-500)}`);
    fs.mkdirSync(path.join(ROOT, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, '.git', 'info', 'exclude'), `${EXCLUDES.join('\n')}\n`);
    initialized = true;
    return { ok: true, baseline: base.output.trim().split('\n').pop() };
  },

  'POST /read': async (req) => {
    requireInit();
    const body = await readJson(req);
    const abs = contained(body.path);
    let stat;
    try { stat = fs.statSync(abs); } catch { throw new HttpError(404, `no such file: ${body.path}`); }
    if (!stat.isFile()) throw new HttpError(400, `not a file: ${body.path}`);
    if (stat.size > MAX_READ_BYTES) throw new HttpError(413, `file exceeds the 2 MB read limit: ${body.path}`);
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    const start = Math.max(1, Number.isSafeInteger(body.line_start) ? body.line_start : 1);
    const end = Math.min(lines.length, Number.isSafeInteger(body.line_end) ? body.line_end : lines.length);
    return { path: body.path, start, end, total: lines.length, lines: lines.slice(start - 1, end) };
  },

  'POST /write': async (req) => {
    requireInit();
    const body = await readJson(req);
    if (typeof body.content !== 'string') throw new HttpError(400, 'content must be a string');
    const abs = contained(body.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body.content);
    return { ok: true, path: body.path, bytes: Buffer.byteLength(body.content) };
  },

  'POST /edit': async (req) => {
    requireInit();
    const body = await readJson(req);
    if (typeof body.old_string !== 'string' || !body.old_string || typeof body.new_string !== 'string') {
      throw new HttpError(400, 'old_string (non-empty) and new_string must be strings');
    }
    if (body.old_string === body.new_string) throw new HttpError(400, 'old_string and new_string are identical');
    const abs = contained(body.path);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { throw new HttpError(404, `no such file: ${body.path}`); }
    const count = text.split(body.old_string).length - 1;
    if (count === 0) throw new HttpError(400, 'old_string not found; read the file again and copy the text exactly');
    if (count > 1 && body.replace_all !== true) throw new HttpError(400, `old_string occurs ${count} times; add surrounding context or pass replace_all`);
    fs.writeFileSync(abs, text.split(body.old_string).join(body.new_string));
    return { ok: true, path: body.path, replacements: body.replace_all === true ? count : 1 };
  },

  'POST /run': async (req) => {
    requireInit();
    const body = await readJson(req);
    if (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 20_000) {
      throw new HttpError(400, 'command must be a non-empty string');
    }
    // The host's verification re-runs (verify: true; the agent's MCP tool
    // never sets it) are bounded per command but do not draw on the agent's
    // budget, so an agent that used its time up still gets verified.
    const verify = body.verify === true;
    const remaining = verify ? CMD_TIMEOUT_MS : TOTAL_MS - usedMs;
    if (remaining <= 0) throw new HttpError(429, `the box's total command time (${Math.round(TOTAL_MS / 1000)}s) is used up`);
    const asked = Number.isSafeInteger(body.timeout_ms) && body.timeout_ms > 0 ? body.timeout_ms : CMD_TIMEOUT_MS;
    const timeout = Math.min(asked, CMD_TIMEOUT_MS, remaining);
    const result = await runShell(body.command, timeout);
    if (!verify) usedMs += result.duration_ms;
    return { ...result, timeout_ms: timeout, budget_left_ms: Math.max(0, TOTAL_MS - usedMs) };
  },

  'POST /diff': async () => {
    requireInit();
    // Stage everything (honoring .gitignore and our excludes), diff against
    // the baseline, then unstage so the agent's own `git diff` keeps working.
    const result = await runShell(
      'git add -A && git -c core.quotepath=off diff --cached --binary --no-color --no-ext-diff HEAD; s=$?; git reset -q; exit $s',
      CMD_TIMEOUT_MS,
    );
    if (result.exit_code !== 0 || result.truncated) throw new HttpError(500, result.truncated ? 'patch exceeds the output limit' : `diff failed: ${result.output.slice(-500)}`);
    return { patch: result.output };
  },
};

const server = http.createServer(async (req, res) => {
  const send = (status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };
  try {
    const auth = String(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${TOKEN}`);
    const given = Buffer.from(auth);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(401, 'unauthorized');
    const handler = handlers[`${req.method} ${(req.url || '').split('?')[0]}`];
    if (!handler) throw new HttpError(404, 'no such endpoint');
    send(200, await handler(req));
  } catch (error) {
    send(error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) });
  }
});
// /run can legitimately take many minutes.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
// EXEC_PORT=0 picks a free port (host backend); the host reads it from here.
server.listen(PORT, HOST, () => process.stdout.write(`exec-server ready on ${HOST}:${server.address().port}\n`));
