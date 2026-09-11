import { Sandbox } from "@vercel/sandbox";
import { reserveCloudSlot } from "./cloud-capacity";
import type { PushPatch } from "./pr-push";

export async function cloudPush(input: PushPatch, token: string, requestSignal: AbortSignal) {
  const snapshotId = process.env.OPENSRCER_WORKER_SNAPSHOT_ID;
  if (!snapshotId || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Push hosting is not configured.");
  const release = await reserveCloudSlot("push", 2, 5 * 60_000);
  let sandbox: Sandbox | undefined;
  try {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(4 * 60_000)]);
    sandbox = await Sandbox.create({ source: { type: "snapshot", snapshotId }, persistent: false, timeout: 4 * 60_000, signal });
    const command = await sandbox.runCommand({ cmd: "node", args: ["scripts/sandbox-push.cjs"], cwd: "/vercel/sandbox", env: { OPENSRCER_PUSH: JSON.stringify({ input, token }) }, signal });
    const result = JSON.parse(await command.stdout());
    if (command.exitCode !== 0 || !result.ok) throw new Error("The isolated push failed.");
    return result;
  } finally {
    const stopped = !sandbox || await sandbox.stop().then(() => true, () => false);
    if (stopped) await release().catch(() => {});
  }
}
