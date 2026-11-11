// Starts the installed VS Code with this extension in development mode, a throwaway
// profile and no other extensions, runs suite.js inside it, and prints its checks.
//   node test/vscode/run.mjs [path to Code.exe / code binary]
// (VSCODE_PATH works too.) Nothing is downloaded and your own profile isn't touched.
// TIMEOUT_MS (default 10 minutes) bounds the run; a slow machine needs the room.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "..", "..");
const guesses = [
  process.argv[2], process.env.VSCODE_PATH,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", "/usr/share/code/code",
].filter(Boolean);
const code = guesses.find((p) => existsSync(p));
if (!code) { console.error(`VS Code not found; pass its binary. Tried: ${guesses.join(", ")}`); process.exit(2); }

const tmp = mkdtempSync(join(tmpdir(), "opensrcer-vscode-test-"));
const out = join(tmp, "results.json");
const args = [
  `--extensionDevelopmentPath=${ext}`, `--extensionTestsPath=${join(here, "suite.js")}`,
  `--user-data-dir=${join(tmp, "user")}`, `--extensions-dir=${join(tmp, "extensions")}`,
  "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--new-window",
];
const env = { ...process.env, OPENSRCER_TEST_OUT: out };
delete env.ELECTRON_RUN_AS_NODE;
// VS Code's own output goes to a file, not an inherited pipe: its helper processes
// would hold a pipe open after it's gone.
const log = join(tmp, "code-output.log");
const fd = openSync(log, "w");
const started = Date.now();
const child = spawn(code, args, { env, stdio: ["ignore", fd, fd] });
console.log(`VS Code pid ${child.pid}, profile ${tmp}`);

const timeoutMs = Number(process.env.TIMEOUT_MS || 600_000);
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`VS Code didn't finish in ${timeoutMs / 1000} s: closing it`);
  // The whole tree: the window, its extension host and the servers it started.
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGKILL");
}, timeoutMs);

child.on("exit", (status) => {
  clearTimeout(timer);
  const results = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : [];
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? `\n       ${r.detail.replace(/\n/g, "\n       ")}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  const finished = results.some((r) => r.name === "info: suite finished");
  console.log(`\n${results.length - failed}/${results.length} checks passed (VS Code exit ${status}${timedOut ? ", timed out" : ""}${finished ? "" : ", suite did NOT finish"})`);
  console.log(`took ${Math.round((Date.now() - started) / 1000)} s`);
  closeSync(fd);
  if (!finished) console.log(`VS Code's output (last 40 lines):\n${readFileSync(log, "utf8").split("\n").slice(-40).join("\n")}`);
  // KEEP=1 leaves the profile (its logs/ say why VS Code stopped).
  if (process.env.KEEP) console.log(`profile kept: ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  process.exit(failed || status || !finished ? 1 : 0);
});
