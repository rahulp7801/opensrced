import { spawn, execFile } from "node:child_process";
import { claudeEvents } from "./claude-events";

export function localClaudeStream(args: string[], env: NodeJS.ProcessEnv, requestSignal: AbortSignal, release: () => void): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const child = spawn("claude", args, { env, windowsHide: true, detached: process.platform !== "win32" });
      let finished = false;
      const send = (event: Record<string, unknown>) => {
        if (!cancelled && !finished) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      stop = () => {
        if (!child.pid || child.exitCode !== null) return;
        if (process.platform === "win32") execFile("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true }, () => {});
        else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
      };
      const disconnect = () => { cancelled = true; stop(); };
      requestSignal.addEventListener("abort", disconnect, { once: true });
      const timeout = setTimeout(() => { send({ error: "Exploration time limit reached." }); stop(); }, 3 * 60_000);
      const finish = (event: Record<string, unknown>) => {
        if (finished) return;
        clearTimeout(timeout);
        requestSignal.removeEventListener("abort", disconnect);
        release();
        send(event);
        finished = true;
        if (!cancelled) controller.close();
      };
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.length > 1_000_000) { send({ error: "Exploration output exceeded its limit." }); stop(); return; }
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) for (const event of claudeEvents(line)) send(event);
      });
      child.stderr.resume();
      child.on("close", code => {
        for (const event of claudeEvents(buffer)) send(event);
        if (code !== 0) send({ error: "Exploration failed. Check provider access and retry." });
        finish({ done: true, exit_code: code });
      });
      child.on("error", () => finish({ error: "Could not start the exploration worker." }));
      if (requestSignal.aborted) disconnect();
    },
    cancel() { cancelled = true; stop(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
