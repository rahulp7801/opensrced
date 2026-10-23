// Workspace tools: the agent's way into the exec box (scripts/exec-server.cjs
// in the parent repo). Registered only when the dispatcher started a box and
// passed its capability in OPENSRCER_EXEC_URL / OPENSRCER_EXEC_TOKEN.
//
// This process never executes repository code itself. It forwards a tool
// call to the box over HTTP and formats the answer; the box holds no
// credential, so whatever runs there cannot reach the GitHub token this
// server holds for cloning.

const OUTPUT_CAP = 60_000;

export type ExecConfig = { url: string; token: string };

/** The box capability, read once and removed from the environment so the git
 *  processes this server spawns never inherit it. */
export function takeExecConfig(env: NodeJS.ProcessEnv = process.env): ExecConfig | null {
  const url = env.OPENSRCER_EXEC_URL, token = env.OPENSRCER_EXEC_TOKEN;
  delete env.OPENSRCER_EXEC_URL;
  delete env.OPENSRCER_EXEC_TOKEN;
  if (!url || !token) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("OPENSRCER_EXEC_URL must be http(s)");
  return { url, token };
}

async function call<T>(cfg: ExecConfig, route: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(new URL(route, cfg.url), {
    method: "POST",
    // identity: the hosted exec VM's port route compresses (and so buffers)
    // a response when the client accepts gzip, which would hold back the
    // headers and heartbeats of a long /run past fetch's 300 s headers timeout.
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", "Accept-Encoding": "identity" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({ error: `box returned HTTP ${res.status}` }))) as T & { error?: string };
  // A streamed answer (/run: headers at once, then heartbeats) reports a late
  // failure as 200 + {error}.
  if (!res.ok || typeof json.error === "string") throw new Error(json.error ?? `box returned HTTP ${res.status}`);
  return json;
}

export async function boxReadFile(cfg: ExecConfig, args: { path: string; line_start?: number; line_end?: number }): Promise<string> {
  const r = await call<{ start: number; end: number; total: number; lines: string[] }>(cfg, "/read", args, 60_000);
  const width = String(r.end).length;
  const numbered = r.lines.map((l, i) => `${String(r.start + i).padStart(width, " ")}│ ${l}`).join("\n");
  const text = `# ${args.path} (lines ${r.start}-${r.end} of ${r.total})\n${numbered}`;
  return text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}\n[…truncated; pass line_start/line_end]` : text;
}

export async function boxWriteFile(cfg: ExecConfig, args: { path: string; content: string }): Promise<string> {
  const r = await call<{ bytes: number }>(cfg, "/write", args, 60_000);
  return `Wrote ${args.path} (${r.bytes} bytes).`;
}

export async function boxEditFile(
  cfg: ExecConfig,
  args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
): Promise<string> {
  const r = await call<{ replacements: number }>(cfg, "/edit", args, 60_000);
  return `Edited ${args.path} (${r.replacements} replacement${r.replacements === 1 ? "" : "s"}).`;
}

export async function boxRunCommand(cfg: ExecConfig, args: { command: string; timeout_s?: number }): Promise<string> {
  const timeoutMs = args.timeout_s ? Math.round(args.timeout_s * 1000) : undefined;
  // The HTTP wait outlives the command so the box reports its own timeout.
  const wait = (timeoutMs ?? 30 * 60_000) + 60_000;
  const r = await call<{ exit_code: number | null; timed_out: boolean; duration_ms: number; output: string; budget_left_ms: number }>(
    cfg, "/run", { command: args.command, ...(timeoutMs ? { timeout_ms: timeoutMs } : {}) }, wait,
  );
  const status = r.timed_out ? "TIMED OUT (process tree killed)" : `exit=${r.exit_code}`;
  return `$ ${args.command}\n${status} · ${(r.duration_ms / 1000).toFixed(1)}s · command time left ${Math.round(r.budget_left_ms / 1000)}s\n${r.output}`;
}
