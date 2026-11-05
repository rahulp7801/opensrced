#!/usr/bin/env node
// opensrcer harness: an MCP server (stdio, newline-delimited JSON-RPC 2.0)
// with no dependencies, so the plugin works straight from a git checkout.
//
// Tools:
//   repo_profile  — a project's unwritten rules, measured from its PRs
//   record_event  — tell opensrcer what happened (counted on your account)
//
// Configuration (environment):
//   OPENSRCER_TOKEN  a harness token from https://opensrced.vercel.app/account
//   OPENSRCER_URL    defaults to https://opensrced.vercel.app

import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const BASE = (process.env.OPENSRCER_URL || "https://opensrced.vercel.app").replace(/\/+$/, "");
const TOKEN = process.env.OPENSRCER_TOKEN || "";
const EVENT_TYPES = ["session_start", "verification", "pr_opened", "pr_merged", "pr_closed"];
// GitHub's rules: owners are letters, digits and hyphens; names can't be "." or "..".
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

const TOOLS = [
  {
    name: "repo_profile",
    description:
      "How an open-source project actually reviews contributions, measured from its own recent pull requests: what share of outside contributors' PRs get merged, why PRs get closed (e.g. opened without being assigned, discuss first, duplicate), what reviewers keep asking for, how fast maintainers respond, and house conventions (title style, changelog location, sign-off). Call it before changing code in a repository you don't maintain, and follow what it says.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string", description: "The GitHub repository as owner/name, e.g. pandas-dev/pandas." } },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "record_event",
    description:
      "Tell opensrcer what happened in this contribution, for the user's stats: a verification result (the new test fails without the fix and passes with it), or a pull request opened, merged or closed. Never include secrets or code.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: EVENT_TYPES },
        repo: { type: "string", description: "owner/name" },
        pr_url: { type: "string", description: "The pull request's GitHub URL, for pr_* events." },
        outcome: { type: "string", description: "For verification: verified, failed or inconclusive." },
      },
      required: ["type", "repo"],
      additionalProperties: false,
    },
  },
];

class ToolError extends Error {}

async function api(path, init = {}) {
  if (!TOKEN) throw new ToolError(`No opensrcer token. Create one at ${BASE}/account (Harness), then set OPENSRCER_TOKEN and restart Claude Code.`);
  let res;
  try {
    res = await fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new ToolError(`Could not reach ${BASE}: ${error instanceof Error ? error.message : error}`);
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ToolError(typeof body.error === "string" ? body.error : `opensrcer answered ${res.status}.`);
  return body;
}

function profileText(body) {
  const p = body.profile;
  const lines = [`# ${p.repo}: how this project reviews contributions`, ""];
  if (!body.findings.length) lines.push("Too few recent pull requests to say anything reliable yet.");
  const titles = { outcomes: "Outcomes for outside contributors", closed: "Why PRs get closed", review: "What reviewers ask for", pace: "Pace", conventions: "Conventions" };
  for (const [section, title] of Object.entries(titles)) {
    const items = body.findings.filter((f) => f.section === section);
    if (!items.length) continue;
    lines.push(`## ${title}`);
    for (const f of items) lines.push(`- ${f.text}${f.examples.length ? ` (e.g. ${f.examples.join(", ")})` : ""}`);
    lines.push("");
  }
  lines.push(`Measured from ${p.window.prs} PRs opened ${String(p.window.from).slice(0, 10)} to ${String(p.window.to).slice(0, 10)}. Full page: ${body.page}`);
  return lines.join("\n");
}

async function callTool(name, args) {
  const repo = typeof args?.repo === "string" ? args.repo.trim() : "";
  if (!REPO.test(repo)) throw new ToolError("repo must be owner/name, e.g. pandas-dev/pandas.");
  if (name === "repo_profile") {
    const body = await api(`/api/harness/profile?repo=${encodeURIComponent(repo)}`);
    return profileText(body);
  }
  if (name === "record_event") {
    if (!EVENT_TYPES.includes(args.type)) throw new ToolError(`type must be one of ${EVENT_TYPES.join(", ")}.`);
    const data = {};
    if (typeof args.pr_url === "string" && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/.test(args.pr_url)) data.pr_url = args.pr_url;
    if (typeof args.outcome === "string") data.outcome = args.outcome.slice(0, 40);
    await api("/api/harness/events", { method: "POST", body: JSON.stringify({ type: args.type, repo, data }) });
    return `Recorded ${args.type} for ${repo}.`;
  }
  throw new ToolError(`Unknown tool: ${name}`);
}

async function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      return { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "opensrcer", version: VERSION } };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      try {
        return { content: [{ type: "text", text: await callTool(params?.name, params?.arguments ?? {}) }] };
      } catch (error) {
        if (error instanceof ToolError) return { content: [{ type: "text", text: error.message }], isError: true };
        throw error;
      }
    default:
      if (id === undefined) return undefined; // a notification: no reply
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...payload }) + "\n");

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "Parse error" } }); }
  try {
    const result = await handle(message);
    if (message.id !== undefined && result !== undefined) send({ id: message.id, result });
  } catch (error) {
    if (message.id !== undefined) send({ id: message.id, error: { code: error.code ?? -32603, message: error instanceof Error ? error.message : String(error) } });
  }
});
