// Unified security-findings model for crucible. Two GitHub sources get
// normalized to a single `SecurityFinding` shape so the UI can render
// them in one table.
//
//   - Repository security advisories (GHSA, draft/published on the repo)
//       GET /repos/:o/:r/security-advisories
//   - Dependabot alerts (open vulnerabilities the bot has discovered)
//       GET /repos/:o/:r/dependabot/alerts
//
// Both require the GitHub App to have the relevant read permissions
// (`Security events: read`, `Dependabot alerts: read`).

import { installationFetch } from "./github-app";

// In-memory cache for GitHub API responses. TTL keeps data fresh enough
// while avoiding redundant API calls during rapid navigation.
type CacheEntry<T> = { data: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  });
}

export type SecuritySeverity = "low" | "medium" | "high" | "critical" | "unknown";

export type SecurityFinding = {
  kind: "advisory" | "dependabot";
  id: string;
  severity: SecuritySeverity;
  summary: string;
  description: string;
  affectedPackage?: string;
  affectedVersions?: string;
  cveId?: string;
  ghsaId?: string;
  state: string;
  htmlUrl: string;
  updatedAt: string;
};

function normSeverity(s: string | undefined | null): SecuritySeverity {
  if (!s) return "unknown";
  const lower = s.toLowerCase();
  if (["low", "medium", "high", "critical"].includes(lower)) {
    return lower as SecuritySeverity;
  }
  // GHSA can return "moderate" — map to medium so the UI palette stays tight.
  if (lower === "moderate") return "medium";
  return "unknown";
}

type AdvisoryRaw = {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  description: string;
  severity: string;
  state: string;
  html_url: string;
  updated_at: string;
};

type DependabotAlertRaw = {
  number: number;
  state: string;
  security_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    description: string;
    severity: string;
  };
  security_vulnerability: {
    package: { ecosystem: string; name: string };
    vulnerable_version_range: string;
  };
  html_url: string;
  updated_at: string;
};

export async function listAdvisories(
  installationId: number,
  owner: string,
  repo: string,
): Promise<SecurityFinding[]> {
  return cached(`advisories:${owner}/${repo}`, 60_000, () => listAdvisoriesUncached(installationId, owner, repo));
}

async function listAdvisoriesUncached(
  installationId: number,
  owner: string,
  repo: string,
): Promise<SecurityFinding[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/security-advisories?per_page=100`;
  const res = await installationFetch(installationId, url);
  if (!res.ok) {
    // 404 on a repo that has advisories disabled is expected; treat as empty.
    if (res.status === 404) return [];
    throw new Error(`listAdvisories ${owner}/${repo} → ${res.status}`);
  }
  const raw = (await res.json()) as AdvisoryRaw[];
  return raw.map((a) => ({
    kind: "advisory" as const,
    id: a.ghsa_id,
    severity: normSeverity(a.severity),
    summary: a.summary,
    description: a.description,
    cveId: a.cve_id ?? undefined,
    ghsaId: a.ghsa_id,
    state: a.state,
    htmlUrl: a.html_url,
    updatedAt: a.updated_at,
  }));
}

export async function listDependabotAlerts(
  installationId: number,
  owner: string,
  repo: string,
): Promise<SecurityFinding[]> {
  return cached(`dependabot:${owner}/${repo}`, 60_000, () => listDependabotUncached(installationId, owner, repo));
}

async function listDependabotUncached(
  installationId: number,
  owner: string,
  repo: string,
): Promise<SecurityFinding[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`;
  const res = await installationFetch(installationId, url);
  if (!res.ok) {
    // 403 on repos with dependabot disabled / insufficient perms; empty.
    if (res.status === 403 || res.status === 404) return [];
    throw new Error(`listDependabotAlerts ${owner}/${repo} → ${res.status}`);
  }
  const raw = (await res.json()) as DependabotAlertRaw[];
  return raw.map((d) => ({
    kind: "dependabot" as const,
    id: `DEPENDABOT-${d.number}`,
    severity: normSeverity(d.security_advisory.severity),
    summary: d.security_advisory.summary,
    description: d.security_advisory.description,
    affectedPackage: `${d.security_vulnerability.package.ecosystem}/${d.security_vulnerability.package.name}`,
    affectedVersions: d.security_vulnerability.vulnerable_version_range,
    cveId: d.security_advisory.cve_id ?? undefined,
    ghsaId: d.security_advisory.ghsa_id,
    state: d.state,
    htmlUrl: d.html_url,
    updatedAt: d.updated_at,
  }));
}

export type RepoIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  updatedAt: string;
  labels: string[];
};

export async function listInstallationIssues(
  installationId: number,
  owner: string,
  repo: string,
): Promise<RepoIssue[]> {
  return cached(`issues:${owner}/${repo}`, 60_000, () => listIssuesUncached(installationId, owner, repo));
}

async function listIssuesUncached(
  installationId: number,
  owner: string,
  repo: string,
): Promise<RepoIssue[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`;
  const res = await installationFetch(installationId, url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`listInstallationIssues ${owner}/${repo} → ${res.status}`);
  }
  const raw = (await res.json()) as Array<{
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    updated_at: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;
  return raw
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      state: i.state,
      htmlUrl: i.html_url,
      updatedAt: i.updated_at,
      labels: (i.labels ?? []).map((l) => l.name),
    }));
}

export type InstallationRepo = {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  stars: number;
  updatedAt: string;
};

export async function listInstallationRepos(
  installationId: number,
): Promise<InstallationRepo[]> {
  return cached(`repos:${installationId}`, 120_000, () => listReposUncached(installationId));
}

async function listReposUncached(
  installationId: number,
): Promise<InstallationRepo[]> {
  const out: InstallationRepo[] = [];
  let page = 1;
  // GitHub caps at 100 per page; paginate until < 100 returned.
  while (true) {
    const url = `https://api.github.com/installation/repositories?per_page=100&page=${page}`;
    const res = await installationFetch(installationId, url);
    if (!res.ok) {
      throw new Error(`listInstallationRepos → ${res.status}`);
    }
    const body = (await res.json()) as {
      repositories: Array<{
        full_name: string;
        owner: { login: string };
        name: string;
        private: boolean;
        default_branch: string;
        description: string | null;
        language: string | null;
        stargazers_count: number;
        updated_at: string;
      }>;
    };
    for (const r of body.repositories) {
      out.push({
        fullName: r.full_name,
        owner: r.owner.login,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        updatedAt: r.updated_at,
      });
    }
    if (body.repositories.length < 100) break;
    page++;
  }
  return out;
}
