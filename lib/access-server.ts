// Access checks that read storage: Node runtime only. middleware.ts runs on the edge, where
// @vercel/blob cannot load, so it uses lib/access.ts directly and asks /api/access (which uses
// this) about signed-in accounts the invited list does not cover.

import { isClassMember } from "./classes";
import { getDb } from "./db/client";
import { approvedGithubIds } from "./interest";
import { hasAccess, inviteOnly, invitedGithubIds } from "./access";

/** Whether this subject may use the app: the invited list, members of a class invite
 *  (lib/classes.ts), and accounts approved from the admin page (lib/interest.ts). Storage is
 *  only asked about accounts the list doesn't cover; each check fails closed on its own. */
export async function canUse(sub: string | null | undefined): Promise<boolean> {
  if (!inviteOnly()) return true;
  const invited = invitedGithubIds();
  if (hasAccess(sub, invited)) return true;
  if (typeof sub === "string" && /^github\|\d+$/.test(sub) && await classMember(sub)) return true;
  return hasAccess(sub, await approvedGithubIds());
}

async function classMember(sub: string): Promise<boolean> {
  try {
    return await isClassMember(await getDb(), sub);
  } catch (error) {
    console.error("[access] could not read class memberships; that route in is closed for now", error);
    return false;
  }
}

/** The accounts that manage access requests (/admin/access), from OPENSRCER_ADMIN_GITHUB_IDS
 *  in the same format as the invited list. Unset admits nobody (fails closed). */
export function isAdmin(sub: string | null | undefined, admins = invitedGithubIds(process.env.OPENSRCER_ADMIN_GITHUB_IDS ?? "")): boolean {
  const match = typeof sub === "string" ? /^github\|(\d+)$/.exec(sub) : null;
  return Boolean(match && admins.has(match[1]));
}
