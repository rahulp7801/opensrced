"use client";

// The IDE's run panel (PLAN §8.0 step 3): a command box and an xterm that
// shows the output of POST /api/lessons/:id/run as it streams. v1 is a
// command runner, not an interactive terminal.

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// The CSS text (next.config.ts loads it as a string, like VS Code's own CSS).
import xtermCss from "@xterm/xterm/css/xterm.css";
import { sseEvents } from "@/lib/sse";
import type { RunEvent } from "@/lib/ide/lesson-api";

export function RunPanel({ lessonId, defaultCommand, getDiff }: { lessonId: string; defaultCommand: string; getDiff: () => Promise<string> }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const [cmd, setCmd] = useState(defaultCommand);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = xtermCss;
    document.head.append(style);
    const terminal = new Terminal({ convertEol: true, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", theme: { background: "#1e1e1e" }, disableStdin: true });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current!);
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current!);
    term.current = terminal;
    return () => { observer.disconnect(); terminal.dispose(); style.remove(); };
  }, []);

  async function run() {
    const terminal = term.current!;
    setRunning(true);
    terminal.writeln(`\x1b[36m$ ${cmd}\x1b[0m`);
    try {
      const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: await getDiff(), cmd }),
      });
      for await (const event of sseEvents<RunEvent>(res)) {
        if (event.type === "out") terminal.write(event.data);
        else terminal.writeln(`\x1b[90m[exit ${event.data}]\x1b[0m`);
      }
    } catch (error) {
      terminal.writeln(`\x1b[31m${(error as Error).message}\x1b[0m`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section aria-label="Run" className="flex h-full flex-col bg-[#1e1e1e] text-[#ccc]">
      <form className="flex items-center gap-2 border-b border-white/10 px-2 py-1" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label htmlFor="ide-run-cmd" className="text-xs uppercase tracking-wide text-white/60">Run</label>
        <input id="ide-run-cmd" value={cmd} onChange={(e) => setCmd(e.target.value)} className="flex-1 rounded bg-black/40 px-2 py-1 font-mono text-xs text-white outline-none focus:ring-1 focus:ring-sky-400" />
        <button type="submit" disabled={running || !cmd.trim()} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">{running ? "Running…" : "Run"}</button>
      </form>
      <div ref={host} data-testid="ide-terminal" className="min-h-0 flex-1 px-2 py-1" />
    </section>
  );
}
