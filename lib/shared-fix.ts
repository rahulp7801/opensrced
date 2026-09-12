import { createHash, randomBytes } from "node:crypto";
import { parseRunTarget } from "./run-target";
import { SHARED_FIX_RETENTION_MS, type SharedFix } from "./shared-fix-data";
export { SHARED_FIX_RETENTION_MS, type SharedFix } from "./shared-fix-data";
const LEGACY_SHARED_FIX_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SCOPED_SHARED_FIX_ID = /^s_(\d{13})_([a-f0-9]{32})_([a-f0-9]{32})$/;

function ownerKey(owner: string): string {
  if (!owner) throw new Error("Share owner is required");
  return createHash("sha256").update(owner).digest("hex").slice(0, 32);
}

export function newSharedFixId(owner: string, now = Date.now(), entropy = randomBytes(16)): string {
  if (!Number.isSafeInteger(now) || now < 1_000_000_000_000 || now > 9_999_999_999_999 || entropy.length !== 16) {
    throw new Error("Invalid share identity");
  }
  return `s_${now}_${ownerKey(owner)}_${entropy.toString("hex")}`;
}

/** Resolve both current owner-scoped IDs and legacy UUID links. */
export function sharedFixPath(id: string): string | null {
  if (LEGACY_SHARED_FIX_ID.test(id)) return `shares/${id}.json`;
  const match = SCOPED_SHARED_FIX_ID.exec(id);
  if (!match) return null;
  const reverseTimestamp = String(9_999_999_999_999 - Number(match[1])).padStart(13, "0");
  return `shares/${match[2]}/${reverseTimestamp}-${id}.json`;
}

export function sharedFixOwnerPrefix(owner: string): string {
  return `shares/${ownerKey(owner)}/`;
}

/** Select expired records and anything beyond the per-account retention
 * window. Paths use reverse timestamps, so a single bounded Blob listing
 * contains the newest records first. */
export function staleSharedFixPaths(
  owner: string,
  paths: string[],
  now = Date.now(),
  keep = 900,
  limit = 100,
): string[] {
  const prefix = sharedFixOwnerPrefix(owner);
  const ownerHash = prefix.split("/")[1];
  const records = paths.flatMap((path) => {
    if (!path.startsWith(prefix)) return [];
    const id = path.slice(prefix.length).replace(/^\d{13}-/, "").replace(/\.json$/, "");
    const match = SCOPED_SHARED_FIX_ID.exec(id);
    if (!match || match[2] !== ownerHash || sharedFixPath(id) !== path) return [];
    return [{ path, createdAt: Number(match[1]) }];
  }).sort((a, b) => b.createdAt - a.createdAt);
  const stale = new Set([
    ...records.filter((record) => record.createdAt + SHARED_FIX_RETENTION_MS <= now).map((record) => record.path),
    ...records.slice(Math.max(0, keep)).map((record) => record.path),
  ]);
  return records.filter((record) => stale.has(record.path))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, limit))
    .map((record) => record.path);
}

export function sharedFixExpired(fix: SharedFix, now = Date.now()): boolean {
  return Date.parse(fix.created_at) + SHARED_FIX_RETENTION_MS <= now;
}

function nullableString(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

export function validSharedFix(value: unknown, id: string): value is SharedFix {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fix = value as Partial<SharedFix>;
  let canonicalRepo = "";
  try { canonicalRepo = parseRunTarget(fix.repo).repo; }
  catch { return false; }
  const createdAt = typeof fix.created_at === "string" ? Date.parse(fix.created_at) : Number.NaN;
  const scoped = SCOPED_SHARED_FIX_ID.exec(id);
  return sharedFixPath(id) !== null && fix.id === id && fix.repo === canonicalRepo &&
    (fix.pr_number === null || (Number.isSafeInteger(fix.pr_number) && fix.pr_number! > 0)) &&
    nullableString(fix.comment_body, 500) &&
    typeof fix.fix_response === "string" && fix.fix_response.length > 0 && fix.fix_response.length <= 10_000 &&
    nullableString(fix.diff, 10_000) && nullableString(fix.explainer, 2_000) &&
    Number.isFinite(createdAt) && (!scoped || Math.abs(createdAt - Number(scoped[1])) <= 5_000);
}
