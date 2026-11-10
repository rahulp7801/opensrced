// Class invites (lib/classes.ts) on a real (PGlite) database, and the access
// check that admits their members (lib/access-server.ts canUse).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import {
  CLASS_CODE, ClassClosedError, ClassInputError, ClassNotFoundError, closedReason, createClassInvite, findClassInvite,
  isClassMember, joinClass, listClassInvites, revokeClassInvite,
} from "../classes";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

const NOW = new Date("2026-11-10T12:00:00Z");
const DAY = 86_400_000;
const make = (over: Record<string, unknown> = {}) => createClassInvite(connection.db, { name: "CS 101, Fall 2026", maxUses: 3, days: 30, ...over }, "github|1", NOW);

const BAD: Array<[string, Record<string, unknown>, RegExp]> = [
  ["an empty name", { name: "   " }, /Give the class a name/],
  ["a name that isn't text", { name: 42 }, /Give the class a name/],
  ["a name too long", { name: "x".repeat(81) }, /under 80 characters/],
  ["zero seats", { maxUses: 0 }, /Seats must be/],
  ["negative seats", { maxUses: -5 }, /Seats must be/],
  ["fractional seats", { maxUses: 2.5 }, /Seats must be/],
  ["seats as text", { maxUses: "30" }, /Seats must be/],
  ["too many seats", { maxUses: 1001 }, /Seats must be/],
  ["zero days", { days: 0 }, /Days open must be/],
  ["too many days", { days: 366 }, /Days open must be/],
];
for (const [what, over, message] of BAD) {
  test(`an invite with ${what} is refused before anything is stored`, async () => {
    const before = (await listClassInvites(connection.db)).length;
    await assert.rejects(make(over), (e: unknown) => e instanceof ClassInputError && message.test(e.message));
    assert.equal((await listClassInvites(connection.db)).length, before);
  });
}

test("an invite: a readable code, the name cleaned, seats, and its last day to join", async () => {
  const invite = await make({ name: "  CS 101,\n Fall  2026 " });
  assert.match(invite.code, CLASS_CODE);
  assert.deepEqual([invite.name, invite.maxUses, invite.members, invite.expiresAt.getTime(), invite.revokedAt], ["CS 101, Fall 2026", 3, 0, NOW.getTime() + 30 * DAY, null]);
  assert.equal((await findClassInvite(connection.db, invite.code))?.name, "CS 101, Fall 2026");
  assert.equal(await findClassInvite(connection.db, "not-a-code"), null);
  assert.equal(await findClassInvite(connection.db, "abcdefghjk"), null, "well formed, unknown");
});

test("students join, joining twice takes one seat, and a full class turns the next one away", async () => {
  const db = connection.db;
  const invite = await make({ maxUses: 2 });
  await joinClass(db, invite.code, "github|101", "ada", NOW);
  const again = await joinClass(db, invite.code, "github|101", "ada", NOW);
  assert.equal(again.members, 1, "a second join is a no-op");
  assert.equal((await joinClass(db, invite.code, "github|102", "brian", NOW)).members, 2);
  await assert.rejects(joinClass(db, invite.code, "github|103", "cleo", NOW), (e: unknown) => e instanceof ClassClosedError && /full/.test(e.message));
  assert.deepEqual([await isClassMember(db, "github|101"), await isClassMember(db, "github|102"), await isClassMember(db, "github|103")], [true, true, false]);
  assert.equal((await listClassInvites(db)).find((i) => i.code === invite.code)?.members, 2);
});

test("seats can't be overfilled by students joining at the same moment", async () => {
  const db = connection.db;
  const invite = await make({ maxUses: 3 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => joinClass(db, invite.code, `github|${200 + i}`, `student${i}`, NOW)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  assert.equal((await findClassInvite(db, invite.code))?.members, 3);
});

test("after its last day an invite takes nobody new, but its members keep access", async () => {
  const db = connection.db;
  const invite = await make({ days: 1 });
  await joinClass(db, invite.code, "github|301", "dee", NOW);
  const later = new Date(NOW.getTime() + 2 * DAY);
  await assert.rejects(joinClass(db, invite.code, "github|302", "eli", later), /expired/);
  assert.equal(await joinClass(db, invite.code, "github|301", "dee", later).then((i) => i.code), invite.code, "a member opening the link again is fine");
  assert.equal(await isClassMember(db, "github|301"), true);
});

test("revoking an invite closes it and ends its members' access through it", async () => {
  const db = connection.db;
  const invite = await make();
  await joinClass(db, invite.code, "github|401", "fay", NOW);
  await revokeClassInvite(db, invite.code, NOW);
  await revokeClassInvite(db, invite.code, NOW); // twice is fine
  assert.equal(await isClassMember(db, "github|401"), false);
  await assert.rejects(joinClass(db, invite.code, "github|402", "gus", NOW), /turned off/);
  await assert.rejects(joinClass(db, invite.code, "github|401", "fay", NOW), /turned off/);
  await assert.rejects(revokeClassInvite(db, "abcdefghjk"), ClassNotFoundError);
});

test("unknown and malformed codes are refused without touching anything", async () => {
  for (const code of ["", "short", "abcdefghjk", "ABCDEFGHJK", "abcdefghj1", "../../etc/x"]) {
    await assert.rejects(joinClass(connection.db, code, "github|501", "hal", NOW), ClassNotFoundError);
  }
  assert.equal(await isClassMember(connection.db, "github|501"), false);
});

test("closedReason says what's wrong in the student's terms", () => {
  const base = { code: "abcdefghjk", name: "x", maxUses: 2, members: 0, expiresAt: new Date(NOW.getTime() + DAY), createdAt: NOW, revokedAt: null };
  assert.equal(closedReason(base, NOW), null);
  assert.match(closedReason({ ...base, members: 2 }, NOW)!, /full/);
  assert.match(closedReason({ ...base, expiresAt: NOW }, NOW)!, /expired/);
  assert.match(closedReason({ ...base, revokedAt: NOW }, NOW)!, /turned off/);
});

test("the access check admits a class member, and stops when the invite is revoked", async () => {
  // canUse reads the app's own database (getDb: an in-memory PGlite here), with the preview gate on.
  const { getDb } = await import("../db/client");
  const { canUse } = await import("../access-server");
  const db = await getDb();
  const invite = await createClassInvite(db, { name: "Lab", maxUses: 5, days: 7 }, "github|1");
  assert.equal(await canUse("github|601"), false, "not a member yet");
  await joinClass(db, invite.code, "github|601", "ivy");
  assert.equal(await canUse("github|601"), true);
  assert.equal(await canUse("auth0|601"), false, "only GitHub accounts");
  await revokeClassInvite(db, invite.code);
  assert.equal(await canUse("github|601"), false);
});
