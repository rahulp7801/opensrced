// Private preview: who may use the app.
//
// The hosted product is an invite-only preview: the public sees the landing
// page, the demo and the waitlist, and every app page and API needs a signed-in
// account listed in OPENSRCER_INVITED_GITHUB_IDS. This fails closed: it is on
// unless OPENSRCER_ACCESS is exactly "open", and a Vercel production deployment
// is never open, whatever its settings say (a missing or mistyped variable must
// not open the site). Local development without Auth0 (AUTH_DISABLED=1) skips
// the gate entirely, as before.
//
// Invites are numeric GitHub account ids (`gh api user --jq .id`), matched
// against the Auth0 subject `github|<id>`. Not logins: a login can be renamed
// and then claimed by someone else; the numeric id never changes.

/** True unless the app was explicitly opened (OPENSRCER_ACCESS=open), and always in production. */
export function inviteOnly(): boolean {
  return process.env.OPENSRCER_ACCESS !== "open" || process.env.VERCEL_ENV === "production";
}

/** The invited GitHub account ids, from a comma- or space-separated list.
 *  Entries may be bare ids or full `github|<id>` subjects. Exported for tests. */
export function invitedGithubIds(raw = process.env.OPENSRCER_INVITED_GITHUB_IDS ?? ""): Set<string> {
  return new Set(
    // Tolerate how a value gets pasted into a dashboard: quotes, ";" separators, zero padding.
    raw.split(/[\s,;]+/)
      .map((entry) => entry.trim().replace(/^["']|["']$/g, "").replace(/^github\|/, "").replace(/^0+(?=\d)/, ""))
      .filter((entry) => /^\d+$/.test(entry)),
  );
}

/** Whether this Auth0 subject may use the app. Always true when the app is
 *  open; in invite mode only `github|<invited id>` subjects pass, and an empty
 *  or malformed list admits nobody (fails closed). */
export function hasAccess(sub: string | null | undefined, invited = invitedGithubIds()): boolean {
  if (!inviteOnly()) return true;
  const match = typeof sub === "string" ? /^github\|(\d+)$/.exec(sub) : null;
  return Boolean(match && invited.has(match[1]));
}

