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
