// /crucible/orgs/[org]/repos/[repo] — unified findings view:
// advisories + dependabot alerts + open issues, all fetched with the
// installation token. The deep/quick-solve CTA dispatches agentic with
// orgCtx so Phase 3's installation-token path activates.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@auth0/nextjs-auth0";
import { PageHeading } from "@/components/page-heading";
import { mappingForOrg } from "@/lib/crucible/orgs";
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
  const base = "inline-block px-1.5 py-0.5 text-[10px] font-mono border";
  switch (sev) {
    case "critical":
      return `${base} border-red-700 bg-red-950/60 text-red-200`;
    case "high":
      return `${base} border-orange-700 bg-orange-950/40 text-orange-200`;
    case "medium":
      return `${base} border-yellow-700 bg-yellow-950/40 text-yellow-200`;
    case "low":
      return `${base} border-blue-700 bg-blue-950/40 text-blue-200`;
    default:
      return `${base} border-border-soft text-paper-muted`;
  }
}

export default async function RepoFindingsPage({
  params,
}: {
  params: Promise<{ org: string; repo: string }>;
}) {
  const { org, repo } = await params;
  const session = await getSession();
  const sub = session?.user?.sub;
  if (!sub) notFound();

  const mapping = mappingForOrg(sub, org);
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
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>{repoFull}</>}
        description={
          <>
            Security findings + open issues. Click <span className="text-paper">deep solve</span>{" "}
            on any row to dispatch an agentic run scoped to this repo. Patches
            that pass the repo&apos;s own tests get opened as draft PRs.
          </>
        }
      />

      <div className="mt-4 text-[12px] text-paper-muted">
        <Link href={`/crucible/orgs/${org}`} className="hover:text-paper">
          ← repos in {org}
        </Link>
      </div>

      {loadError && (
        <div className="mt-4 border border-red-900/60 bg-red-950/30 p-3 text-[12.5px] text-red-200">
          Failed to load findings: {loadError}
        </div>
      )}

      <section className="mt-6">
        <div className="flex items-center gap-3">
          <span className="mono-label text-paper-muted">
            security findings ({findings.length})
          </span>
          {findings.length > 0 && (
            <span className="text-[10px] tabular-nums text-paper-dim border border-border-soft px-1.5 py-0.5">
              {findings.filter(f => f.severity === "critical").length} critical · {findings.filter(f => f.severity === "high").length} high
            </span>
          )}
        </div>
        {findings.length === 0 ? (
          <div className="mt-2 border border-border bg-surface/40 p-4 text-[12px] text-paper-dim">
            No open advisories or Dependabot alerts.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border-soft border border-border bg-surface/40">
            {findings.map((f) => (
              <li key={`${f.kind}-${f.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={severityChip(f.severity)}>{f.severity}</span>
                      <span className="text-[10.5px] font-mono text-paper-muted">
                        {f.kind}
                      </span>
                      {f.cveId && (
                        <span className="text-[10.5px] font-mono text-paper-muted">
                          {f.cveId}
                        </span>
                      )}
                      {f.affectedPackage && (
                        <span className="text-[10.5px] font-mono text-paper-muted">
                          {f.affectedPackage}
                          {f.affectedVersions ? ` ${f.affectedVersions}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[13px] text-paper">{f.summary}</div>
                    <div className="mt-0.5 text-[11px] text-paper-muted">
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
        <div className="mono-label text-paper-muted">
          open issues ({issues.length})
        </div>
        {issues.length === 0 ? (
          <div className="mt-2 border border-border bg-surface/40 p-4 text-[12px] text-paper-dim">
            No open issues.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border-soft border border-border bg-surface/40">
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
                          className="text-[10px] font-mono text-paper-muted border border-border-soft px-1.5"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-0.5 text-[11px] text-paper-muted">
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
