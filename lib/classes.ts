// Class invites: an admin makes one link per class (/class/<code>); a student
// who signs in through it is admitted (lib/access-server.ts canUse), as an
// account approved at /admin/access is. In Postgres, not Blob: a class signs
// up all at once, and access checks must not depend on Blob's request quota.
//
// The rules: a code admits new members until it expires or its uses run out;
// members keep access until the invite is revoked. Joining twice is one use.

import { randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { classInvites, classMembers } from "./db/schema";
import { ensureUser } from "./users";

export const CLASS_NAME_MAX = 80;
export const CLASS_MAX_USES = 1000;
export const CLASS_MAX_DAYS = 365;
/** 10 characters of a 31-letter alphabet without look-alikes (0/O, 1/l/I): ~2^49, typed from a slide. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CLASS_CODE = /^[a-hjkmnp-z2-9]{10}$/;

export type ClassInvite = {
  code: string;
  name: string;
  maxUses: number;
  members: number;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
};

export class ClassInputError extends Error {}
export class ClassNotFoundError extends Error {
  constructor() { super("That class link isn't valid. Check it with your instructor."); }
}
/** The invite exists but can't take new members: revoked, expired or full. */
export class ClassClosedError extends Error {}

function newCode(): string {
  // Rejection-free: 256 % 31 skews the first 8 letters by under 1%, harmless for an invite code.
  return [...randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Validates everything first, then creates the invite. */
export async function createClassInvite(db: Db, input: { name: unknown; maxUses: unknown; days: unknown }, createdBy: string, now: Date = new Date()): Promise<ClassInvite> {
  const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  if (!name) throw new ClassInputError("Give the class a name students will recognise, like \"CS 101, Fall 2026\".");
  if (name.length > CLASS_NAME_MAX) throw new ClassInputError(`Keep the class name under ${CLASS_NAME_MAX} characters.`);
  const maxUses = input.maxUses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > CLASS_MAX_USES) throw new ClassInputError(`Seats must be a whole number from 1 to ${CLASS_MAX_USES}.`);
  const days = input.days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > CLASS_MAX_DAYS) throw new ClassInputError(`Days open must be a whole number from 1 to ${CLASS_MAX_DAYS}.`);
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  const [row] = await db.insert(classInvites).values({ code: newCode(), name, maxUses, expiresAt, createdBy }).returning();
  return { ...row!, members: 0 };
}

/** Every invite, newest first, with how many have joined. */
export async function listClassInvites(db: Db): Promise<ClassInvite[]> {
  const members = db.select({ code: classMembers.code, n: count().as("n") }).from(classMembers).groupBy(classMembers.code).as("members");
  const rows = await db.select({ invite: classInvites, n: members.n }).from(classInvites).leftJoin(members, eq(members.code, classInvites.code)).orderBy(desc(classInvites.createdAt));
  return rows.map(({ invite, n }) => ({ ...invite, members: Number(n ?? 0) }));
}

/** The invite behind a code, for the join page; null for a malformed or unknown code. */
export async function findClassInvite(db: Db, code: string): Promise<ClassInvite | null> {
  if (!CLASS_CODE.test(code)) return null;
  const [invite] = await db.select().from(classInvites).where(eq(classInvites.code, code)).limit(1);
  if (!invite) return null;
  const [row] = await db.select({ n: count() }).from(classMembers).where(eq(classMembers.code, code));
  return { ...invite, members: Number(row?.n ?? 0) };
}

/** Why an invite can't take a new member, or null when it can. */
export function closedReason(invite: ClassInvite, now: Date = new Date()): string | null {
  if (invite.revokedAt) return "This class link has been turned off. Ask your instructor for a new one.";
  if (invite.expiresAt.getTime() <= now.getTime()) return "This class link has expired. Ask your instructor for a new one.";
  if (invite.members >= invite.maxUses) return "This class is full. Ask your instructor to add seats.";
  return null;
}

/** Admits `sub` through the invite. Joining an invite you're already in is a
 *  no-op. The seat count is checked and taken under a row lock, so two
 *  students joining at once can't overfill a class. */
export async function joinClass(db: Db, code: string, sub: string, login: string, now: Date = new Date()): Promise<ClassInvite> {
  if (!CLASS_CODE.test(code)) throw new ClassNotFoundError();
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(classInvites).where(eq(classInvites.code, code)).for("update").limit(1);
    if (!invite) throw new ClassNotFoundError();
    const [already] = await tx.select({ code: classMembers.code }).from(classMembers).where(and(eq(classMembers.code, code), eq(classMembers.userId, sub))).limit(1);
    const [seats] = await tx.select({ n: count() }).from(classMembers).where(eq(classMembers.code, code));
    const current: ClassInvite = { ...invite, members: Number(seats?.n ?? 0) };
    if (already) {
      if (invite.revokedAt) throw new ClassClosedError(closedReason(current, now)!);
      return current;
    }
    const reason = closedReason(current, now);
    if (reason) throw new ClassClosedError(reason);
    await ensureUser(tx as unknown as Db, sub, login);
    await tx.insert(classMembers).values({ code, userId: sub });
    return { ...current, members: current.members + 1 };
  });
}

/** Whether `sub` belongs to a class whose invite is still on. */
export async function isClassMember(db: Db, sub: string): Promise<boolean> {
  const [row] = await db.select({ code: classMembers.code }).from(classMembers)
    .innerJoin(classInvites, eq(classInvites.code, classMembers.code))
    .where(and(eq(classMembers.userId, sub), isNull(classInvites.revokedAt))).limit(1);
  return Boolean(row);
}

/** Turns an invite off: no new members, and its members lose access through it. */
export async function revokeClassInvite(db: Db, code: string, now: Date = new Date()): Promise<void> {
  const done = await db.update(classInvites).set({ revokedAt: now }).where(and(eq(classInvites.code, code), isNull(classInvites.revokedAt))).returning({ code: classInvites.code });
  if (!done.length) {
    const [exists] = await db.select({ code: classInvites.code }).from(classInvites).where(eq(classInvites.code, code)).limit(1);
    if (!exists) throw new ClassNotFoundError();
  }
}
