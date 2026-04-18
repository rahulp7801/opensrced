// Persistent `auth0_user_id → { github_org, installation_id, ... }` map.
// Flat JSON at .dispatches/crucible-orgs.json. One row per
// (auth0_user_id, github_org) pair — a user can verify multiple orgs.

import fs from "node:fs";
import path from "node:path";

const STORE_PATH = path.join(process.cwd(), ".dispatches", "crucible-orgs.json");

export type OrgMapping = {
  auth0_user_id: string;
  github_org: string;
  installation_id: number;
  installer: string;
  verified_at: string;
};

function readAll(): OrgMapping[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrgMapping[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: OrgMapping[]) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2));
}

export function listOrgsFor(auth0UserId: string): OrgMapping[] {
  return readAll().filter((r) => r.auth0_user_id === auth0UserId);
}

export function mappingForOrg(auth0UserId: string, githubOrg: string): OrgMapping | null {
  return (
    readAll().find(
      (r) => r.auth0_user_id === auth0UserId && r.github_org === githubOrg
    ) || null
  );
}

export function mappingByInstallationId(installationId: number): OrgMapping | null {
  return readAll().find((r) => r.installation_id === installationId) || null;
}

export function saveMapping(mapping: OrgMapping) {
  const rows = readAll();
  // Upsert on (auth0_user_id, github_org).
  const idx = rows.findIndex(
    (r) =>
      r.auth0_user_id === mapping.auth0_user_id &&
      r.github_org === mapping.github_org
  );
  if (idx >= 0) rows[idx] = mapping;
  else rows.push(mapping);
  writeAll(rows);
}

export function deleteByInstallationId(installationId: number) {
  const rows = readAll().filter((r) => r.installation_id !== installationId);
  writeAll(rows);
}
