// /crucible/orgs/[org]/repos/[repo] — unified findings view:
// advisories + dependabot alerts + open issues, all fetched with the
// installation token. The deep/quick-solve CTA dispatches agentic with
// orgCtx so Phase 3's installation-token path activates.

import Link from "next/link";
import { notFound } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasAccess } from "@/lib/access";
import { PageHeading } from "@/components/page-heading";
import { mappingForRequest } from "@/lib/crucible/tokens";
import { sanitizeGitHubName } from "@/lib/sanitize";
import {
  listAdvisories,
  listDependabotAlerts,
  listInstallationIssues,
  type SecurityFinding,
  type RepoIssue,
} from "@/lib/crucible/advisories";
import { SolveButton } from "./solve-button";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

function severityChip(sev: SecurityFinding["severity"]) {
  // Semantic tones only: critical and high are alerts, medium asks for a look, low is information.
  const tone = { critical: "chip-alert", high: "chip-alert", medium: "chip-signal", low: "chip-info" }[sev as string] ?? "";
  return `chip font-mono ${tone}`;
}

export const metadata = { title: "Security findings" };

export default async function RepoFindingsPage({
  params,
}: {
  params: Promise<{ org: string; repo: string }>;
}) {
  // Both segments reach GitHub API paths (lib/crucible/advisories.ts); the
  // matching API routes sanitize them, and so must this page.
  const raw = await params;
  const org = sanitizeGitHubName(raw.org);
  const repo = sanitizeGitHubName(raw.repo);
  if (!org || !repo) notFound();
  const session = await auth0.getSession();
  // Invite rule enforced here too, not only in middleware.
  const sub = hasAccess(session?.user?.sub) ? session?.user?.sub : undefined;
  if (!sub) notFound();

  const mapping = await mappingForRequest(sub, org);
  if (!mapping) notFound();

  let advisories: SecurityFinding[] = [];
  let dependabot: SecurityFinding[] = [];
  let issues: RepoIssue[] = [];
  let loadError: string | null = null;

  try {
    const [a, d, i] = await Promise.all([
      listAdvisories(mapping.installation_id, org, repo),
      listDependabotAlerts(mapping.installation_id, org, repo),
      listInstallationIssues(mapping.installation_id, org, repo),
    ]);
    advisories = a;
    dependabot = d;
    issues = i;
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const findings = [...advisories, ...dependabot].sort((a, b) => {
    const sv = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
    if (sv !== 0) return sv;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const repoFull = `${org}/${repo}`;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>{repoFull}</>}
        description={
          <>
            Security findings and open issues. Click <span className="text-paper">Fix issue</span>{" "}
            on any row to start a run scoped to this repo. Each successful run opens a
            draft PR for review and validation by the repository&apos;s CI.
          </>
        }
      />

      <div className="mt-4 flex items-center justify-between">
        <div className="text-[13px] text-paper-muted">
          <Link href={`/crucible/orgs/${org}`} className="hover:text-paper">
            ← repos in {org}
          </Link>
        </div>
        <Link
          href={`/explore?repo=${encodeURIComponent(repoFull)}`}
          className="btn-quiet flex gap-1.5" data-size="sm"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4" /><path d="m13 13-3.5-3.5" /></svg>
          explore codebase
        </Link>
      </div>

      {loadError && (
        <div className="callout callout-alert mt-4 p-3 text-[13.5px] text-alert">
          Failed to load findings: {loadError}
        </div>
      )}

      <section className="mt-6">
        <div className="flex items-center gap-3">
          <span className="kicker text-paper-muted">
            security findings ({findings.length})
          </span>
          {findings.length > 0 && (
            <span className="chip tabular-nums">
              {findings.filter(f => f.severity === "critical").length} critical · {findings.filter(f => f.severity === "high").length} high
            </span>
          )}
        </div>
        {findings.length === 0 ? (
          <div className="card mt-2 p-4 text-[13px] text-paper-dim">
            No open advisories or Dependabot alerts.
          </div>
        ) : (
          <ul className="card mt-2 divide-y divide-border-soft">
            {findings.map((f) => (
              <li key={`${f.kind}-${f.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={severityChip(f.severity)}>{f.severity}</span>
                      <span className="text-[12px] font-mono text-paper-muted">
                        {f.kind}
                      </span>
                      {f.cveId && (
                        <span className="text-[12px] font-mono text-paper-muted">
                          {f.cveId}
                        </span>
                      )}
                      {f.affectedPackage && (
                        <span className="text-[12px] font-mono text-paper-muted">
                          {f.affectedPackage}
                          {f.affectedVersions ? ` ${f.affectedVersions}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[13px] text-paper">{f.summary}</div>
                    <div className="mt-0.5 text-[12px] text-paper-muted">
                      <a href={f.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-paper">
                        view on github ↗
                      </a>
                      {" · "}
                      updated {new Date(f.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <SolveButton
                      repoFull={repoFull}
                      kind={f.kind}
                      findingId={f.id}
                      githubOrg={org}
                      findingSummary={f.summary}
                      findingDescription={f.description}
                      cveId={f.cveId}
                      affectedPackage={f.affectedPackage}
                      affectedVersions={f.affectedVersions}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="kicker text-paper-muted">
          open issues ({issues.length})
        </div>
        {issues.length === 0 ? (
          <div className="card mt-2 p-4 text-[13px] text-paper-dim">
            No open issues.
          </div>
        ) : (
          <ul className="card mt-2 divide-y divide-border-soft">
            {issues.map((i) => (
              <li key={i.number} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-paper">
                    <span className="text-paper-muted">#{i.number}</span> {i.title}
                  </div>
                  {i.labels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.labels.map((l) => (
                        <span
                          key={l}
                          className="chip font-mono"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-0.5 text-[12px] text-paper-muted">
                    <a href={i.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-paper">
                      view on github ↗
                    </a>
                    {" · "}
                    updated {new Date(i.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="shrink-0">
                  <SolveButton
                    repoFull={repoFull}
                    kind="issue"
                    findingId={String(i.number)}
                    githubOrg={org}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
