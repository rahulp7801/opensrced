"use client";

// A repository's profile: the unwritten rules, measured from its recent PRs
// (lib/repo-profile.ts). Each finding links to the PRs behind it.

import { use, useEffect, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import type { EngagementAdvice, Finding, RepoProfile } from "@/lib/repo-profile";
import { ClaimFirstCard } from "@/components/claim-first";

const SECTIONS: Array<{ id: Finding["section"]; title: string }> = [
  { id: "start", title: "Before you start" },
  { id: "wanted", title: "What maintainers are asking for" },
  { id: "outcomes", title: "What happens to outside contributors' PRs" },
  { id: "closed", title: "Why PRs get closed" },
  { id: "review", title: "What reviewers ask for" },
  { id: "pace", title: "How fast things move" },
  { id: "community", title: "Where the project talks" },
  { id: "conventions", title: "House conventions" },
];

type State = { profile: RepoProfile; findings: Finding[]; advice: EngagementAdvice | null } | { error: string } | null;

// PRs, issues and discussions show their number; a Discussions category its name.
const prNumber = (url: string) => url.includes("/discussions/categories/") ? url.split("/").pop()!.replace(/-/g, " ") : `#${url.split("/").pop()}`;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

export default function RepoProfilePage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = use(params);
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    fetch(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/profile`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({})) as { profile?: RepoProfile; findings?: Finding[]; advice?: EngagementAdvice | null; error?: string };
        setState(r.ok && body.profile && body.findings ? { profile: body.profile, findings: body.findings, advice: body.advice ?? null } : { error: body.error ?? `Could not load the profile (${r.status}).` });
      })
      .catch((e: Error) => { if (e.name !== "AbortError") setState({ error: "Could not reach opensrcer. Check your connection." }); });
    return () => controller.abort();
  }, [owner, repo]);

  const name = state && "profile" in state ? state.profile.repo : `${owner}/${repo}`;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      <PageHeading
        path="find / repo profile"
        title={name}
        description="How this project actually works: what gets merged, what gets closed and why, and what reviewers keep asking for. Measured from its own pull requests."
      />

      {state === null && <p role="status" className="text-paper-muted">Reading the project&apos;s recent pull requests. This takes about 15 seconds the first time…</p>}
      {state && "error" in state && <p role="alert" className="callout" data-tone="alert">{state.error}</p>}

      {state && "profile" in state && (
        <>
          <p className="meta mb-10">
            <span>{state.profile.window.prs} PRs opened {day(state.profile.window.from)} – {day(state.profile.window.to)}</span>
            <span>{state.profile.maintainers} maintainer{state.profile.maintainers === 1 ? "" : "s"} seen</span>
            <a className="text-link" href={`https://github.com/${state.profile.repo}`} target="_blank" rel="noreferrer">Open on GitHub</a>
          </p>

          {state.advice && <div className="mb-10"><ClaimFirstCard advice={state.advice} /></div>}

          {state.findings.length === 0 && (
            <p className="callout" data-tone="info">Too few pull requests in the last four months to say anything reliable about this project yet.</p>
          )}

          {SECTIONS.map(({ id, title }) => {
            const items = state.findings.filter((f) => f.section === id);
            if (!items.length) return null;
            return (
              <section key={id} aria-labelledby={`profile-${id}`} className="mb-10 max-w-3xl">
                <h2 id={`profile-${id}`} className="mb-3 text-[19px] font-semibold tracking-[-0.01em] text-paper">{title}</h2>
                <ul className="space-y-3">
                  {items.map((f) => (
                    <li key={f.text} className="text-[16px] leading-relaxed text-paper-dim">
                      {f.text}
                      {f.examples.length > 0 && (
                        <span className="ml-2 text-[14px] text-paper-muted">
                          e.g.{" "}
                          {f.examples.map((url, i) => (
                            <span key={url}>{i > 0 && ", "}<a className="text-link" href={url} target="_blank" rel="noreferrer">{prNumber(url)}</a></span>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <p className="meta max-w-3xl border-t border-border-soft pt-6">
            <span>
              Counted from GitHub, with no AI writing the claims. Maintainers are the people who merged or closed others&apos; PRs.
              PRs are read from 1–4 months ago (up to two years for quieter projects) so slow reviews count too. Refreshed daily.
            </span>
          </p>
        </>
      )}
    </div>
  );
}
