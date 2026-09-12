const RUN_PATH_RE = /^users\/[a-f0-9]{64}\/runs\/(\d{13})-(c_(\d{13})_[a-f0-9]{12})\.json$/;
const SLOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CloudSlotLease = { id: string; expires: number };
export type CloudRunLease = { path: string; expires: number };

export function isCloudSlotLease(value: unknown): value is CloudSlotLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const lease = value as Partial<CloudSlotLease>;
  return typeof lease.id === "string" && (lease.id === "" || SLOT_ID_RE.test(lease.id)) &&
    typeof lease.expires === "number" && Number.isFinite(lease.expires) && lease.expires >= 0;
}

export function cloudRunLease(value: unknown): (CloudRunLease & { id: string }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lease = value as Partial<CloudRunLease>;
  const match = typeof lease.path === "string" ? RUN_PATH_RE.exec(lease.path) : null;
  return match && Number(match[1]) === 9999999999999 - Number(match[3]) &&
    typeof lease.expires === "number" && Number.isFinite(lease.expires) && lease.expires >= 0
    ? { path: lease.path!, expires: lease.expires, id: match[2] }
    : null;
}
