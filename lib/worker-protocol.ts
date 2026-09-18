export const WORKER_PROTOCOL_VERSION = "4";
export const WORKER_PROTOCOL_PATH = "/vercel/sandbox/.opensrcer-worker-protocol";

type WorkerSandbox = {
  readFileToBuffer(
    file: { path: string },
    options?: { signal?: AbortSignal },
  ): Promise<Buffer | null>;
};

/** Reject a snapshot built before the current web/worker contract. */
export async function assertWorkerProtocol(
  sandbox: WorkerSandbox,
  signal?: AbortSignal,
): Promise<void> {
  const marker = await sandbox.readFileToBuffer(
    { path: WORKER_PROTOCOL_PATH },
    { signal: signal ?? AbortSignal.timeout(10_000) },
  );
  if (marker?.toString("utf8").trim() !== WORKER_PROTOCOL_VERSION) {
    throw new Error("Worker snapshot is incompatible; rebuild it from the current release.");
  }
}
