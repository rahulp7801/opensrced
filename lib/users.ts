// The account row (users table) and saving first-run onboarding.
//
// A row is upserted when someone signs in (app/welcome/start/route.ts, reached
// from lib/auth0.ts onCallback) and on GET /api/me, which /welcome and
// /account call. Onboarding answers (lib/onboarding.ts) live in users.settings;
// users.onboarded_at says onboarding was finished or skipped, so /welcome is
// shown once, after the first sign-in.
//
// The database is optional in production: without DATABASE_URL, optionalDb()
// answers null and sign-in carries on without onboarding.

import { eq, sql } from "drizzle-orm";
import { dbTarget, getDb, type Db } from "./db/client";
import { users } from "./db/schema";
import { EXPERIENCE_LEVELS, type Experience, type OnboardingAnswers } from "./onboarding";
import { levelName } from "./recs/rank";

export type UserRow = typeof users.$inferSelect;

/** The starting level an experience answer suggests. Only a hint stored in
 *  settings: users.level stays 0 until levels are earned (PLAN.md). */
export function levelHint(experience: Experience): string {
  return levelName(EXPERIENCE_LEVELS.indexOf(experience));
}

function checkIdentity(id: string, login: string): void {
  if (!id || id.length > 200) throw new RangeError("A user id is required");
  if (!login || login.length > 200) throw new RangeError("A login is required");
}

/** Insert the account's row, or refresh its login (GitHub logins can be renamed). */
export async function ensureUser(db: Db, id: string, login: string): Promise<UserRow> {
  checkIdentity(id, login);
  const [row] = await db.insert(users).values({ id, login })
    .onConflictDoUpdate({ target: users.id, set: { login } })
    .returning();
  return row;
}

/** Merge the answers into settings and mark onboarding done. Finishing again
 *  later (from /account) updates the answers but keeps the first date. */
export async function completeOnboarding(db: Db, id: string, login: string, answers: OnboardingAnswers): Promise<UserRow> {
  await ensureUser(db, id, login);
  const patch: Record<string, unknown> = { ...answers };
  if (answers.experience) patch.levelHint = levelHint(answers.experience);
  const [row] = await db.update(users)
    .set({ settings: sql`${users.settings} || ${JSON.stringify(patch)}::jsonb`, onboardedAt: sql`coalesce(${users.onboardedAt}, now())` })
    .where(eq(users.id, id))
    .returning();
  return row;
}

/** Whether this deployment has a database (PGlite locally, Postgres hosted).
 *  dbTarget() is the one place that decides, and it says no by throwing. */
export function dbConfigured(): boolean {
  try {
    dbTarget();
    return true;
  } catch {
    return false;
  }
}

/** The database, or null when this deployment has none. A configured one
 *  that fails to open still throws: callers decide whether that is fatal. */
export async function optionalDb(): Promise<Db | null> {
  return dbConfigured() ? getDb() : null;
}
