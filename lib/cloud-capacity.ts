import { createHash, randomUUID } from "node:crypto";
import { readJson, updateJson } from "./blob-store";
import { CapacityError } from "./concurrency";
import { isCloudSlotLease, type CloudSlotLease } from "./cloud-leases";

const EMPTY_LEASE: CloudSlotLease = { id: "", expires: 0 };

async function ownerLeases(kind: string, max: number, owner: string): Promise<number> {
  let held = 0;
  for (let slot = 0; slot < max; slot++) {
    const stored = await readJson<unknown>(`capacity/${kind}/${slot}.json`);
    const lease = stored && isCloudSlotLease(stored.value) ? stored.value : EMPTY_LEASE;
    if (lease.owner === owner && lease.expires > Date.now()) held++;
  }
  return held;
}

/** Shared leases for short tasks; expiry recovers from a terminated function.
 *  Each account may hold one slot per kind, so a single (free) account cannot
 *  occupy every worker and lock everyone else out. */
export async function reserveCloudSlot(kind: "explore" | "push" | "graph", max: number, ttl: number, ownerId: string): Promise<() => Promise<void>> {
  const id = randomUUID();
  const owner = createHash("sha256").update(`cloud-slot\n${ownerId}`).digest("hex").slice(0, 32);
  const busyOwner = () => new CapacityError(`You already have a ${kind} task running. Retry when it finishes.`);
  if (await ownerLeases(kind, max, owner) > 0) throw busyOwner();
  for (let slot = 0; slot < max; slot++) {
    const key = `capacity/${kind}/${slot}.json`;
    try {
      await updateJson<unknown>(key, EMPTY_LEASE, value => {
        const lease = isCloudSlotLease(value) ? value : EMPTY_LEASE;
        if (lease.expires > Date.now()) throw new CapacityError("All workers are busy. Please retry when a task finishes.");
        return { id, expires: Date.now() + ttl, owner };
      });
    } catch (error) {
      if (error instanceof CapacityError) continue;
      throw error;
    }
    const release = async () => {
      await updateJson<unknown>(key, EMPTY_LEASE, value => {
        const lease = isCloudSlotLease(value) ? value : EMPTY_LEASE;
        return lease.id === id ? EMPTY_LEASE : lease;
      });
    };
    // Simultaneous requests from one account all pass the check above. With
    // this lease in place, back out if the account now holds another slot;
    // racing requests then all back out, which errs toward refusing.
    if (await ownerLeases(kind, max, owner) > 1) {
      await release().catch(() => {});
      throw busyOwner();
    }
    return release;
  }
  throw new CapacityError("All workers are busy. Please retry when a task finishes.");
}
