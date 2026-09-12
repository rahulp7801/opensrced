import { Sandbox } from "@vercel/sandbox";
import { randomBytes } from "node:crypto";
import { GRAPH_MAX_BYTES, parseStoredGraph, type StoredGraph } from "./graph-worker";
import { assertWorkerProtocol } from "./worker-protocol";

export async function buildCloudGraph(repo: string, token: string | null, signal: AbortSignal, progress: (message: string) => void, release: () => void | Promise<void>): Promise<StoredGraph> {
  const snapshotId = process.env.OPENSRCER_WORKER_SNAPSHOT_ID;
  let sandbox: Sandbox | undefined;
  const outputPath = `/tmp/opensrcer-graph-${randomBytes(16).toString("hex")}.json`;
  try {
    if (!snapshotId) throw new Error("Graph hosting is not configured");
    sandbox = await Sandbox.create({ source: { type: "snapshot", snapshotId }, persistent: false, timeout: 4 * 60_000, signal });
    await assertWorkerProtocol(sandbox, signal);
    const command = await sandbox.runCommand({ cmd: "node", args: ["scripts/sandbox-graph.cjs"], cwd: "/vercel/sandbox", env: { OPENSRCER_GRAPH: JSON.stringify({ repo, token, outputPath }) }, detached: true, signal });
    let buffer = "";
    for await (const log of command.logs({ signal })) {
      if (log.stream !== "stdout") continue;
      buffer += log.data;
      if (buffer.length > 100_000) throw new Error("Graph progress exceeded its limit");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error("Graph build failed or exceeded its limits.");
        if (typeof event.message === "string") progress(event.message);
      }
    }
    if ((await command.wait({ signal })).exitCode !== 0) throw new Error("Graph build failed");
    const data = await sandbox.readFileToBuffer({ path: outputPath }, { signal });
    if (!data || data.length > GRAPH_MAX_BYTES) throw new Error("Graph output missing or too large");
    return parseStoredGraph(JSON.parse(data.toString("utf8")));
  } finally {
    const stopped = !sandbox || await sandbox.stop().then(() => true, () => false);
    if (stopped) await Promise.resolve(release()).catch(() => {});
  }
}
