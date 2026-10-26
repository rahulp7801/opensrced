// Access checks that read storage: Node runtime only. middleware.ts runs on the edge, where
// @vercel/blob cannot load, so it uses lib/access.ts directly and asks /api/access (which uses
// this) about signed-in accounts the invited list does not cover.

import { approvedGithubIds } from "./interest";
import { hasAccess, inviteOnly, invitedGithubIds } from "./access";

/** Whether this subject may use the app: the invited list, plus accounts admitted from the
 *  admin page (lib/interest.ts). Storage is only asked about accounts the list doesn't cover. */
export async function canUse(sub: string | null | undefined): Promise<boolean> {
  if (!inviteOnly()) return true;
  const invited = invitedGithubIds();
  if (hasAccess(sub, invited)) return true;
  return hasAccess(sub, await approvedGithubIds());
}

/** The accounts that manage access requests (/admin/access), from OPENSRCER_ADMIN_GITHUB_IDS
 *  in the same format as the invited list. Unset admits nobody (fails closed). */
export function isAdmin(sub: string | null | undefined, admins = invitedGithubIds(process.env.OPENSRCER_ADMIN_GITHUB_IDS ?? "")): boolean {
  const match = typeof sub === "string" ? /^github\|(\d+)$/.exec(sub) : null;
  return Boolean(match && admins.has(match[1]));
}
