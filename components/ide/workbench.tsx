"use client";

// The write-it-yourself IDE (PLAN §8.0): VS Code's workbench running in the
// page via @codingame/monaco-editor-wrapper, with opensrcer's run panel and
// teacher beside it. Loaded only through components/ide/ide.tsx
// (next/dynamic, ssr:false), so none of this reaches other pages' bundles.

// Wrapper features register their services on import; they must come before initialize().
import "@codingame/monaco-editor-wrapper/features/workbench";
// Workspace folders and user settings (also the workspaces service the title bar needs).
import "@codingame/monaco-editor-wrapper/features/configuration";
import "@codingame/monaco-editor-wrapper/features/viewPanels";
import "@codingame/monaco-editor-wrapper/features/search";
import "@codingame/monaco-editor-wrapper/features/typescriptStandalone";
import { initialize, monaco } from "@codingame/monaco-editor-wrapper";
import { registerFileSystemOverlay } from "@codingame/monaco-vscode-files-service-override";
import { useCallback, useEffect, useRef, useState } from "react";
import { RepoFs, WORKSPACE_ROOT, repoFileSystemProvider } from "./fs";
import { modelPath, registerLanguageSmarts } from "./languages";
import { RunPanel } from "./run-panel";
import { TeacherPanel, type EditorSelection, type TeacherMessage } from "./teacher-panel";

export interface IdeProps {
  lessonId: string;
  repo: string;
  sha: string;
  /** Prefilled in the run box, e.g. the recipe's test command. */
  runCommand: string;
}

/** How often the diff is saved to the server so the lesson resumes on another device (PLAN §8.0). */
const CHECKPOINT_MS = 30_000;

// VS Code's services start once per page and can't be torn down, so the
// workbench boots once even under React strict mode's double effects.
let boot: Promise<RepoFs> | null = null;
let lastEditor: monaco.editor.ICodeEditor | null = null;

function startWorkbench(container: HTMLElement, { repo, sha, lessonId }: IdeProps): Promise<RepoFs> {
  boot ??= (async () => {
    const fs = await RepoFs.load(repo, sha, lessonId);
    // In front of the wrapper's own providers; URIs outside /workspace fall through to them.
    registerFileSystemOverlay(10, repoFileSystemProvider(fs));
    await initialize({
      workspaceProvider: { trusted: true, workspace: { folderUri: monaco.Uri.file(WORKSPACE_ROOT) }, open: async () => false },
      configurationDefaults: {
        "workbench.colorTheme": "Default Dark Modern",
        // Saving is what writes an edit to IndexedDB; auto-save means a reload never loses typing.
        "files.autoSave": "afterDelay",
        "files.autoSaveDelay": 500,
        "workbench.startupEditor": "none",
        // One row per folder: easier to follow for someone new to the repo.
        "explorer.compactFolders": false,
        "window.commandCenter": false,
        "workbench.layoutControl.enabled": false,
      },
      defaultLayout: { views: [{ id: "workbench.explorer.fileView" }] },
    }, { container, registerAdditionalExtensions: false });
    monaco.editor.onDidCreateEditor((editor) => {
      editor.onDidFocusEditorText(() => { lastEditor = editor; });
    });
    registerLanguageSmarts(repo);
    return fs;
  })();
  return boot;
}

function currentSelection(): EditorSelection | null {
  const model = lastEditor?.getModel();
  const selection = lastEditor?.getSelection();
  const file = model && modelPath(model.uri);
  if (!model || !selection || !file) return null;
  return { file, selection: model.getValueInRange(selection), line: selection.startLineNumber };
}

export default function Workbench(props: IdeProps) {
  const container = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState<RepoFs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [submit, setSubmit] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const addMessage = useCallback((message: TeacherMessage) => setMessages((all) => [...all, message]), []);

  // "I'm done, check my work" (PLAN §8.2 item 4): the diff goes to the lesson
  // for the reveal; the lesson page takes it from there.
  async function submitWork() {
    if (!fs) return;
    setSubmit({ pending: true, error: null });
    try {
      const res = await fetch(`/api/lessons/${encodeURIComponent(props.lessonId)}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diff: await fs.getDiff() }) });
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `Could not submit (${res.status}).`);
      window.location.assign(`/learn/${encodeURIComponent(props.lessonId)}`);
    } catch (e) {
      setSubmit({ pending: false, error: e instanceof Error ? e.message : "Could not submit." });
    }
  }

  useEffect(() => {
    const started = performance.now();
    startWorkbench(container.current!, props)
      .then((repoFs) => {
        setFs(repoFs);
        // A hook for the browser console and the end-to-end check (getDiff is the contributor's own work).
        Object.assign(window, { opensrcerIde: { getDiff: () => repoFs.getDiff(), readyMs: Math.round(performance.now() - started) } });
      })
      .catch((e: Error) => setError(e.message));
    // Props are fixed for the page's life: the workbench can't be re-initialized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Checkpoint: post the diff every 30 s when it changed.
  useEffect(() => {
    if (!fs) return;
    let last = "";
    const save = async () => {
      const diff = await fs.getDiff();
      if (diff === last) return;
      const res = await fetch(`/api/lessons/${encodeURIComponent(props.lessonId)}/checkpoint`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diff }) });
      if (res.ok) { last = diff; setSaved(new Date().toLocaleTimeString()); }
    };
    const timer = setInterval(() => { save().catch(() => {}); }, CHECKPOINT_MS);
    return () => clearInterval(timer);
  }, [fs, props.lessonId]);

  // Ctrl+I "Suggest": caught before VS Code's own Ctrl+I (trigger suggest) so the binding is ours.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "i" || !container.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      const position = lastEditor?.getPosition();
      const model = lastEditor?.getModel();
      const file = model && modelPath(model.uri);
      if (!position || !file) return;
      const res = await fetch(`/api/lessons/${encodeURIComponent(props.lessonId)}/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, line: position.lineNumber }) });
      const body = await res.json().catch(() => null) as { suggestion?: string; error?: string } | null;
      addMessage({ from: "teacher", text: body?.suggestion ?? body?.error ?? `No suggestion (${res.status}).` });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props.lessonId, addMessage]);

  return (
    <div className="grid h-full grid-cols-[1fr_20rem] grid-rows-[auto_1fr_14rem] bg-[#1e1e1e]">
      <header className="col-span-2 flex items-center gap-3 border-b border-white/10 px-3 py-1.5 text-xs text-white/70">
        <span className="font-mono">{props.repo}@{props.sha.slice(0, 7)}</span>
        {!fs && !error && <span role="status">Loading the editor…</span>}
        {error && <span role="alert" className="text-red-300">{error}</span>}
        {saved && <span className="ml-auto">Checkpoint saved {saved}</span>}
        {submit.error && <span role="alert" className="text-red-300">{submit.error}</span>}
        {/* Lessons only: the demo page has no lesson to submit to. */}
        {props.lessonId.startsWith("l_") && (
          <button type="button" onClick={() => void submitWork()} disabled={!fs || submit.pending} className={`${saved ? "" : "ml-auto "}rounded bg-sky-600 px-3 py-1 font-medium text-white disabled:opacity-50`}>
            {submit.pending ? "Submitting…" : "I'm done, check my work"}
          </button>
        )}
      </header>
      <div ref={container} data-testid="ide-workbench" className="min-h-0 min-w-0" />
      <div className="row-span-2 min-h-0">
        <TeacherPanel lessonId={props.lessonId} messages={messages} onMessage={addMessage} currentSelection={currentSelection} />
      </div>
      <div className="min-h-0 border-t border-white/10">
        <RunPanel lessonId={props.lessonId} defaultCommand={props.runCommand} getDiff={() => fs ? fs.getDiff() : Promise.resolve("")} />
      </div>
    </div>
  );
}
