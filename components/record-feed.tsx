"use client";

// What /issues shows from the record (PLAN §9.5), from GET /api/record/feed:
// unread "you know this code" alerts, each dismissible, and the "Next in
// <area>" card after a merge. In-app only. Renders nothing when there is
// nothing to show; the page mounts it only with OPENSRCER_RECORD.

import { useEffect, useState } from "react";

type Alert = {
  id: number; repo: string; number: number; title: string | null;
  reason: { nodes: string[]; changed: boolean; area: string | null };
};
type NextCard = { repo: string; pr: number; area: string | null; issues: Array<{ repo: string; number: number; title: string; why: string[] }> };
type Feed = { alerts: Alert[]; next: NextCard | null };

const issueHref = (repo: string, number: number) => `/issues?repo=${encodeURIComponent(repo)}&issue=${number}`;

export function RecordFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/record/feed", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as Partial<Feed> & { error?: string };
        if (!r.ok || !body.alerts) throw new Error(body.error ?? "Could not load your alerts.");
        setFeed({ alerts: body.alerts, next: body.next ?? null });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function dismiss(which: number | "all") {
    setError(null);
    const r = await fetch("/api/record/feed", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(which === "all" ? { action: "dismiss", all: true } : { action: "dismiss", id: which }),
    }).catch(() => null);
    if (!r?.ok) { setError("Could not dismiss that. Try again."); return; }
    setFeed((f) => f && { ...f, alerts: which === "all" ? [] : f.alerts.filter((a) => a.id !== which) });
  }

  if (error && !feed) return <p role="alert" className="mb-6 text-[14px] text-alert">{error}</p>;
  if (!feed || (!feed.alerts.length && !feed.next)) return null;
  return (
    <section aria-label="From your record" className="mb-10 grid gap-4 lg:grid-cols-2">
      {feed.alerts.length > 0 && (
        <div className="card px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="label-mono">You know this code</h2>
            {feed.alerts.length > 1 && <button type="button" onClick={() => void dismiss("all")} className="link text-[13px]">Dismiss all</button>}
          </div>
          <ul className="mt-2 divide-y divide-border-soft">
            {feed.alerts.map((alert) => (
              <li key={alert.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <a href={issueHref(alert.repo, alert.number)} className="text-[15px] font-semibold text-paper hover:text-signal">{alert.title ?? `${alert.repo} #${alert.number}`}</a>
                  <p className="meta mt-0.5">
                    <span>{alert.repo} #{alert.number}</span>
                    <span>new, near code you {alert.reason.changed ? "changed" : "explained"}{alert.reason.area ? ` in ${alert.reason.area}` : ""}</span>
                  </p>
                </div>
                <button type="button" onClick={() => void dismiss(alert.id)} className="btn-quiet shrink-0" data-size="sm" aria-label={`Dismiss the alert for ${alert.repo} #${alert.number}`}>Dismiss</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {feed.next && (
        <div className="card px-5 py-4">
          <h2 className="label-mono">Next in {feed.next.area ?? feed.next.repo}</h2>
          <p className="mt-1 text-[14px] text-paper-muted">Your PR {feed.next.repo}#{feed.next.pr} was merged. These open issues sit nearest the code you changed.</p>
          <ul className="mt-2 divide-y divide-border-soft">
            {feed.next.issues.map((issue) => (
              <li key={issue.number} className="py-2.5">
                <a href={issueHref(issue.repo, issue.number)} className="text-[15px] font-semibold text-paper hover:text-signal">{issue.title}</a>
                <p className="meta mt-0.5"><span>{issue.repo} #{issue.number}</span>{issue.why.slice(0, 2).map((why) => <span key={why}>{why}</span>)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="text-[14px] text-alert lg:col-span-2">{error}</p>}
    </section>
  );
}
