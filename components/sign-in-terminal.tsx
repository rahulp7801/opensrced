"use client";

// Hosted Claude-plan run waiting for the user to sign in: a plain terminal
// attached to Claude Code's own `claude auth login` in the run's VM
// (lib/hosted-sign-in.ts). The user signs in exactly as over SSH: open the
// link Claude Code prints, then paste the code into Claude Code's own prompt.
// The bytes go to and from /api/dispatches/<id>/terminal untouched; nothing
// here or on the server reads, keeps or logs them.

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

// Must match TTY_COLS/TTY_ROWS in lib/hosted-sign-in.ts (that module is server-only).
const COLS = 100;
const ROWS = 30;

export function SignInTerminal({ dispatchId }: { dispatchId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const url = `/api/dispatches/${encodeURIComponent(dispatchId)}/terminal`;
    const stop = new AbortController();
    let dispose = () => {};
    void (async () => {
      // Imported here: xterm needs the browser.
      const [{ Terminal }, { WebLinksAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-web-links")]);
      if (stop.signal.aborted || !host.current) return;
      const term = new Terminal({ cols: COLS, rows: ROWS, cursorBlink: true, convertEol: false, fontSize: 13 });
      term.loadAddon(new WebLinksAddon());
      term.open(host.current);
      term.focus();
      // Keystrokes and pastes go out in order, one request at a time.
      let sending = Promise.resolve();
      const typed = term.onData((data) => {
        sending = sending.then(async () => {
          const res = await fetch(url, { method: "POST", body: new TextEncoder().encode(data), signal: stop.signal }).catch(() => null);
          if (res && !res.ok && res.status !== 404) setProblem("Could not reach the run's worker. Keep typing to retry.");
        });
      });
      dispose = () => { typed.dispose(); term.dispose(); };
      // The output stream ends when a server function times out; reconnect
      // until the run stops waiting for a sign-in (then the route says 404).
      while (!stop.signal.aborted) {
        const res = await fetch(url, { signal: stop.signal }).catch(() => null);
        if (res?.status === 404) return;
        if (res?.ok && res.body) {
          setProblem(null);
          const reader = res.body.getReader();
          for (;;) {
            const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }));
            if (chunk.done) break;
            term.write(chunk.value);
          }
        } else if (!stop.signal.aborted) {
          setProblem("Reconnecting to the run's worker…");
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    })();
    return () => { stop.abort(); dispose(); };
  }, [dispatchId]);

  return (
    <section aria-labelledby={`sign-in-${dispatchId}`} className="callout mt-4 text-[15px]" data-tone="signal">
      <h3 id={`sign-in-${dispatchId}`} className="text-[16px] font-semibold text-signal">Sign in to Claude to start this run</h3>
      <p className="mt-1 text-paper-muted">
        This is Claude Code&apos;s own sign-in, running in this run&apos;s isolated worker. Open the link it shows, sign in on
        Claude&apos;s page, then paste the code it gives you here and press Enter. opensrcer never reads or keeps what you type, and the
        sign-in ends with the run.
      </p>
      <div className="mt-3 overflow-x-auto rounded bg-black p-2">
        <div ref={host} role="application" aria-label="Claude sign-in terminal" />
      </div>
      {problem && <p role="status" className="mt-2 text-[13px] text-alert">{problem}</p>}
    </section>
  );
}
