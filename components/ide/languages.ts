// Language smarts for the in-browser IDE (PLAN §8.5).
//
//   TS/JS     Monaco's TypeScript worker (the wrapper's typescriptStandalone
//             feature, imported by workbench.tsx).
//   Python    Pyright in a web worker (monaco-pyright-lsp), started the first
//             time a Python file opens. It sees one document at a time: hover,
//             completion, signature help and errors inside the open file.
//   all       Go-to-definition and find-references from the stored code graph
//             (/api/ide/graph), which knows the whole repo. With no graph the
//             providers return nothing and the language servers' own results stand.

import { monaco } from "@codingame/monaco-editor-wrapper";
import { WORKSPACE_ROOT } from "./fs";
import type { GraphLocation } from "@/lib/ide/graph-nav";

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
    // in, and only apply diagnostics that belong to the text pyright last saw.
    const client = provider.lspClient;
    let current: monaco.editor.ITextModel | null = null;
    client.setupDiagnosticsCallback((diagnostics) => {
      if (!current || current.isDisposed() || current.getValue() !== client.docText) return;
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
      timer = setTimeout(() => { if (!model.isDisposed()) void client.updateDocVersion(model.getValue()); }, 400);
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

export function registerLanguageSmarts(repo: string) {
  graphNavigation(repo);
  pyright();
}
