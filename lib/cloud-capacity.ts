import { randomUUID } from "node:crypto";
import { updateJson } from "./blob-store";
import { CapacityError } from "./concurrency";

/** Shared leases for short tasks; expiry recovers from a terminated function. */
export async function reserveCloudSlot(kind: "explore" | "push" | "graph", max: number, ttl: number): Promise<() => Promise<void>> {
  const id = randomUUID();
  for (let slot = 0; slot < max; slot++) {
    const key = `capacity/${kind}/${slot}.json`;
    try {
      await updateJson(key, { id: "", expires: 0 }, lease => {
        if (lease.expires > Date.now()) throw new CapacityError("All workers are busy. Please retry when a task finishes.");
        return { id, expires: Date.now() + ttl };
      });
      return async () => { await updateJson(key, { id: "", expires: 0 }, lease => lease.id === id ? { id, expires: 0 } : lease); };
    } catch (error) { if (!(error instanceof CapacityError)) throw error; }
  }
  throw new CapacityError("All workers are busy. Please retry when a task finishes.");
}
