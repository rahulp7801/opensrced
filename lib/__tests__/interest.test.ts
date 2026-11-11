import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { PGlite } from "@electric-sql/pglite";
import {
  BLOB_IMPORT_RETRY_MS, InterestFullError, InterestInputError, InterestNotFoundError, MAX_REQUESTS, StoredRequestError,
  approvedGithubIds, approvedIdsFrom, clearApprovedCache, listRequests, mergeImported, normalizeInterest, removeRequest,
  requestsCsv, setRequestStatus, storedRequest, updateRequests, upsertRequest,
  type InterestRequest, type InterestStore,
} from "../interest";
import { canUse, isAdmin } from "../access-server";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import * as schema from "../db/schema";
import { accessRequests, appMeta } from "../db/schema";

const NOW = "2026-10-25T12:00:00.000Z";
const LATER = "2026-10-25T13:00:00.000Z";
const ada = { name: "Ada Lovelace", email: "ada@example.com", github: "ada", githubId: 1 };
const req = (over: Partial<InterestRequest> = {}): InterestRequest => ({ id: "r1", ...ada, status: "new", createdAt: NOW, updatedAt: NOW, ...over });

describe("normalizeInterest", () => {
  for (const role of ["Student", "Contributor", "Maintainer", "Other"]) {
    test(`keeps the role ${role}`, () => {
      assert.equal(normalizeInterest({ name: "A", email: "a@b.co", github: "x", role }).role, role);
    });
  }
  for (const role of ["", "maintainer", "Admin", 3, null]) {
    test(`rejects the role ${JSON.stringify(role)}`, () => {
      assert.throws(() => normalizeInterest({ name: "A", email: "a@b.co", github: "x", role }), (e) => e instanceof InterestInputError && e.field === "role");
    });
  }
  test("a request without a role (an older client) is still accepted", () => {
    assert.equal("role" in normalizeInterest({ name: "A", email: "a@b.co", github: "x" }), false);
  });

  test("cleans the three fields", () => {
    assert.deepEqual(normalizeInterest({ name: "  Ada \n Lovelace ", email: " Ada@Example.COM ", github: "@octo-cat" }), { name: "Ada Lovelace", email: "ada@example.com", github: "octo-cat" });
  });

  for (const github of ["https://github.com/octocat", "github.com/octocat/", "www.github.com/octocat", "octocat"]) {
    test(`accepts a GitHub username given as ${github}`, () => {
      assert.equal(normalizeInterest({ name: "A", email: "a@b.co", github }).github, "octocat");
    });
  }

  for (const [field, input] of [
    ["name", { name: "", email: "a@b.co", github: "x" }],
    ["name", { name: "   ", email: "a@b.co", github: "x" }],
    ["name", { name: "a".repeat(101), email: "a@b.co", github: "x" }],
    ["name", { name: 42, email: "a@b.co", github: "x" }],
    ["email", { name: "A", email: "not-an-email", github: "x" }],
    ["email", { name: "A", email: "", github: "x" }],
    ["email", { name: "A", email: `${"a".repeat(250)}@b.co`, github: "x" }],
    ["github", { name: "A", email: "a@b.co", github: "" }],
    ["github", { name: "A", email: "a@b.co", github: "-bad" }],
    ["github", { name: "A", email: "a@b.co", github: "bad--name" }],
    ["github", { name: "A", email: "a@b.co", github: "a".repeat(40) }],
    ["github", { name: "A", email: "a@b.co", github: "has space" }],
  ] as const) {
    test(`rejects a bad ${field}: ${JSON.stringify(input[field]).slice(0, 30)}`, () => {
      assert.throws(() => normalizeInterest(input), (e: unknown) => e instanceof InterestInputError && e.field === field);
    });
  }
});

describe("upsertRequest", () => {
  test("adds a new request as new", () => {
    const list = upsertRequest([], ada, NOW, "r1");
    assert.deepEqual(list, [req()]);
  });

  test("a re-submission with the same email or GitHub login never changes who the request belongs to", () => {
    // Someone else's email with the attacker's GitHub login: the approved request keeps Ada's login and id.
    const byEmail = upsertRequest([req({ status: "approved" })], { ...ada, name: "Mallory", github: "mallory", githubId: 666 }, LATER, "r2");
    assert.deepEqual(byEmail, [req({ status: "approved", updatedAt: LATER })]);
    // Ada's GitHub login with the attacker's email: Ada's email stays.
    const byLogin = upsertRequest([req()], { ...ada, name: "Mallory", email: "mallory@example.com", github: "ADA", githubId: 1 }, LATER, "r2");
    assert.deepEqual(byLogin, [req({ updatedAt: LATER })]);
  });

  test("a re-submission fills in a missing GitHub id only for the same login", () => {
    assert.equal(upsertRequest([req({ githubId: null })], { ...ada, github: "Ada", githubId: 1 }, LATER, "r2")[0].githubId, 1);
    assert.equal(upsertRequest([req({ githubId: null })], { ...ada, github: "mallory", githubId: 666 }, LATER, "r2")[0].githubId, null);
  });

  test("refuses past the cap, leaving the list alone", () => {
    const full = Array.from({ length: MAX_REQUESTS }, (_, i) => req({ id: `r${i}`, email: `${i}@x.co`, github: `u${i}` }));
    assert.throws(() => upsertRequest(full, ada, NOW, "new"), InterestFullError);
    assert.equal(full.length, MAX_REQUESTS);
  });
});

describe("setRequestStatus and removeRequest", () => {
  test("approve sets the status, the time and a looked-up GitHub id; other requests are untouched", () => {
    const other = req({ id: "r2", email: "b@x.co", github: "b" });
    const list = setRequestStatus([req({ githubId: null }), other], "r1", "approved", LATER, 77);
    assert.deepEqual(list, [req({ githubId: 77, status: "approved", updatedAt: LATER }), other]);
  });

  test("an unknown id or status throws", () => {
    assert.throws(() => setRequestStatus([req()], "nope", "approved", LATER), InterestNotFoundError);
    assert.throws(() => setRequestStatus([req()], "r1", "maybe" as never, LATER), RangeError);
    assert.throws(() => removeRequest([req()], "nope"), InterestNotFoundError);
  });

  test("remove drops only that request", () => {
    assert.deepEqual(removeRequest([req(), req({ id: "r2" })], "r1"), [req({ id: "r2" })]);
    assert.deepEqual(removeRequest([req()], "r1"), []);
  });
});

describe("approvedIdsFrom", () => {
  test("only approved requests with a known GitHub id admit anyone", () => {
    const ids = approvedIdsFrom([
      req({ id: "a", githubId: 10, status: "approved" }),
      req({ id: "b", githubId: null, status: "approved" }),
      req({ id: "c", githubId: 30, status: "new" }),
      req({ id: "d", githubId: 40, status: "declined" }),
    ]);
    assert.deepEqual([...ids], ["10"]);
    assert.deepEqual([...approvedIdsFrom([])], []);
  });
});

describe("requestsCsv", () => {
  test("quotes cells and defuses formulas", () => {
    const csv = requestsCsv([req({ name: '=HYPERLINK("x")', githubId: null })]);
    assert.equal(csv, 'name,email,github,github_id,status,requested_at,role\n"\'=HYPERLINK(""x"")","ada@example.com","ada","","new","2026-10-25T12:00:00.000Z",""\n');
  });
});

describe("isAdmin and canUse", () => {
  test("admins come only from OPENSRCER_ADMIN_GITHUB_IDS; unset admits nobody", () => {
    assert.equal(isAdmin("github|5", new Set(["5"])), true);
    assert.equal(isAdmin("github|6", new Set(["5"])), false);
    assert.equal(isAdmin("google-oauth2|5", new Set(["5"])), false);
    assert.equal(isAdmin(null, new Set(["5"])), false);
    assert.equal(isAdmin("github|5", new Set()), false);
  });

  test("an account approved in Postgres gets in through the access check (the app's own database)", async () => {
    const { getDb } = await import("../db/client");
    const db = await getDb();
    // Mark the Blob import done for this database, so the real Blob is never asked here.
    const local: InterestStore = { getDb: async () => db, readBlobList: async () => null };
    await updateRequests((list) => upsertRequest(list, { name: "Gate", email: "gate@x.co", github: "gate", githubId: 9001 }, NOW, "gate"), local);
    clearApprovedCache();
    assert.equal(await canUse("github|9001"), false, "a new request admits nobody");
    await updateRequests((list) => setRequestStatus(list, "gate", "approved", LATER), local);
    assert.equal(await canUse("github|9001"), true);
    assert.equal(await canUse("github|9002"), false);
  });

  test("explicitly open access lets everyone in; the default (invite) admits the invited list without asking storage", async () => {
    const saved = { access: process.env.OPENSRCER_ACCESS, ids: process.env.OPENSRCER_INVITED_GITHUB_IDS };
    try {
      process.env.OPENSRCER_ACCESS = "open";
      assert.equal(await canUse("github|1"), true);
      delete process.env.OPENSRCER_ACCESS;
      process.env.OPENSRCER_INVITED_GITHUB_IDS = "1";
      assert.equal(await canUse("github|1"), true);
    } finally {
      if (saved.access === undefined) delete process.env.OPENSRCER_ACCESS; else process.env.OPENSRCER_ACCESS = saved.access;
      if (saved.ids === undefined) delete process.env.OPENSRCER_INVITED_GITHUB_IDS; else process.env.OPENSRCER_INVITED_GITHUB_IDS = saved.ids;
    }
  });
});

describe("storedRequest (rows from the old Blob list)", () => {
  test("a valid stored request comes back as it was; a missing githubId is unknown", () => {
    assert.deepEqual(storedRequest(req({ role: "Student" })), req({ role: "Student" }));
    const noId: Record<string, unknown> = { ...req() };
    delete noId.githubId;
    assert.equal(storedRequest(noId).githubId, null);
  });

  for (const [what, raw] of [
    ["not an object", "ada"],
    ["an array", [req()]],
    ["null", null],
    ["no id", { ...req(), id: "" }],
    ["a bad email", req({ email: "nope" })],
    ["a bad login", req({ github: "-bad" })],
    ["an unknown status", { ...req(), status: "maybe" }],
    ["an unknown role", { ...req(), role: "Admin" }],
    ["a githubId as text", { ...req(), githubId: "1" }],
    ["a negative githubId", req({ githubId: -1 })],
    ["a fractional githubId", req({ githubId: 1.5 })],
    ["a createdAt that isn't a time", req({ createdAt: "yesterday" })],
    ["no updatedAt", { ...req(), updatedAt: undefined }],
  ] as const) {
    test(`refuses ${what}`, () => {
      assert.throws(() => storedRequest(raw), StoredRequestError);
    });
  }
});

describe("mergeImported", () => {
  const blob = req({ id: "b1", status: "approved", createdAt: "2026-10-01T00:00:00.000Z" });
  test("adds what's new; the same person keeps an admin's decision here, else takes Blob's", () => {
    assert.deepEqual(mergeImported([], [blob]), { list: [blob], conflicts: [] });
    const resubmitted = req({ id: "p1", github: "ADA", githubId: null, updatedAt: LATER });
    const { list, conflicts } = mergeImported([resubmitted], [blob]);
    assert.deepEqual(list, [{ ...resubmitted, status: "approved", githubId: 1, createdAt: blob.createdAt }]);
    assert.deepEqual(conflicts, []);
    const declinedHere = req({ id: "p1", status: "declined" });
    assert.equal(mergeImported([declinedHere], [blob]).list[0].status, "declined");
  });

  test("a Blob request matching someone else's email or login is a conflict, not a merge", () => {
    const mallory = req({ id: "p1", github: "mallory", githubId: 666 });
    const { list, conflicts } = mergeImported([mallory], [blob]);
    assert.deepEqual(list, [mallory], "mallory's request is not approved by Ada's");
    assert.deepEqual(conflicts, [blob]);
  });
});

// ── Storage on a real (PGlite) database ─────────────────────────────────────

/** A fresh, migrated in-memory database. Each is closed after the file's tests. */
const opened: DbConnection[] = [];
async function freshDb(): Promise<DbConnection> {
  const connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  opened.push(connection);
  return connection;
}
after(async () => { await Promise.all(opened.map((c) => c.close())); });

/** Storage on `connection`, with no old Blob list unless a reader is given. */
const storeOf = (connection: DbConnection, over: InterestStore = {}): InterestStore => ({ getDb: async () => connection.db, readBlobList: async () => null, ...over });
const submit = (store: InterestStore, fields: Parameters<typeof upsertRequest>[1], id: string, now = NOW) =>
  updateRequests((list) => upsertRequest(list, fields, now, id), store);

describe("storage", () => {
  let connection: DbConnection;
  let store: InterestStore;
  before(async () => {
    connection = await freshDb();
    store = storeOf(connection);
  });

  test("a submitted request is listed as it was sent", async () => {
    await submit(store, { ...ada, role: "Student" }, "r1");
    assert.deepEqual(await listRequests(store), [req({ role: "Student" })]);
  });

  test("submitting again updates the request instead of adding one, whatever the login's case", async () => {
    await submit(store, { ...ada, github: "ADA" }, "r-dup", LATER);
    await submit(store, { ...ada, name: "Mallory", github: "mallory", githubId: 666 }, "r-dup2", LATER);
    assert.deepEqual(await listRequests(store), [req({ role: "Student", updatedAt: LATER })]);
  });

  test("the database itself refuses a second request for the same email or login", async () => {
    const row = { name: "X", email: "other@x.co", github: "Ada", githubId: null, status: "new" as const, createdAt: new Date(), updatedAt: new Date() };
    await assert.rejects(async () => { await connection.db.insert(accessRequests).values({ ...row, id: "dup-login" }); });
    await assert.rejects(async () => { await connection.db.insert(accessRequests).values({ ...row, id: "dup-email", email: "ada@example.com", github: "zed" }); });
    assert.equal((await listRequests(store)).length, 1);
  });

  test("approving admits the GitHub id; declining takes it back", async () => {
    clearApprovedCache();
    assert.equal((await approvedGithubIds(store)).has("1"), false);
    await updateRequests((list) => setRequestStatus(list, "r1", "approved", LATER), store);
    assert.deepEqual([...await approvedGithubIds(store)], ["1"]);
    await updateRequests((list) => setRequestStatus(list, "r1", "declined", LATER), store);
    assert.deepEqual([...await approvedGithubIds(store)], []);
    assert.equal((await listRequests(store))[0].status, "declined");
  });

  test("an unknown id changes nothing and says so", async () => {
    const before = await listRequests(store);
    await assert.rejects(updateRequests((list) => setRequestStatus(list, "nope", "approved", LATER), store), InterestNotFoundError);
    await assert.rejects(updateRequests((list) => removeRequest(list, "nope"), store), InterestNotFoundError);
    assert.deepEqual(await listRequests(store), before);
  });

  test("removing a request deletes it, and its email and login can sign up again", async () => {
    await updateRequests((list) => removeRequest(list, "r1"), store);
    assert.deepEqual(await listRequests(store), []);
    await submit(store, ada, "r1-again");
    assert.deepEqual((await listRequests(store)).map((r) => r.id), ["r1-again"]);
  });

  test("requests sent at the same moment are all kept, and one person sending twice at once is one request", async () => {
    const people = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, email: `p${i}@x.co`, github: `p${i}`, githubId: 100 + i }));
    await Promise.all([...people.map((p, i) => submit(store, p, `p${i}`)), submit(store, people[0], "p0-twin")]);
    const list = await listRequests(store);
    assert.equal(list.length, 1 + people.length);
    assert.equal(list.filter((r) => r.email === "p0@x.co").length, 1);
  });

  test("a database that can't be read admits nobody by approval (fails closed)", async () => {
    clearApprovedCache();
    const broken: InterestStore = { getDb: async () => { throw new Error("database down"); } };
    assert.deepEqual([...await approvedGithubIds(broken)], []);
    await assert.rejects(listRequests(broken), /database down/);
  });
});

test("a full list refuses new requests, still takes re-submissions, and stores nothing new", async () => {
  const store = storeOf(await freshDb());
  const full = Array.from({ length: MAX_REQUESTS }, (_, i) => req({ id: `r${i}`, email: `${i}@x.co`, github: `u${i}` }));
  await updateRequests(() => full, store);
  await assert.rejects(submit(store, { ...ada, email: "new@x.co", github: "newbie" }, "new"), InterestFullError);
  await submit(store, { ...ada, email: "0@x.co", github: "u0" }, "again", LATER);
  const list = await listRequests(store);
  assert.equal(list.length, MAX_REQUESTS);
  assert.equal(list.find((r) => r.id === "r0")?.updatedAt, LATER);
});

describe("the one-time import of the old Blob list", () => {
  const blobList = [
    req({ id: "b-ada", status: "approved", createdAt: "2026-10-01T00:00:00.000Z" }),
    req({ id: "b-bo", name: "Bo", email: "bo@x.co", github: "bo", githubId: 2, role: "Maintainer" }),
    { ...req({ id: "b-bad-email" }), email: "not-an-email" },
    { ...req({ id: "b-bad-status", email: "c@x.co", github: "c" }), status: "maybe" },
  ];
  const importRow = async (connection: DbConnection) =>
    (await connection.db.select().from(appMeta).where(eq(appMeta.key, "interest-blob-import")))[0]?.value;

  test("imports valid requests once, skips invalid ones, and records it", async () => {
    const connection = await freshDb();
    let reads = 0;
    const store = storeOf(connection, { readBlobList: async () => { reads++; return blobList; } });
    const list = await listRequests(store);
    assert.deepEqual(list.map((r) => r.id), ["b-ada", "b-bo"]);
    assert.equal(list[1].role, "Maintainer");
    const record = await importRow(connection) as { importedAt: string; found: number; invalid: number; conflicts: unknown[] };
    assert.deepEqual([record.found, record.invalid, record.conflicts], [4, 2, []]);
    assert.ok(!Number.isNaN(Date.parse(record.importedAt)));
    clearApprovedCache();
    assert.deepEqual([...await approvedGithubIds(store)], ["1"], "approved in Blob, admitted from Postgres");
    await submit(store, { name: "Cy", email: "cy@x.co", github: "cy", githubId: 3 }, "p-cy");
    await listRequests(store);
    assert.equal(reads, 1, "Blob is read once");
    // Another instance (its own client object, no memory of this one) finds the record and doesn't import again.
    // drizzle keeps its client on $client, which the DbConnection type doesn't spell out.
    const otherInstance = drizzle({ client: (connection.db as unknown as { $client: PGlite }).$client, schema, casing: "snake_case" });
    let otherReads = 0;
    const other: InterestStore = { getDb: async () => otherInstance, readBlobList: async () => { otherReads++; return blobList; } };
    assert.equal((await listRequests(other)).length, 3);
    assert.equal(otherReads, 0);
  });

  test("while Blob can't be read Postgres works alone; the import is retried only after a while", async () => {
    const connection = await freshDb();
    let clock = 1_000_000;
    let blobUp = false;
    let reads = 0;
    const store = storeOf(connection, {
      now: () => clock,
      readBlobList: async () => { reads++; if (!blobUp) throw new Error("Blob: operations quota exceeded"); return blobList; },
    });
    // Ada, locked out, signs up again while Blob is down; someone else takes Bo's login.
    await submit(store, { ...ada, github: "Ada", githubId: null }, "p-ada", LATER);
    await submit(store, { name: "Bob", email: "bob@x.co", github: "BO", githubId: 22 }, "p-bob", LATER);
    assert.equal(reads, 1);
    assert.deepEqual((await listRequests(store)).map((r) => r.id), ["p-ada", "p-bob"]);
    assert.equal(reads, 1, "not asked again right away");
    assert.equal(await importRow(connection), undefined, "nothing recorded");

    blobUp = true;
    clock += BLOB_IMPORT_RETRY_MS - 1;
    await listRequests(store);
    assert.equal(reads, 1, "still waiting");
    clock += 1;
    const list = await listRequests(store);
    assert.equal(reads, 2, "retried after the wait");
    // Ada's re-submission takes her Blob approval; Bo's Blob request clashes with Bob's login and is kept aside.
    assert.deepEqual(list, [
      { ...req({ id: "p-ada", github: "Ada", status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: LATER }) },
      req({ id: "p-bob", name: "Bob", email: "bob@x.co", github: "BO", githubId: 22, createdAt: LATER, updatedAt: LATER }),
    ]);
    const record = await importRow(connection) as { found: number; invalid: number; conflicts: InterestRequest[] };
    assert.deepEqual([record.found, record.invalid, record.conflicts.map((c) => c.id)], [4, 2, ["b-bo"]]);
    clock += 10 * BLOB_IMPORT_RETRY_MS;
    await listRequests(store);
    assert.equal(reads, 2, "never again once imported");
  });

  test("no Blob list at all is recorded as nothing to import", async () => {
    const connection = await freshDb();
    let reads = 0;
    const store = storeOf(connection, { readBlobList: async () => { reads++; return null; } });
    assert.deepEqual(await listRequests(store), []);
    await listRequests(store);
    assert.equal(reads, 1);
    assert.deepEqual(await importRow(connection).then((v) => (v as { found: number }).found), 0);
  });

  test("a damaged Blob file (not a list) is not imported and is retried later", async () => {
    const connection = await freshDb();
    let clock = 0;
    let reads = 0;
    const store = storeOf(connection, { now: () => clock, readBlobList: async () => { reads++; return { not: "a list" }; } });
    assert.deepEqual(await listRequests(store), []);
    assert.equal(await importRow(connection), undefined);
    clock = BLOB_IMPORT_RETRY_MS;
    await listRequests(store);
    assert.equal(reads, 2);
  });
});
