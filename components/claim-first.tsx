"use client";

// "Ask first": when a project closes PRs from people who weren't assigned to
// the issue, or who didn't agree the approach first (lib/repo-profile.ts
// engagementAdvice), say so before any code is written, with a draft comment
// the contributor finishes and posts themselves. opensrcer never posts it.

import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import type { EngagementAdvice } from "@/lib/repo-profile";

const HEADLINE: Record<EngagementAdvice["reason"], (a: EngagementAdvice) => string> = {
  not_assigned: (a) => `${a.count} of ${a.of} recently closed outside PRs here were opened without being assigned to the issue. Ask to be assigned first, and wait for a yes.`,
  discuss_first: (a) => `${a.count} of ${a.of} recently closed outside PRs here were closed because the approach hadn't been discussed. Agree it on the issue first.`,
};

export function ClaimFirstCard({ advice }: { advice: EngagementAdvice }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="callout mt-4 max-w-3xl" data-tone="info">
      <p className="font-semibold text-paper">Before you write code</p>
      <p className="mt-1 text-paper-dim">{HEADLINE[advice.reason](advice)}</p>
      <p className="label-mono mt-3 mb-1.5">A comment to finish and post on the issue yourself</p>
      <p className="whitespace-pre-wrap rounded-[10px] bg-surface px-3 py-2 text-[15px] text-paper">{advice.comment}</p>
      <button type="button" className="btn-quiet mt-2" data-size="sm" onClick={() => copyText(advice.comment).then(() => setCopied(true), () => setCopied(false))}>
        {copied ? "Copied" : "Copy the draft"}
      </button>
    </div>
  );
}

/** Reads the repo's profile (stored for a day after the first read) and shows the card if it applies. */
export function ClaimFirst({ repo }: { repo: string }) {
  const [advice, setAdvice] = useState<EngagementAdvice | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setAdvice(null);
    fetch(`/api/repos/${repo}/profile`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { advice?: EngagementAdvice | null } | null) => setAdvice(body?.advice ?? null))
      // The card is a hint: without the profile, the scanner works as before.
      .catch(() => {});
    return () => controller.abort();
  }, [repo]);
  return advice ? <ClaimFirstCard advice={advice} /> : null;
}
