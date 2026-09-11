import fs from "node:fs";
import path from "node:path";
import { cloudExecution } from "../cloud-run-state";
import { readJson, updateJson } from "../blob-store";

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
  return cloudExecution() ? (await readJson<OrgMapping[]>(BLOB_PATH))?.value ?? [] : readLocal();
}

function readLocal(): OrgMapping[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrgMapping[]) : [];
  } catch {
    return [];
  }
}

async function mutate(update: (rows: OrgMapping[]) => OrgMapping[]) {
  if (cloudExecution()) return updateJson<OrgMapping[]>(BLOB_PATH, [], update);
  const rows = update(readLocal());
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2));
}

export async function listOrgsFor(auth0UserId: string): Promise<OrgMapping[]> {
  return (await readAll()).filter((r) => r.auth0_user_id === auth0UserId);
}

export async function mappingForOrg(auth0UserId: string, githubOrg: string): Promise<OrgMapping | null> {
  return (
    (await readAll()).find(
      (r) => r.auth0_user_id === auth0UserId && r.github_org.toLowerCase() === githubOrg.toLowerCase()
    ) || null
  );
}

export async function mappingByInstallationId(installationId: number): Promise<OrgMapping | null> {
  return (await readAll()).find((r) => r.installation_id === installationId) || null;
}

export async function saveMapping(mapping: OrgMapping) {
  return mutate((rows) => {
    // Upsert on (auth0_user_id, github_org).
    const idx = rows.findIndex(
      (r) =>
        r.auth0_user_id === mapping.auth0_user_id &&
        r.github_org.toLowerCase() === mapping.github_org.toLowerCase()
    );
    if (idx >= 0) rows[idx] = mapping;
    else rows.push(mapping);
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
