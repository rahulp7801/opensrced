// Contribution sync against hand-built GraphQL PR nodes (a fake fetch), into PGlite.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { InvalidRepoNameError } from "../ai-policy";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { contributions, standingEvents, users } from "../db/schema";
import { gh } from "../gh";
import { InvalidContributionError, outcomeEvents, prOutcome, recordPublished, syncContributions, type PrNode } from "../record/sync";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

const who = (login: string) => ({ login });
function node(over: Partial<PrNode> = {}): PrNode {
  return { state: "OPEN", mergedAt: null, author: who("ada"), reviews: { nodes: [] }, reviewThreads: { nodes: [] }, comments: { nodes: [] }, ...over };
}
const review = (state: string, login = "maint", authorAssociation = "MEMBER") => ({ state, authorAssociation, author: who(login) });
const thread = (...logins: string[]) => ({ comments: { nodes: logins.map((l) => ({ author: who(l) })) } });

test("prOutcome: state, rounds, maintainer approval, replies and closing objection", () => {
  const merged = prOutcome(node({
    state: "MERGED", mergedAt: "2026-10-20T00:00:00Z",
    reviews: { nodes: [review("CHANGES_REQUESTED"), review("COMMENTED", "bystander", "NONE"), review("APPROVED"), review("COMMENTED", "ADA")] },
    reviewThreads: { nodes: [thread("maint", "ada"), thread("ada", "maint")] },
  }), "ada");
  assert.deepEqual(merged, {
    state: "merged", mergedAt: new Date("2026-10-20T00:00:00Z"), reviewRounds: 2, approvedByMaintainer: true, reviewed: true, respondedToReview: true, objection: null,
  });
  // A thread the author never answered; approval by a non-maintainer does not count.
  const unanswered = prOutcome(node({ reviews: { nodes: [review("APPROVED", "friend", "CONTRIBUTOR")] }, reviewThreads: { nodes: [thread("maint", "maint")] } }), "ada");
  assert.deepEqual([unanswered.approvedByMaintainer, unanswered.respondedToReview, unanswered.state], [false, false, "open"]);
  // The author approving their own PR (impossible on GitHub, but) is not a maintainer approval.
  assert.equal(prOutcome(node({ reviews: { nodes: [review("APPROVED", "ada", "OWNER")] } }), "ada").approvedByMaintainer, false);
  const quiet = prOutcome(node(), "ada");
  assert.deepEqual([quiet.reviewed, quiet.respondedToReview, quiet.reviewRounds], [false, true, 0]);
  assert.equal(prOutcome(node({ reviews: { nodes: [review("APPROVED")] } }), "ada").reviewed, false, "a plain approval asks for no reply");
  const closed = prOutcome(node({ state: "CLOSED", comments: { nodes: [{ body: "Closing: AI-generated PRs are not accepted here.", authorAssociation: "OWNER", author: who("maint"), url: "u" }] } }), "ada");
  assert.match(closed.objection!, /AI-generated PRs are not accepted/);
  assert.equal(prOutcome(node({ state: "CLOSED" }), "ada").objection, null);
  // An open PR with the same comment is not "closed with an objection".
  assert.equal(prOutcome(node({ comments: { nodes: [{ body: "this is spam", authorAssociation: "OWNER", author: who("m"), url: "u" }] } }), "ada").objection, null);
});

test("outcomeEvents: merged earns points (path B and continuity), approvals and replies; closed costs nothing", () => {
  const o = prOutcome(node({ state: "MERGED", mergedAt: "2026-10-20T00:00:00Z", reviews: { nodes: [review("APPROVED")] }, reviewThreads: { nodes: [thread("maint", "ada")] } }), "ada");
  assert.deepEqual(outcomeEvents("a/x#1", true, o, 1), [
    { kind: "merged_self", ref: "a/x#1", points: 225 }, { kind: "approval", ref: "a/x#1", points: 30 }, { kind: "review_replied", ref: "a/x#1", points: 20 },
  ]);
  assert.deepEqual(outcomeEvents("a/x#2", false, prOutcome(node({ state: "CLOSED" }), "ada"), 0), [], "no penalty for closed-unmerged");
  assert.deepEqual(outcomeEvents("a/x#3", false, prOutcome(node(), "ada"), 0), [], "open: PR opened earns 0");
  const unanswered = prOutcome(node({ state: "CLOSED", reviewThreads: { nodes: [thread("maint")] } }), "ada");
  assert.deepEqual(outcomeEvents("a/x#4", false, unanswered, 0), [{ kind: "review_unanswered", ref: "a/x#4", points: 0 }]);
  const objection = prOutcome(node({ state: "CLOSED", comments: { nodes: [{ body: "This is spam.", authorAssociation: "MEMBER", author: who("m"), url: "u" }] } }), "ada");
  assert.deepEqual(outcomeEvents("a/x#5", false, objection, 0), [{ kind: "spam_flag", ref: "objection:a/x#5", points: 0 }]);
});

/** GraphQL answering each aliased PR from `prs` ("owner/name#n" → node, or null). */
function fakeGitHub(prs: Record<string, PrNode | null>) {
  const calls: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(query);
    const data: Record<string, unknown> = {};
    for (let i = 0; `o${i}` in variables; i++) data[`r${i}`] = { pullRequest: prs[`${variables[`o${i}`]}/${variables[`n${i}`]}#${variables[`p${i}`]}`] ?? null };
    return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { client: gh(`t-${Math.random()}`, { fetch }), calls };
}

test("recordPublished: validates first, records an open PR once", async () => {
  const pr = { userId: "github|1", login: "ada", repoFull: "acme/app", prNumber: 1, path: "ai" as const };
  for (const bad of [{ prNumber: 0 }, { prNumber: 1.5 }, { path: "x" }, { repoFull: "acme" }, { login: "bad login" }]) {
    await assert.rejects(recordPublished(connection.db, { ...pr, ...bad } as never), (e: Error) => e instanceof InvalidContributionError || e instanceof InvalidRepoNameError || e.name === "InvalidLoginError", JSON.stringify(bad));
  }
  assert.equal((await connection.db.select().from(users)).length, 0, "nothing written by a rejected call");
  await recordPublished(connection.db, pr);
  await recordPublished(connection.db, pr);
  const rows = await connection.db.select().from(contributions).where(eq(contributions.userId, "github|1"));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].state, rows[0].source, rows[0].path], ["open", "opensrcer", "ai"]);
});

test("syncContributions: refreshes open PRs, appends events once, rebuilds levels, skips missing PRs", async () => {
  const base = { userId: "github|2", login: "bob", path: "self" as const };
  await recordPublished(connection.db, { ...base, repoFull: "acme/app", prNumber: 10 });
  await recordPublished(connection.db, { ...base, repoFull: "acme/app", prNumber: 11 });
  await recordPublished(connection.db, { ...base, repoFull: "acme/app", prNumber: 12 });
  await recordPublished(connection.db, { ...base, repoFull: "gone/repo", prNumber: 1 });
  const mergedNode = node({ state: "MERGED", mergedAt: "2026-10-20T00:00:00Z", author: who("bob"), reviews: { nodes: [review("APPROVED")] } });
  // acme/app#1 is the previous test's PR (another user), still open.
  const github = fakeGitHub({ "acme/app#1": node(), "acme/app#10": mergedNode, "acme/app#11": mergedNode, "acme/app#12": node({ author: who("bob") }), "gone/repo#1": null });
  const run = await syncContributions(connection.db, github.client);
  assert.deepEqual(run.missing, ["gone/repo#1"]);
  assert.ok(run.checked >= 4 && run.changed >= 2);
  const events = await connection.db.select().from(standingEvents).where(eq(standingEvents.userId, "github|2"));
  const kinds = events.map((e) => `${e.kind}:${e.ref}:${e.points}`).sort();
  assert.deepEqual(kinds, [
    "approval:acme/app#10:30", "approval:acme/app#11:30", "merged_self:acme/app#10:150", "merged_self:acme/app#11:225",
  ], "the second merged PR in the same repo gets continuity");
  const [user] = await connection.db.select().from(users).where(eq(users.id, "github|2"));
  assert.equal(user.standing, 435);
  // A second run only re-reads what is still open and adds nothing new.
  const again = await syncContributions(connection.db, github.client);
  assert.equal(again.users, 0);
  assert.equal((await connection.db.select().from(standingEvents).where(eq(standingEvents.userId, "github|2"))).length, 4);
});

test("syncContributions: a deadline in the past starts no batch", async () => {
  const github = fakeGitHub({});
  const run = await syncContributions(connection.db, github.client, Date.now() - 1);
  assert.deepEqual(run, { checked: 0, changed: 0, missing: [], users: 0 });
  assert.equal(github.calls.length, 0);
});
