// Private preview: who may use the app.
//
// OPENSRCER_ACCESS=invite turns the hosted product into an invite-only preview:
// the public sees a short "coming soon" page, and every app page and API needs
// a signed-in account listed in OPENSRCER_INVITED_GITHUB_IDS. Unset (or any
// other value) means open, as before, so local development and the smoke
// suites are unaffected.
//
// Invites are numeric GitHub account ids (`gh api user --jq .id`), matched
// against the Auth0 subject `github|<id>`. Not logins: a login can be renamed
// and then claimed by someone else; the numeric id never changes.

/** True when the app is running as an invite-only preview. */
export function inviteOnly(): boolean {
  return process.env.OPENSRCER_ACCESS === "invite";
}

/** The invited GitHub account ids, from a comma- or space-separated list.
 *  Entries may be bare ids or full `github|<id>` subjects. Exported for tests. */
export function invitedGithubIds(raw = process.env.OPENSRCER_INVITED_GITHUB_IDS ?? ""): Set<string> {
  return new Set(
    raw.split(/[\s,]+/)
      .map((entry) => entry.trim().replace(/^github\|/, ""))
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
