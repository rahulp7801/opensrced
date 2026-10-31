// /u/<login>: a contributor's public profile (PLAN §9.5 item 6, lib/record/profile.ts),
// for maintainers deciding whether to trust a PR. Behind OPENSRCER_RECORD and
// opt-in: a login that has not opted in is a 404, the same as one that
// doesn't exist, so the page never says who uses opensrcer privately.

import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { ProfileNotFoundError, publicProfile, type PublicProfile } from "@/lib/record/profile";
import { InvalidLoginError } from "@/lib/record/standing";

export const dynamic = "force-dynamic";

async function load(login: string): Promise<PublicProfile> {
  if (!flagEnabled("record")) notFound();
  try {
    return await publicProfile(await getDb(), decodeURIComponent(login));
  } catch (error) {
    if (error instanceof ProfileNotFoundError || error instanceof InvalidLoginError || error instanceof URIError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ login: string }> }) {
  return { title: `${(await load((await params).login)).login} on opensrcer` };
}

const LEVEL_TEXT: Record<PublicProfile["level"], string> = {
  newcomer: "Newcomer: no merged PR yet.",
  contributor: "Contributor: at least one merged PR.",
  regular: "Regular: several merged PRs, at least one written without the AI's fix, every review answered.",
  trusted: "Trusted: ten or more merged PRs and maintainer approvals.",
};

export default async function ProfilePage({ params }: { params: Promise<{ login: string }> }) {
  const p = await load((await params).login);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "");
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8">
      <PageHeading
        path="profile"
        title={p.login}
        description={<>Open-source contributions, as recorded by opensrcer. Every line links to the evidence on GitHub. <a href={`https://github.com/${p.login}`} className="text-link" rel="noreferrer">github.com/{p.login}</a></>}
      />

      <section aria-labelledby="level-heading" className="border-t-2 border-paper py-6">
        <h2 id="level-heading" className="label-mono">Level</h2>
        <p className="mt-2 text-[18px] font-semibold capitalize text-paper">{p.level}</p>
        <p className="mt-1 text-[14px] text-paper-muted">{LEVEL_TEXT[p.level]} Earned from the merged PRs below.</p>
      </section>

      <section aria-labelledby="merged-heading" className="border-t border-border py-6">
        <h2 id="merged-heading" className="label-mono">Merged pull requests ({p.merged.length})</h2>
        {p.merged.length === 0 ? <p className="mt-2 text-paper-muted">None yet.</p> : (
          <>
            <ul className="mt-3 flex flex-wrap gap-2 text-[14px]" aria-label="By project">
              {p.perRepo.map((r) => <li key={r.repo} className="pill" data-size="sm">{r.repo}: {r.merged}</li>)}
            </ul>
            <ul className="card mt-4 divide-y divide-border-soft">
              {p.merged.map((m) => (
                <li key={m.url} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <a href={m.url} className="text-link font-mono text-[14px]" rel="noreferrer">{m.repo}#{m.number}</a>
                  <span className="text-[13px] text-paper-muted">
                    merged {date(m.mergedAt)}{m.source === "imported" ? " · from their GitHub history" : " · through opensrcer"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="explained-heading" className="border-t border-border py-6">
        <h2 id="explained-heading" className="label-mono">Explained in their own words</h2>
        <p className="mt-1 max-w-[62ch] text-[14px] text-paper-muted">
          Before publishing, they explained the change file by file and why its test proves it, checked against the diff. The PR shows their explanation.
        </p>
        {p.explained.length === 0 ? <p className="mt-2 text-paper-muted">None yet.</p> : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {p.explained.map((e) => (
              <li key={e.prUrl}><a href={e.prUrl} className="pill" data-size="sm" rel="noreferrer">✓ {e.repo} issue #{e.issue}</a></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
