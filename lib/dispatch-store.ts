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
// each transition. Listing becomes readdir + JSON.parse over ~1KB files.
//
// The log files stay exactly as they were — they're for humans to read,
// not for the machine to parse. Dispatches predating the sidecars still
// render, because lib/dispatcher.ts keeps the log-scraping path as a
// fallback for any id with no .json.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dispatch } from "./dispatcher";

const DISPATCH_DIR = join(process.cwd(), ".dispatches");

/** Everything the UI needs, plus the PR URL the log used to be scraped for. */
export type DispatchRecord = Dispatch & { pr_url?: string };

function sidecarPath(id: string): string {
  return join(DISPATCH_DIR, `${id}.json`);
}

/** Write (or overwrite) a dispatch's sidecar. Never throws — losing a
 *  status update must not take down the run it describes. */
export function persist(d: DispatchRecord): void {
  try {
    writeFileSync(sidecarPath(d.id), JSON.stringify(d));
  } catch {
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
    return JSON.parse(readFileSync(sidecarPath(id), "utf8")) as DispatchRecord;
  } catch {
    return null;
  }
}

export function has(id: string): boolean {
  return existsSync(sidecarPath(id));
}

/** Every dispatch that has a sidecar, newest first. */
export function listAll(): DispatchRecord[] {
  if (!existsSync(DISPATCH_DIR)) return [];
  const out: DispatchRecord[] = [];
  for (const f of readdirSync(DISPATCH_DIR)) {
    if (!f.endsWith(".json")) continue;
    // Skip the caches that share this directory.
    if (f === "issue-titles.json" || f === "repo-stars.json") continue;
    const rec = read(f.slice(0, -5));
    if (rec?.id) out.push(rec);
  }
  return out;
}
