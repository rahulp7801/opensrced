import { Sandbox } from "@vercel/sandbox";
import { reserveCloudSlot } from "./cloud-capacity";
import { CapacityError } from "./concurrency";
import { claudeEvents } from "./claude-events";

export async function cloudExplore(args: string[], credentials: Record<string, string>, requestSignal: AbortSignal): Promise<Response> {
  const snapshotId = process.env.OPENSRCER_WORKER_SNAPSHOT_ID;
  if (!snapshotId || !process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "Exploration hosting is not configured." }, { status: 503 });
  let release: () => Promise<void>;
  try { release = await reserveCloudSlot("explore", 3, 4 * 60_000); }
  catch (error) {
    if (!(error instanceof CapacityError)) throw error;
    return Response.json({ error: error.message }, { status: 429 });
  }

  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal, AbortSignal.timeout(3 * 60_000)]);
  let sandbox: Sandbox | undefined;
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!cancelled && !requestSignal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        sandbox = await Sandbox.create({ source: { type: "snapshot", snapshotId }, persistent: false, timeout: 3 * 60_000, signal });
        const command = await sandbox.runCommand({ cmd: "claude", args, cwd: "/vercel/sandbox", env: credentials, detached: true, signal });
        let buffer = "";
        for await (const log of command.logs({ signal })) {
          if (log.stream !== "stdout") continue;
          buffer += log.data;
          if (buffer.length > 1_000_000) throw new Error("Exploration output exceeded its limit");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) for (const event of claudeEvents(line)) send(event);
        }
        for (const event of claudeEvents(buffer)) send(event);
        const result = await command.wait({ signal });
        if (result.exitCode !== 0) send({ error: "Exploration failed. Check provider access and retry." });
        send({ done: true, exit_code: result.exitCode });
      } catch {
        send({ error: signal.aborted ? "Exploration time limit reached." : "Exploration failed. Please retry." });
      } finally {
        const stopped = !sandbox || await sandbox.stop().then(() => true, () => false);
        if (stopped) await release().catch(() => {});
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; cancellation.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
