import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  InterestFullError, InterestInputError, InterestNotFoundError, MAX_REQUESTS,
  approvedIdsFrom, normalizeInterest, removeRequest, requestsCsv, setRequestStatus, upsertRequest,
  type InterestRequest,
} from "../interest";
import { canUse, isAdmin } from "../access-server";

const NOW = "2026-10-25T12:00:00.000Z";
const LATER = "2026-10-25T13:00:00.000Z";
const ada = { name: "Ada Lovelace", email: "ada@example.com", github: "ada", githubId: 1 };
const req = (over: Partial<InterestRequest> = {}): InterestRequest => ({ id: "r1", ...ada, status: "new", createdAt: NOW, updatedAt: NOW, ...over });

describe("normalizeInterest", () => {
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

  test("updates instead of duplicating when the email or the GitHub login matches", () => {
    const byEmail = upsertRequest([req({ status: "approved" })], { ...ada, name: "Ada L", github: "ada2", githubId: null }, LATER, "r2");
    assert.equal(byEmail.length, 1);
    assert.deepEqual(byEmail[0], { ...req({ status: "approved" }), name: "Ada L", github: "ada2", githubId: 1, updatedAt: LATER });
    const byLogin = upsertRequest([req()], { ...ada, email: "new@example.com", github: "ADA" }, LATER, "r2");
    assert.equal(byLogin.length, 1);
    assert.equal(byLogin[0].email, "new@example.com");
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
    assert.equal(csv, 'name,email,github,github_id,status,requested_at\n"\'=HYPERLINK(""x"")","ada@example.com","ada","","new","2026-10-25T12:00:00.000Z"\n');
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

  test("open access lets everyone use the app; invite mode admits the invited list without asking storage", async () => {
    const saved = { access: process.env.OPENSRCER_ACCESS, ids: process.env.OPENSRCER_INVITED_GITHUB_IDS };
    try {
      delete process.env.OPENSRCER_ACCESS;
      assert.equal(await canUse("github|1"), true);
      process.env.OPENSRCER_ACCESS = "invite";
      process.env.OPENSRCER_INVITED_GITHUB_IDS = "1";
      assert.equal(await canUse("github|1"), true);
    } finally {
      if (saved.access === undefined) delete process.env.OPENSRCER_ACCESS; else process.env.OPENSRCER_ACCESS = saved.access;
      if (saved.ids === undefined) delete process.env.OPENSRCER_INVITED_GITHUB_IDS; else process.env.OPENSRCER_INVITED_GITHUB_IDS = saved.ids;
    }
  });
});
