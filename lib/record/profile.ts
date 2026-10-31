// The public profile, /u/<login> (PLAN §9.5 item 6), opt-in and off by
// default (users.settings.publicProfile). What a maintainer vetting a
// contributor sees: merged PRs, each linked to GitHub; the level those PRs
// earned; per-repo counts; and "explained in their own words" badges, each
// linked to the PR whose lesson passed explain-it. Never the private signals:
// no spam flags, no opened or closed PRs, no opened-to-merged ratio.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { contributions, lessonSteps, lessons, repos, users } from "../db/schema";
import { flagEnabled } from "../flags";
import { siteUrl } from "../site-url";
import { LEVELS, type Level } from "./levels";
import { assertLogin, ensureUser, UnknownUserError } from "./standing";

/** No public profile under this login: missing, not opted in, or ambiguous.
 *  The page answers all three with the same 404. */
export class ProfileNotFoundError extends Error {
  constructor(login: string) {
    super(`No public profile for ${JSON.stringify(login.slice(0, 50))}`);
    this.name = "ProfileNotFoundError";
  }
}

const optedIn = sql`(${users.settings} ->> 'publicProfile') = 'true'`;

/** Turn the profile on or off. `login` (GitHub's, checked) is refreshed on
 *  the row, since /u/<login> is found by it. */
export async function setPublicProfile(db: Db, userId: string, login: string, on: boolean): Promise<void> {
  if (typeof on !== "boolean") throw new TypeError("on must be true or false");
  await ensureUser(db, userId, login);
  await db.update(users).set({ settings: sql`${users.settings} || ${JSON.stringify({ publicProfile: on })}::jsonb` }).where(eq(users.id, userId));
}

/** Whether the user opted in. Throws UnknownUserError. */
export async function profileIsPublic(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ on: optedIn }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new UnknownUserError(userId);
  return row.on === true;
}

/** The link for the PR body's "How I approached this", or null when the user
 *  has no public profile. */
export async function publicProfileUrl(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ login: users.login, on: optedIn }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.on === true ? `${siteUrl()}/u/${encodeURIComponent(row.login)}` : null;
}

const prUrl = (owner: string, name: string, n: number) => `https://github.com/${owner}/${name}/pull/${n}`;

export type PublicProfile = {
  login: string;
  level: Level;
  merged: Array<{ repo: string; number: number; url: string; mergedAt: string | null; source: "opensrcer" | "imported" }>;
  perRepo: Array<{ repo: string; merged: number }>;
  /** Lessons whose explain-it passed, with the PR that came out of them. */
  explained: Array<{ repo: string; issue: number; prUrl: string }>;
};

/** The public profile under `login` (case-insensitive). Throws ProfileNotFoundError. */
export async function publicProfile(db: Db, login: string): Promise<PublicProfile> {
  assertLogin(login);
  // A renamed account can leave an old row under someone else's login; two
  // opted-in rows for one login are not guessed between.
  const rows = await db.select({ id: users.id, login: users.login, level: users.level }).from(users)
    .where(and(eq(sql`lower(${users.login})`, login.toLowerCase()), optedIn)).limit(2);
  if (rows.length !== 1) throw new ProfileNotFoundError(login);
  const user = rows[0];

  const merged = await db.select({ owner: repos.owner, name: repos.name, number: contributions.prNumber, mergedAt: contributions.mergedAt, source: contributions.source })
    .from(contributions).innerJoin(repos, eq(repos.id, contributions.repoId))
    .where(and(eq(contributions.userId, user.id), eq(contributions.state, "merged")))
    .orderBy(desc(contributions.mergedAt)).limit(200);
  const perRepo = new Map<string, number>();
  for (const m of merged) perRepo.set(`${m.owner}/${m.name}`, (perRepo.get(`${m.owner}/${m.name}`) ?? 0) + 1);

  // explain-it passed (done means passed for a graded step), and a PR to show it on.
  const explained = await db.select({ owner: repos.owner, name: repos.name, issue: lessons.issueNumber, number: contributions.prNumber })
    .from(lessons)
    .innerJoin(lessonSteps, and(eq(lessonSteps.lessonId, lessons.id), eq(lessonSteps.step, "explain-it"), eq(lessonSteps.done, true)))
    .innerJoin(contributions, eq(contributions.lessonId, lessons.id))
    .innerJoin(repos, eq(repos.id, contributions.repoId))
    .where(and(eq(lessons.userId, user.id), inArray(contributions.state, ["open", "merged"])))
    .orderBy(desc(lessons.startedAt)).limit(100);

  return {
    login: user.login,
    level: LEVELS[user.level] ?? "newcomer",
    merged: merged.map((m) => ({ repo: `${m.owner}/${m.name}`, number: m.number, url: prUrl(m.owner, m.name, m.number), mergedAt: m.mergedAt?.toISOString() ?? null, source: m.source })),
    perRepo: [...perRepo.entries()].map(([repo, count]) => ({ repo, merged: count })).sort((a, b) => b.merged - a.merged || a.repo.localeCompare(b.repo)),
    explained: explained.map((e) => ({ repo: `${e.owner}/${e.name}`, issue: e.issue, prUrl: prUrl(e.owner, e.name, e.number) })),
  };
}

/** publicProfileUrl behind OPENSRCER_RECORD; null while it is off. */
export async function profileUrlFor(userId: string): Promise<string | null> {
  return flagEnabled("record") ? publicProfileUrl(await getDb(), userId) : null;
}
