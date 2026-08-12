// Environment for every subprocess we spawn.
//
// The old pattern was `{ ...process.env }` followed by `delete` of three
// keys. That is a denylist, and it missed everything that matters:
// AUTH0_SECRET (which decrypts every user's stored API keys),
// GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, AUTH0_CLIENT_SECRET.
// A subprocess that can read its own environment — which `claude` can, via
// Bash — could hand all of them to whoever wrote the issue it was solving.
//
// So: allowlist. Only the vars a child genuinely needs to find its
// interpreter, its home directory, and its network egress, plus whatever
// the caller injects explicitly.
//
// ponytail: PASSTHROUGH is a flat list. If a new tool needs a var, add it
// here rather than reaching for process.env at the call site.

const PASSTHROUGH = [
  // Process/tool discovery. Without PATH nothing spawns at all.
  "PATH",
  "Path", // Windows is case-insensitive but Node's env object is not
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  // Node itself.
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "NVM_DIR",
  // Corporate proxies — omitting these breaks egress on some networks.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // Windows: APPDATA/LOCALAPPDATA are where npm, gh and claude keep config.
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramData",
  // Our own non-secret tuning knobs, read by child tooling.
  "OPENSRCER_CACHE_DIR",
  "GH_CLI",
  // git must never wait on an interactive credential prompt in headless mode.
  "GIT_TERMINAL_PROMPT",
] as const;

/** Build a subprocess environment from an allowlist plus explicit injections.
 *
 *  `inject` is where credentials go — the caller passes exactly the tokens
 *  this one child is entitled to. Undefined values are dropped so callers
 *  can write `{ GITHUB_TOKEN: maybeToken }` without a branch. */
export function childEnv(
  inject: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  // Built as a plain record, not a ProcessEnv: Next.js augments ProcessEnv
  // with a required, read-only NODE_ENV, which an allowlist can't satisfy by
  // construction. The shape spawn() actually wants is a string map.
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  for (const [k, v] of Object.entries(inject)) {
    if (v !== undefined && v !== "") env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

/** Environment for a `gh` CLI subprocess acting as one specific user.
 *
 *  Dropping the deployer's GITHUB_TOKEN out of the environment is only half
 *  the job: gh also reads a stored credential from its config directory
 *  (~/.config/gh, or %APPDATA%\GitHub CLI). On a deployed instance that
 *  credential is the operator's, so a request from a user whose session
 *  carries no GitHub token would quietly act as the operator instead of
 *  failing. Pointing GH_CONFIG_DIR at an empty directory removes the
 *  fallback, so gh authenticates with `token` or not at all.
 *
 *  Passing a null/undefined token is legitimate — the caller gets an
 *  unauthenticated gh, which still serves public reads at a lower rate
 *  limit — it just no longer silently borrows someone else's identity. */
export function ghEnv(
  token: string | null | undefined,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const tmp = process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? "/tmp";
  return childEnv({
    GH_TOKEN: token ?? undefined,
    GITHUB_TOKEN: token ?? undefined,
    GH_CONFIG_DIR: `${tmp}/opensrcer-gh-nocreds`,
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_PAGER: "cat",
    ...extra,
  });
}
