import { createHash, randomUUID } from "node:crypto";
import { readJson, updateJson } from "./blob-store";
import { CapacityError } from "./concurrency";
import { isCloudSlotLease, type CloudSlotLease } from "./cloud-leases";

const EMPTY_LEASE: CloudSlotLease = { id: "", expires: 0 };

/** Shared leases for short tasks; expiry recovers from a terminated function.
 *  Each account may hold one slot per kind, so a single (free) account cannot
 *  occupy every worker and lock everyone else out. */
export async function reserveCloudSlot(kind: "explore" | "push" | "graph", max: number, ttl: number, ownerId: string): Promise<() => Promise<void>> {
  const id = randomUUID();
  const owner = createHash("sha256").update(`cloud-slot\n${ownerId}`).digest("hex").slice(0, 32);
  // ponytail: check-then-reserve; two simultaneous requests from one account
  // can both pass. The cap bounds abuse; it is not a lock.
  for (let slot = 0; slot < max; slot++) {
    const held = await readJson<unknown>(`capacity/${kind}/${slot}.json`);
    const lease = held && isCloudSlotLease(held.value) ? held.value : EMPTY_LEASE;
    if (lease.owner === owner && lease.expires > Date.now()) {
      throw new CapacityError(`You already have a ${kind} task running. Retry when it finishes.`);
    }
  }
  for (let slot = 0; slot < max; slot++) {
    const key = `capacity/${kind}/${slot}.json`;
    try {
      await updateJson<unknown>(key, EMPTY_LEASE, value => {
        const lease = isCloudSlotLease(value) ? value : EMPTY_LEASE;
        if (lease.expires > Date.now()) throw new CapacityError("All workers are busy. Please retry when a task finishes.");
        return { id, expires: Date.now() + ttl, owner };
      });
      return async () => {
        await updateJson<unknown>(key, EMPTY_LEASE, value => {
          const lease = isCloudSlotLease(value) ? value : EMPTY_LEASE;
          return lease.id === id ? EMPTY_LEASE : lease;
        });
      };
    } catch (error) { if (!(error instanceof CapacityError)) throw error; }
  }
  throw new CapacityError("All workers are busy. Please retry when a task finishes.");
}
