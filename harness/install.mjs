// `npx -y opensrcer-mcp install`: adds opensrcer to VS Code (GitHub Copilot)
// in one step, in any shell. Writes the user's VS Code mcp.json the way
// `code --add-mcp` does (servers + inputs), with the token as a password
// input that VS Code asks for when the server first starts. Quoting JSON on
// a command line breaks in Windows PowerShell; writing the file doesn't.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SITE = "https://opensrced.vercel.app";
const INPUT = { type: "promptString", id: "opensrcer-token", description: `Your opensrcer token (create one at ${SITE}/account, Harness)`, password: true };
const SERVER = { type: "stdio", command: "npx", args: ["-y", "opensrcer-mcp@latest"], env: { OPENSRCER_TOKEN: "${input:opensrcer-token}" } };

/** VS Code's user settings folder on this OS (stable channel). Exported for tests. */
export function vscodeUserDir(env = process.env, platform = process.platform, home = homedir()) {
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Code", "User");
  if (platform === "darwin") return join(home, "Library", "Application Support", "Code", "User");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "Code", "User");
}

/** The config with opensrcer added (or replaced), every other server and input kept. Pure. */
export function withOpensrcer(config) {
  const servers = { ...(config.servers ?? {}), opensrcer: SERVER };
  const inputs = [...(Array.isArray(config.inputs) ? config.inputs : []).filter((i) => i?.id !== INPUT.id), INPUT];
  return { ...config, servers, inputs };
}

const manual = (why) => [
  why,
  "Add it by hand instead: in VS Code, run \"MCP: Open User Configuration\" and add this under \"servers\" (and the input under \"inputs\"):",
  JSON.stringify({ servers: { opensrcer: SERVER }, inputs: [INPUT] }, null, 2),
].join("\n\n");

/** Returns [exit code, message]. Never overwrites a file it can't read as JSON. */
export function install(dir = vscodeUserDir()) {
  if (!existsSync(dir)) return [1, manual(`VS Code's settings folder isn't here (${dir}). Install VS Code from https://code.visualstudio.com and open it once, then run this again.`)];
  const file = join(dir, "mcp.json");
  let config = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return [1, manual(`${file} has comments or other text this installer won't rewrite, so it was left as it is.`)];
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) return [1, manual(`${file} isn't a settings object, so it was left as it is.`)];
    copyFileSync(file, `${file}.bak`);
  }
  writeFileSync(file, JSON.stringify(withOpensrcer(config), null, 2) + "\n");
  return [0, [
    `Added opensrcer to VS Code (${file}).`,
    "",
    "Next:",
    `1. Create a token at ${SITE}/account (Harness) and copy it.`,
    "2. In VS Code, open Copilot Chat in Agent mode. When opensrcer starts, VS Code asks for the token: paste it there (it's stored securely).",
    "3. Ask: \"Check my opensrcer setup.\" Then: \"Teach me issue 429 in pallets/itsdangerous.\"",
  ].join("\n")];
}
