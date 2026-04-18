// /crucible/orgs/[org] — list of private repos the installation can see.
// Server component — session-gated by middleware, but we double-check so
// a stale mapping doesn't leak one user's repos to another Auth0 account.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@auth0/nextjs-auth0";
import { PageHeading } from "@/components/page-heading";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { listInstallationRepos } from "@/lib/crucible/advisories";

export const dynamic = "force-dynamic";

export default async function OrgReposPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const session = await getSession();
  const sub = session?.user?.sub;
  if (!sub) notFound();

  const mapping = mappingForOrg(sub, org);
  if (!mapping) notFound();

  let repos: Awaited<ReturnType<typeof listInstallationRepos>> = [];
  let error: string | null = null;
  try {
    repos = await listInstallationRepos(mapping.installation_id);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>{org}</>}
        description={
          <>
            Private repos reachable via the <code>opensrcer-crucible</code>{" "}
            installation. Click a repo to scan for advisories, Dependabot
            alerts, and open issues.
          </>
        }
      />

      <div className="mt-4 text-[12px] text-paper-muted">
        <Link href="/crucible" className="hover:text-paper">
          ← all connected orgs
        </Link>
      </div>

      {error && (
        <div className="mt-4 border border-red-900/60 bg-red-950/30 p-3 text-[12.5px] text-red-200">
          Failed to load repos: {error}
        </div>
      )}

      <section className="mt-6">
        <div className="mono-label text-paper-muted">
          {repos.length} repo{repos.length === 1 ? "" : "s"} accessible
        </div>
        {repos.length === 0 ? (
          <div className="mt-2 border border-border bg-surface/40 p-6 text-[12.5px] text-paper-dim leading-relaxed">
            The installation has no repositories yet. Add repos via the GitHub
            App settings for <code>{org}</code>, then return here.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border-soft border border-border bg-surface/40">
            {repos.map((r) => (
              <li
                key={r.fullName}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] text-paper truncate">
                    {r.name}
                    {r.private && (
                      <span className="ml-2 text-[10.5px] text-paper-muted border border-border-soft px-1.5 py-0.5">
                        private
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-paper-dim truncate">
                    {r.description || "(no description)"}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-paper-muted">
                    {r.language || "—"} · default: {r.defaultBranch} · updated{" "}
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <Link
                  href={`/crucible/orgs/${org}/repos/${r.name}`}
                  className="text-[12px] text-paper-dim hover:text-paper shrink-0 ml-4"
                >
                  scan →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
