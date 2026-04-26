// Simple in-memory concurrency limiter for API routes.
// Prevents unbounded spawning of Claude/git child processes.

const slots = new Map<string, number>();

export function acquireSlot(key: string, max: number): boolean {
  const current = slots.get(key) ?? 0;
  if (current >= max) return false;
  slots.set(key, current + 1);
  return true;
}

export function releaseSlot(key: string): void {
  const current = slots.get(key) ?? 0;
  if (current > 0) slots.set(key, current - 1);
  else slots.delete(key);
}

export function activeSlots(key: string): number {
  return slots.get(key) ?? 0;
}
