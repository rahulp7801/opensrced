import { test } from "node:test";
import assert from "node:assert/strict";
import { repoStars } from "../discover";

test("repoStars: one aliased GraphQL request, names as variables, unresolved repos absent", async (t) => {
  const bodies: Array<{ query: string; variables: Record<string, string> }> = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    return Response.json({ data: { r0: { stargazerCount: 17_000 }, r1: null } });
  });
  const stars = await repoStars(["pallets/click", "Pallets/Click", "gone/repo", "bad name/x", "a/b/c"], "token");
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].variables, { o0: "pallets", n0: "click", o1: "gone", n1: "repo" });
  assert.ok(!bodies[0].query.includes("pallets"), "names never go into the query text");
  assert.deepEqual([...stars], [["pallets/click", 17_000]]);
});

test("repoStars: nothing valid makes no request; GraphQL errors throw", async (t) => {
  const calls = t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "denied" }] }));
  assert.equal((await repoStars(["bad name/x"], "token")).size, 0);
  assert.equal(calls.mock.callCount(), 0);
  await assert.rejects(repoStars(["a/b"], "token"));
});
