// opensrcer for VS Code: registers opensrcer's MCP server with VS Code (so GitHub
// Copilot's agent mode gets its tools with no config file and no Node install),
// keeps the token in VS Code's secret storage, and shows the lesson's code map
// in a tab beside the editor, redrawn as the lesson goes.

"use strict";

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { TokenFormatError, cleanToken, siteUrl, serverLaunch, describeMe, mapHtml, parseMap, parseIssue } = require("./core");

const SECRET = "opensrcer.token";
const PROVIDER = "opensrcer";

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  const changed = new vscode.EventEmitter();
  const mapDir = path.join(context.globalStorageUri.fsPath, "maps");
  fs.mkdirSync(mapDir, { recursive: true });
  const serverPath = path.join(context.extensionPath, "server", "server.mjs");
  const version = context.extension.packageJSON.version;

  const settings = () => vscode.workspace.getConfiguration("opensrcer");
  const url = () => siteUrl(settings().get("url"));
  const token = async () => (await context.secrets.get(SECRET)) || "";

  async function definition() {
    const launch = serverLaunch({ execPath: process.execPath, serverPath, token: await token(), url: url(), mapDir, graphPython: settings().get("graphPython") });
    return new vscode.McpStdioServerDefinition("opensrcer", launch.command, launch.args, launch.env, version);
  }

  // ── The MCP server ────────────────────────────────────────────────────
  context.subscriptions.push(changed, vscode.lm.registerMcpServerDefinitionProvider(PROVIDER, {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: async () => [await definition()],
    // Just before VS Code starts it: without a token, offer to sign in. Declining still
    // starts the server, so setup_check can say what's missing.
    resolveMcpServerDefinition: async (server) => {
      if (await token()) return server;
      const pick = await vscode.window.showInformationMessage("opensrcer needs you to sign in before its tools can work.", "Sign in");
      if (pick === "Sign in" && await signIn()) return definition();
      return server;
    },
  }));

  // ── Sign in and out ───────────────────────────────────────────────────
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.command = "opensrcer.menu";
  context.subscriptions.push(status);
  async function refresh() {
    const signedIn = Boolean(await token());
    await vscode.commands.executeCommand("setContext", "opensrcer.signedIn", signedIn);
    status.text = signedIn ? "$(mortar-board) opensrcer" : "$(mortar-board) opensrcer: Sign in";
    status.tooltip = signedIn ? "opensrcer: learn an issue, check your setup, show the code map" : "Sign in to opensrcer";
    status.show();
  }
  context.subscriptions.push(context.secrets.onDidChange(async (e) => {
    if (e.key !== SECRET) return;
    await refresh();
    changed.fire(); // VS Code restarts the server with the new token
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("opensrcer")) changed.fire();
  }));

  /** Checks a token with the site, then stores it. Returns whether one was stored. */
  async function saveToken(raw) {
    const value = cleanToken(raw);
    let verdict;
    try {
      const res = await fetch(`${url()}/api/harness/me`, { headers: { authorization: `Bearer ${value}` }, signal: AbortSignal.timeout(20_000) });
      verdict = describeMe(res.status, await res.json().catch(() => ({})));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      verdict = { ok: false, text: `Couldn't reach ${url()} to check the token (${error.message}). It's saved; run "opensrcer: Check my setup" once you're online.` };
    }
    if (verdict.rejected) throw new TokenFormatError(verdict.text);
    await context.secrets.store(SECRET, value);
    return verdict;
  }

  async function signIn() {
    await vscode.env.openExternal(vscode.Uri.parse(`${url()}/account#harness-heading`));
    const raw = await vscode.window.showInputBox({
      title: "Sign in to opensrcer",
      prompt: "On the page that just opened, under Harness, create a token and paste it here.",
      placeHolder: "osh_…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (text) => {
        try { cleanToken(text); return null; } catch (error) {
          if (error instanceof TokenFormatError) return text ? error.message : null;
          throw error;
        }
      },
    });
    if (raw === undefined) return false;
    try {
      const verdict = await saveToken(raw);
      if (verdict.ok) {
        vscode.window.showInformationMessage(`${verdict.text} Ask Copilot (Agent mode) to teach you an issue.`, "Learn an issue")
          .then((pick) => pick && vscode.commands.executeCommand("opensrcer.startLesson"));
      } else {
        vscode.window.showWarningMessage(verdict.text, "Open opensrcer")
          .then((pick) => pick && vscode.env.openExternal(vscode.Uri.parse(url())));
      }
      return true;
    } catch (error) {
      if (!(error instanceof TokenFormatError)) throw error;
      vscode.window.showErrorMessage(error.message);
      return false;
    }
  }

  // ── Chat shortcuts ────────────────────────────────────────────────────
  async function askCopilot(query) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", { query, mode: "agent" });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      vscode.window.showErrorMessage(`Couldn't open Copilot Chat (${error.message}). Install GitHub Copilot Chat, sign in, then try again.`);
    }
  }

  async function startLesson() {
    if (!(await token()) && !(await signIn())) return;
    const issue = await vscode.window.showInputBox({
      title: "Learn an issue",
      prompt: "Paste the GitHub issue's link (or owner/name#number).",
      placeHolder: "https://github.com/pallets/itsdangerous/issues/429",
      ignoreFocusOut: true,
      validateInput: (text) => (!text || parseIssue(text) ? null : "Paste a link like https://github.com/owner/name/issues/123"),
    });
    const parsed = issue && parseIssue(issue);
    if (!parsed) return;
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const where = folders.length ? ` My open folder${folders.length > 1 ? "s are" : " is"} ${folders.join(", ")}: use it if it's a clone of ${parsed.repo}, otherwise clone the project first.` : ` Clone ${parsed.repo} first if I don't have it.`;
    await askCopilot(`Teach me issue #${parsed.number} in ${parsed.repo} with opensrcer (lesson_start): you are the teacher, I want to learn it.${where}`);
  }

  // ── The code map tab ──────────────────────────────────────────────────
  let panel = null;
  let shown = ""; // lesson+stage last opened automatically: a closed tab reopens only when the lesson moves on
  const mapFile = path.join(mapDir, "current.json");
  const readMap = () => (fs.existsSync(mapFile) ? parseMap(fs.readFileSync(mapFile, "utf8")) : null);
  const seen = readMap();
  if (seen) shown = `${seen.lesson}:${seen.stage}`; // a map from a past session doesn't pop up at startup

  function showMap(map, focus) {
    if (!panel) {
      panel = vscode.window.createWebviewPanel("opensrcer.map", "opensrcer map", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: !focus }, { enableScripts: false });
      panel.onDidDispose(() => { panel = null; });
    } else if (focus) panel.reveal(undefined, false);
    panel.webview.html = mapHtml(map, panel.webview.cspSource);
  }

  let timer = null;
  function mapChanged() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const map = readMap();
      if (!map) return;
      const key = `${map.lesson}:${map.stage}`;
      if (panel || key !== shown) showMap(map, false);
      shown = key;
    }, 150);
  }
  const watcher = fs.watch(mapDir, (_event, name) => { if (!name || name === "current.json") mapChanged(); });
  context.subscriptions.push({ dispose: () => { watcher.close(); clearTimeout(timer); } });

  // ── Commands ──────────────────────────────────────────────────────────
  const command = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));
  command("opensrcer.signIn", signIn);
  command("opensrcer.signOut", async () => {
    await context.secrets.delete(SECRET);
    vscode.window.showInformationMessage("Signed out of opensrcer on this computer. (The token still works elsewhere until you revoke it on your Account page.)");
  });
  command("opensrcer.startLesson", startLesson);
  command("opensrcer.checkSetup", () => askCopilot("Check my opensrcer setup (run the opensrcer setup_check tool and show me its result)."));
  command("opensrcer.showMap", () => showMap(readMap(), true));
  command("opensrcer.menu", async () => {
    const signedIn = Boolean(await token());
    const items = [
      { label: "$(mortar-board) Learn an issue", id: "opensrcer.startLesson" },
      { label: "$(graph) Show the code map", id: "opensrcer.showMap" },
      { label: "$(checklist) Check my setup", id: "opensrcer.checkSetup" },
      signedIn ? { label: "$(sign-out) Sign out", id: "opensrcer.signOut" } : { label: "$(sign-in) Sign in", id: "opensrcer.signIn" },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: "opensrcer" });
    if (pick) await vscode.commands.executeCommand(pick.id);
  });

  await refresh();
  if (!(await token()) && !context.globalState.get("welcomed")) {
    await context.globalState.update("welcomed", true);
    vscode.commands.executeCommand("workbench.action.openWalkthrough", `${context.extension.id}#start`, false);
  }

  // For the tests in test/vscode: the live definition, the map folder, and storing a token without the input box.
  return { definition, mapDir, saveToken, panelOpen: () => Boolean(panel) };
}

function deactivate() {}

module.exports = { activate, deactivate };
