// The own-words result, kept on the server (PLAN §7.7). /api/understand in
// run mode records what happened here; the publish gate (lib/publish.ts
// assertUnderstood) reads it, so the gate no longer lives only in the browser.
//
// One small record per run: a private Blob next to the run's other records
// on hosted runs (outside every worker token's scope), or
// .dispatches/<id>/understanding.json locally. Only the text's hash is kept:
// the explanation itself travels in the publish request, which must match it.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, updateJson } from "./blob-store";
import { cloudExecution, runUnderstandingPath } from "./cloud-run-state";

export type UnderstandingRecord = {
  version: 1;
  /** sha256 of the normalized explanation that passed the check. */
  passed_sha?: string;
  passed_at?: string;
  /** Practice-review answers that got feedback after a pass. */
  practiced: number;
  /** The check could not run for this run (no key, provider error, unusable reply). */
  unavailable_at?: string;
};

export type UnderstandingEvent =
  | { kind: "passed"; text: string }
  | { kind: "practiced" }
  | { kind: "unavailable" };

/** The explanation as the PR will carry it: newlines normalized, control
 *  characters removed, blank runs collapsed. parseAuthorWords uses the same. */
export function normalizeExplanation(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function explanationSha(text: string): string {
  return createHash("sha256").update(normalizeExplanation(text)).digest("hex");
}

/** The record after one event. A later pass replaces the earlier one (the
 *  newest checked text is the one to publish); a failed check changes
 *  nothing, so an earlier passing text stays publishable. */
export function applyUnderstandingEvent(record: UnderstandingRecord | null, event: UnderstandingEvent, now = new Date()): UnderstandingRecord {
  const base: UnderstandingRecord = record ?? { version: 1, practiced: 0 };
  if (event.kind === "passed") return { ...base, passed_sha: explanationSha(event.text), passed_at: now.toISOString(), practiced: 0 };
  if (event.kind === "practiced") return base.passed_sha ? { ...base, practiced: Math.min(base.practiced + 1, 10) } : base;
  return { ...base, unavailable_at: now.toISOString() };
}

function validRecord(value: unknown): value is UnderstandingRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<UnderstandingRecord>;
  return r.version === 1 && typeof r.practiced === "number" &&
    (r.passed_sha === undefined || (typeof r.passed_sha === "string" && /^[a-f0-9]{64}$/.test(r.passed_sha)));
}

const LOCAL_ID_RE = /^d_[A-Za-z0-9_-]{1,64}$/;
function localPath(id: string): string {
  if (!LOCAL_ID_RE.test(id)) throw new Error("Invalid run id");
  return join(process.cwd(), ".dispatches", id, "understanding.json");
}

export async function readUnderstanding(owner: string, runId: string): Promise<UnderstandingRecord | null> {
  if (cloudExecution()) {
    const found = await readJson<unknown>(runUnderstandingPath(owner, runId), 10_000);
    return found && validRecord(found.value) ? found.value : null;
  }
  try {
    const value: unknown = JSON.parse(readFileSync(localPath(runId), "utf8"));
    return validRecord(value) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Record one event. The caller owns the run (lib/run-change.ts checked it). */
export async function recordUnderstanding(owner: string, runId: string, event: UnderstandingEvent): Promise<void> {
  if (cloudExecution()) {
    await updateJson<unknown>(runUnderstandingPath(owner, runId), null, (value) => applyUnderstandingEvent(validRecord(value) ? value : null, event));
    return;
  }
  // ponytail: read-modify-write without a lock; one owner clicking one page.
  const path = localPath(runId);
  const next = applyUnderstandingEvent(await readUnderstanding(owner, runId), event);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
