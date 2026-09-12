import fs from "node:fs";
import path from "node:path";
import { cloudExecution } from "../cloud-run-state";
import { readJson, updateJson } from "../blob-store";
import { sanitizeGitHubName } from "../sanitize";
import { randomUUID } from "node:crypto";

const BLOB_PATH = "crucible/orgs.json";

const STORE_PATH = path.join(process.cwd(), ".dispatches", "crucible-orgs.json");

export type OrgMapping = {
  auth0_user_id: string;
  github_org: string;
  installation_id: number;
  installer: string;
  verified_at: string;
};

async function readAll(): Promise<OrgMapping[]> {
  const stored = cloudExecution() ? (await readJson<unknown>(BLOB_PATH))?.value : readLocal();
  const rows = Array.isArray(stored) ? stored : [];
  return rows.map(validMapping).filter((row): row is OrgMapping => Boolean(row));
}

function readLocal(): unknown[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function mutate(update: (rows: OrgMapping[]) => OrgMapping[]) {
  if (cloudExecution()) return updateJson<unknown>(BLOB_PATH, [], (value) => {
    const rows = Array.isArray(value) ? value : [];
    return update(rows.map(validMapping).filter((row): row is OrgMapping => Boolean(row)));
  });
  const rows = update(readLocal().map(validMapping).filter((row): row is OrgMapping => Boolean(row)));
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const temporary = `${STORE_PATH}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(rows, null, 2), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, STORE_PATH);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function validMapping(value: unknown): OrgMapping | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<OrgMapping>;
  const auth0UserId = typeof row.auth0_user_id === "string" && row.auth0_user_id.length <= 255 && !/[\x00-\x1F\x7F]/.test(row.auth0_user_id) ? row.auth0_user_id : null;
  const githubOrg = typeof row.github_org === "string" ? sanitizeGitHubName(row.github_org) : null;
  const installer = typeof row.installer === "string" ? sanitizeGitHubName(row.installer) : null;
  const installationId = typeof row.installation_id === "number" && Number.isSafeInteger(row.installation_id) && row.installation_id > 0 ? row.installation_id : null;
  const verifiedAt = typeof row.verified_at === "string" && row.verified_at.length <= 40 && Number.isFinite(Date.parse(row.verified_at)) ? row.verified_at : null;
  return auth0UserId && githubOrg && installer && installationId && verifiedAt
    ? { auth0_user_id: auth0UserId, github_org: githubOrg, installation_id: installationId, installer, verified_at: verifiedAt }
    : null;
}

export async function listOrgsFor(auth0UserId: string): Promise<OrgMapping[]> {
  return (await readAll()).filter((r) => r.auth0_user_id === auth0UserId);
}

export async function mappingForOrg(auth0UserId: string, githubOrg: string): Promise<OrgMapping | null> {
  const safeOrg = sanitizeGitHubName(githubOrg);
  if (!safeOrg) return null;
  return (
    (await readAll()).find(
      (r) => r.auth0_user_id === auth0UserId && r.github_org.toLowerCase() === safeOrg.toLowerCase()
    ) || null
  );
}

export async function mappingByInstallationId(installationId: number): Promise<OrgMapping | null> {
  return (await readAll()).find((r) => r.installation_id === installationId) || null;
}

export async function saveMapping(mapping: OrgMapping) {
  const safeMapping = validMapping(mapping);
  if (!safeMapping) throw new Error("Invalid organization mapping");
  return mutate((rows) => {
    // Upsert on (auth0_user_id, github_org).
    const idx = rows.findIndex(
      (r) =>
        r.auth0_user_id === safeMapping.auth0_user_id &&
        r.github_org.toLowerCase() === safeMapping.github_org.toLowerCase()
    );
    if (idx >= 0) rows[idx] = safeMapping;
    else rows.push(safeMapping);
    return rows;
  });
}

export async function deleteByInstallationId(installationId: number) {
  return mutate((rows) => rows.filter((r) => r.installation_id !== installationId));
}

/** User disconnects leave other members' connections intact. */
export async function deleteMappingsForUser(auth0UserId: string, installationId?: number) {
  if (!auth0UserId) throw new Error("User identity is required");
  return mutate((rows) => rows.filter((r) =>
    r.auth0_user_id !== auth0UserId || (installationId !== undefined && r.installation_id !== installationId)
  ));
}
