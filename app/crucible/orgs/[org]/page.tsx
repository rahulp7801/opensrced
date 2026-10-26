// /crucible/orgs/[org] — list of private repos the installation can see.
// Server component — session-gated by middleware, but we double-check so
// a stale mapping doesn't leak one user's repos to another Auth0 account.

import Link from "next/link";
import { notFound } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { canUse } from "@/lib/access-server";
import { PageHeading } from "@/components/page-heading";
import { mappingForRequest } from "@/lib/crucible/tokens";
import { listInstallationRepos } from "@/lib/crucible/advisories";

export const dynamic = "force-dynamic";

export const metadata = { title: "Organization repos" };

export default async function OrgReposPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const session = await auth0.getSession();
  // Invite rule enforced here too, not only in middleware.
  const sub = await canUse(session?.user?.sub) ? session?.user?.sub : undefined;
  if (!sub) notFound();

  const mapping = await mappingForRequest(sub, org);
  if (!mapping) notFound();

  let repos: Awaited<ReturnType<typeof listInstallationRepos>> = [];
  let error: string | null = null;
  try {
    repos = await listInstallationRepos(mapping.installation_id);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
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

      <div className="mt-4 text-[13px] text-paper-muted">
        <Link href="/crucible" className="hover:text-paper">
          ← all connected orgs
        </Link>
      </div>

      {error && (
        <div className="callout callout-alert mt-4 p-3 text-[15px] text-alert">
          Failed to load repos: {error}
        </div>
      )}

      <section className="mt-6">
        <div className="label-mono">
          {repos.length} repo{repos.length === 1 ? "" : "s"} accessible
        </div>
        {repos.length === 0 ? (
          <div className="card mt-2 p-6 text-[15px] text-paper-dim leading-relaxed">
            The installation has no repositories yet. Add repos via the GitHub
            App settings for <code>{org}</code>, then return here.
          </div>
        ) : (
          <ul className="card mt-2 divide-y divide-border-soft">
            {repos.map((r) => (
              <li
                key={r.fullName}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-[15px] text-paper truncate">
                    {r.name}
                    {r.private && (
                      <span className="chip ml-2">
                        private
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-paper-dim truncate">
                    {r.description || "(no description)"}
                  </div>
                  <div className="mt-0.5 text-[12px] text-paper-muted">
                    {r.language || "—"} · default: {r.defaultBranch} · updated{" "}
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <Link
                  href={`/crucible/orgs/${org}/repos/${r.name}`}
                  className="text-[13px] text-paper-dim hover:text-paper shrink-0 ml-4"
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
