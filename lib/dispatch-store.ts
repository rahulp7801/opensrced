// Dispatch state, persisted as one small JSON sidecar per dispatch.
//
// Why this exists: dispatch state used to be *reconstructed* by reading
// every .dispatches/*.log in full and running six regexes over each — once
// in listDispatches() to parse the header, again in enrichWithPrStatus()
// to work out what the auto-PR did. The dashboard polls that list every
// 2.5s. At 100 dispatches with 500KB logs that is ~100MB of disk read per
// poll cycle, and the answer is only ever as good as the regexes.
//
// The dispatcher already knows every one of those facts at the moment it
// happens. So write them down: `<id>.json` next to `<id>.log`, updated at
// each transition. The dashboard asks only for its newest records, while
// stats and PR history can still request the complete set.
//
// The log files stay exactly as they were — they're for humans to read,
// not for the machine to parse. Ownerless runs from before sidecars are not
// served because their ownership cannot be established safely.

import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dispatch } from "./dispatcher";

const DISPATCH_DIR = join(process.cwd(), ".dispatches");

/** Everything the UI needs, plus the PR URL the log used to be scraped for. */
export type DispatchRecord = Dispatch & {
  pr_url?: string;
  stats?: { cost_usd: number | null; has_diff: boolean };
};

function sidecarPath(id: string): string {
  return join(DISPATCH_DIR, `${id}.json`);
}

/** Write (or overwrite) a dispatch's sidecar. Never throws — losing a
 *  status update must not take down the run it describes. */
export function persist(d: DispatchRecord): void {
  const target = sidecarPath(d.id);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(d), { mode: 0o600 });
    renameSync(temporary, target);
  } catch {
    try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
    /* best effort: the log is still the source of truth for humans */
  }
}

/** Merge a partial update into an existing sidecar. */
export function patch(id: string, fields: Partial<DispatchRecord>): void {
  const current = read(id);
  if (!current) return;
  persist({ ...current, ...fields });
}

export function read(id: string): DispatchRecord | null {
  try {
    const value = JSON.parse(readFileSync(sidecarPath(id), "utf8")) as Partial<DispatchRecord>;
    return typeof value.id === "string" && value.id === id ? value as DispatchRecord : null;
  } catch {
    return null;
  }
}

export function has(id: string): boolean {
  return existsSync(sidecarPath(id));
}

/** Dispatches with sidecars, newest first. A bounded owner query stops as
 * soon as it has enough records, keeping the dashboard polling path cheap. */
export function listAll(owner?: string, limit = Number.POSITIVE_INFINITY): DispatchRecord[] {
  if (!existsSync(DISPATCH_DIR)) return [];
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : Number.POSITIVE_INFINITY;
  if (cappedLimit === 0) return [];
  const out: DispatchRecord[] = [];
  const files = readdirSync(DISPATCH_DIR).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    // Skip the caches that share this directory.
    if (f === "issue-titles.json" || f === "repo-stars.json") continue;
    const rec = read(f.slice(0, -5));
    if (!rec?.id || (owner && rec.auth0_user_id !== owner)) continue;
    out.push(rec);
    if (out.length >= cappedLimit) break;
  }
  return out;
}
