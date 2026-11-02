// Language smarts for the in-browser IDE (PLAN §8.5).
//
//   TS/JS     Monaco's TypeScript worker (the wrapper's typescriptStandalone
//             feature, imported by workbench.tsx). It only sees models and
//             extra libs, so the repo files an open file imports are handed
//             to it as extra libs, following relative imports through the
//             tree (lib/ide/ts-imports.ts, capped by TS_IMPORT_LIMITS).
//   Python    Pyright in a web worker (monaco-pyright-lsp), started the first
//             time a Python file opens. It sees one document at a time: hover,
//             completion, signature help and errors inside the open file.
//   all       Go-to-definition and find-references from the stored code graph
//             (/api/ide/graph), which knows the whole repo. With no graph the
//             providers return nothing and the language servers' own results stand.

import { monaco } from "@codingame/monaco-editor-wrapper";
import * as typescript from "@codingame/monaco-vscode-standalone-typescript-language-features";
import { WORKSPACE_ROOT, type RepoFs } from "./fs";
import type { GraphLocation } from "@/lib/ide/graph-nav";
import { isScriptPath, relativeImports, resolveImport, TS_IMPORT_LIMITS } from "@/lib/ide/ts-imports";

/** Repo-relative path of a workbench model, or null for anything else (settings, output). */
export function modelPath(uri: monaco.Uri): string | null {
  return uri.scheme === "file" && uri.path.startsWith(`${WORKSPACE_ROOT}/`) ? uri.path.slice(WORKSPACE_ROOT.length + 1) : null;
}

function graphNavigation(repo: string) {
  type Answer = { available: boolean; definitions: GraphLocation[]; references: GraphLocation[] };
  const answers = new Map<string, Promise<Answer | null>>();
  let available = true;
  const lookup = (model: monaco.editor.ITextModel, position: monaco.Position) => {
    const word = model.getWordAtPosition(position)?.word;
    if (!available || !word || !modelPath(model.uri)) return null;
    if (!answers.has(word)) {
      answers.set(word, fetch(`/api/ide/graph?repo=${encodeURIComponent(repo)}&symbol=${encodeURIComponent(word)}`)
        .then((res) => (res.ok ? res.json() as Promise<Answer> : null))
        .then((answer) => { if (answer && !answer.available) available = false; return answer; })
        .catch(() => null));
    }
    return answers.get(word)!;
  };
  const toLocations = (locations: GraphLocation[]): monaco.languages.Location[] => locations.map(({ file, line }) => ({
    uri: monaco.Uri.file(`${WORKSPACE_ROOT}/${file}`),
    range: new monaco.Range(line, 1, line, 1),
  }));
  monaco.languages.registerDefinitionProvider("*", {
    async provideDefinition(model, position) { return toLocations((await lookup(model, position))?.definitions ?? []); },
  });
  monaco.languages.registerReferenceProvider("*", {
    async provideReferences(model, position) { return toLocations((await lookup(model, position))?.references ?? []); },
  });
}

function pyright() {
  let started = false;
  monaco.languages.onLanguage("python", async () => {
    if (started) return;
    started = true;
    const { MonacoPyrightProvider } = await import("monaco-pyright-lsp");
    const provider = new MonacoPyrightProvider(undefined, { features: { hover: true, completion: true, signatureHelp: true, diagnostic: true, rename: false, findDefinition: true } });
    // The package types its argument as upstream monaco-editor; the wrapper's
    // monaco is VS Code's build of the same API.
    await provider.init(monaco as unknown as Parameters<typeof provider.init>[0]);
    // The package wires diagnostics to one standalone editor. In the workbench
    // editors come and go, so send whichever Python model the contributor is
    // in, and only apply diagnostics while that model still holds the text we sent.
    const client = provider.lspClient;
    // Pyright sees one file, so every import of another repo module or a
    // dependency would be an error. Silence those; the rest still reports.
    // (Same settings the package sends, plus the overrides.)
    await client.connection.sendNotification("workspace/didChangeConfiguration", {
      settings: { python: { pythonVersion: "3.13", pythonPlatform: "All", analysis: {
        typeshedPaths: ["/typeshed-fallback"],
        diagnosticSeverityOverrides: { reportMissingImports: "none", reportMissingModuleSource: "none", reportAttributeAccessIssue: "none" },
      } } },
    });
    let current: monaco.editor.ITextModel | null = null;
    let sent = "";
    client.setupDiagnosticsCallback((diagnostics) => {
      if (!current || current.isDisposed() || current.getValue() !== sent) return;
      monaco.editor.setModelMarkers(current, "Pyright", diagnostics.map((d) => ({
        startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
        message: d.message,
        severity: d.severity === 1 ? monaco.MarkerSeverity.Error : d.severity === 2 ? monaco.MarkerSeverity.Warning : d.severity === 3 ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Hint,
      })));
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (model: monaco.editor.ITextModel | null | undefined) => {
      if (!model || model.getLanguageId() !== "python") return;
      current = model;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (model.isDisposed()) return;
        sent = model.getValue();
        void client.updateDocVersion(sent);
      }, 400);
    };
    const watch = (editor: monaco.editor.ICodeEditor) => {
      send(editor.getModel());
      editor.onDidChangeModel(() => send(editor.getModel()));
      editor.onDidChangeModelContent(() => send(editor.getModel()));
      editor.onDidFocusEditorText(() => send(editor.getModel()));
    };
    monaco.editor.getEditors().forEach(watch);
    monaco.editor.onDidCreateEditor(watch);
  });
}

/** TypeScript's "bundler" module resolution (the enum here only lists Classic and NodeJs). */
const BUNDLER_RESOLUTION = 100 as typescript.ModuleResolutionKind;

function typescriptRepoFiles(fs: RepoFs) {
  const defaults = [typescript.typescriptDefaults, typescript.javascriptDefaults];
  for (const d of defaults) {
    // The wrapper's defaults are for snippets (CommonJS, ES2016, no DOM). A repo
    // is modules: extensionless and ".ts" imports, default imports of
    // `export =` modules (node:assert), JSX, browser globals.
    d.setCompilerOptions({
      ...d.getCompilerOptions(),
      target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, moduleResolution: BUNDLER_RESOLUTION,
      allowImportingTsExtensions: true, allowJs: true, esModuleInterop: true, jsx: typescript.JsxEmit.Preserve,
      lib: ["esnext", "dom", "dom.iterable"],
    });
    // There is no node_modules in the browser, so a package import can't
    // resolve; like Pyright's missing imports (below), that isn't the
    // contributor's error. Repo files resolve through the extra libs.
    d.setDiagnosticsOptions({ ...d.getDiagnosticsOptions(), diagnosticCodesToIgnore: [2307, 2792] });
  }
  const decoder = new TextDecoder();
  const added = new Set<string>();
  const exists = (path: string) => fs.kind(path) === "file";
  const addLib = async (path: string): Promise<string> => {
    const text = decoder.decode(await fs.readFile(path));
    // Keyed by the model URI, so an open model of the same file takes precedence in the worker.
    const name = monaco.Uri.file(`${WORKSPACE_ROOT}/${path}`).toString();
    for (const d of defaults) d.addExtraLib(text, name);
    return text;
  };
  // Imports of imports too, fetched in parallel, until the cap.
  const follow = async (from: string, source: string): Promise<void> => {
    const targets = relativeImports(source)
      .map((specifier) => resolveImport(from, specifier, exists))
      .filter((target): target is string => target !== null && !added.has(target) && fs.stat(target).size <= TS_IMPORT_LIMITS.maxFileBytes);
    await Promise.all(targets.map(async (target) => {
      if (added.has(target) || added.size >= TS_IMPORT_LIMITS.maxFiles) return;
      added.add(target);
      let text: string;
      try { text = await addLib(target); } catch { return; } // a file that won't fetch stays a missing module
      await follow(target, text);
    }));
  };
  const watch = (model: monaco.editor.ITextModel) => {
    const path = modelPath(model.uri);
    if (!path || !isScriptPath(path)) return;
    void follow(path, model.getValue());
    // New imports typed in: look again once typing pauses (only new files are fetched).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changes = model.onDidChangeContent(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!model.isDisposed()) void follow(path, model.getValue()); }, 1_000);
    });
    // Closed: the extra lib takes over again, with what was saved.
    model.onWillDispose(() => {
      clearTimeout(timer);
      changes.dispose();
      if (added.has(path)) addLib(path).catch(() => {});
    });
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}

export function registerLanguageSmarts(repo: string, fs: RepoFs) {
  graphNavigation(repo);
  pyright();
  typescriptRepoFiles(fs);
}
