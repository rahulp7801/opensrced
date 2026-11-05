import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { apiTokens, harnessEvents } from "../db/schema";
import {
  createToken, harnessUser, HarnessAuthError, HarnessInputError, hashToken, listTokens, MAX_EVENT_BYTES, MAX_TOKENS,
  recordEvent, revokeToken, TOKEN_HEADER, TokenLimitError, TokenNotFoundError,
} from "../harness";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

const invited = async () => true;
const notInvited = async () => false;

test("a token is shown once, stored only as its hash, and listed without it", async () => {
  const db = connection.db;
  const created = await createToken(db, "github|1", "alice", "  laptop  ");
  assert.match(`Bearer ${created.token}`, TOKEN_HEADER);
  assert.equal(created.name, "laptop");
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, created.id));
  assert.equal(row.hash, hashToken(created.token));
  assert.ok(!JSON.stringify(row).includes(created.token), "the plaintext is not stored");
  const listed = await listTokens(db, "github|1");
  assert.deepEqual(listed.map((t) => t.name), ["laptop"]);
  assert.ok(!JSON.stringify(listed).includes(created.token) && !JSON.stringify(listed).includes(row.hash));
});

test("token names are required, and an account holds at most MAX_TOKENS live tokens", async () => {
  const db = connection.db;
  await assert.rejects(createToken(db, "github|2", "bob", "   "), HarnessInputError);
  for (let i = 0; i < MAX_TOKENS; i++) await createToken(db, "github|2", "bob", `t${i}`);
  await assert.rejects(createToken(db, "github|2", "bob", "one too many"), TokenLimitError);
  const [first] = await listTokens(db, "github|2");
  await revokeToken(db, "github|2", first.id);
  await createToken(db, "github|2", "bob", "after a revoke");
  assert.equal((await listTokens(db, "github|2")).length, MAX_TOKENS);
});

test("the harness accepts a live token of an invited account, and nothing else", async () => {
  const db = connection.db;
  const { token, id } = await createToken(db, "github|3", "carol", "ci");
  const at = new Date("2026-11-05T10:00:00Z");
  assert.equal(await harnessUser(db, `Bearer ${token}`, invited, at), "github|3");
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
  assert.equal(row.lastUsedAt?.toISOString(), at.toISOString());

  const refused = async (header: string | null, access = invited) => {
    const error = await harnessUser(db, header, access).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof HarnessAuthError, `${header} must be refused`);
    return error.status;
  };
  assert.equal(await refused(null), 401);
  assert.equal(await refused(token), 401, "no Bearer prefix");
  assert.equal(await refused(`Bearer ${token}x`), 401, "wrong length");
  assert.equal(await refused(`Bearer osh_${"a".repeat(32)}`), 401, "unknown token");
  assert.equal(await refused(`Bearer ${token}`, notInvited), 403, "an account whose invite was withdrawn");
  await revokeToken(db, "github|3", id);
  assert.equal(await refused(`Bearer ${token}`), 401, "revoked");
});

test("only the owner can revoke a token", async () => {
  const db = connection.db;
  const { id, token } = await createToken(db, "github|4", "dave", "desk");
  await assert.rejects(revokeToken(db, "github|5", id), TokenNotFoundError);
  assert.equal(await harnessUser(db, `Bearer ${token}`, invited), "github|4", "still live after someone else tried");
  await assert.rejects(revokeToken(db, "github|4", 999_999), TokenNotFoundError);
});

const BAD_EVENTS: Array<[string, unknown]> = [
  ["no type", { repo: "acme/app" }],
  ["an unknown type", { type: "deleted_everything", repo: "acme/app" }],
  ["no repo", { type: "pr_opened" }],
  ["a bad repo", { type: "pr_opened", repo: "../etc/passwd" }],
  ["array data", { type: "pr_opened", repo: "acme/app", data: [1] }],
  ["oversized data", { type: "pr_opened", repo: "acme/app", data: { note: "x".repeat(MAX_EVENT_BYTES) } }],
  ["a non-object body", "pr_opened"],
];
for (const [name, body] of BAD_EVENTS) {
  test(`events: ${name} is refused`, async () => {
    await assert.rejects(recordEvent(connection.db, "github|1", body), HarnessInputError);
  });
}

test("events: a valid event is stored against the token's user", async () => {
  const db = connection.db;
  await recordEvent(db, "github|1", { type: "pr_opened", repo: "acme/app", data: { pr: "https://github.com/acme/app/pull/3" } });
  await recordEvent(db, "github|1", { type: "session_start", repo: "acme/app" });
  const rows = await db.select().from(harnessEvents).where(eq(harnessEvents.userId, "github|1"));
  assert.deepEqual(rows.map((r) => [r.type, r.repo, r.data]), [
    ["pr_opened", "acme/app", { pr: "https://github.com/acme/app/pull/3" }],
    ["session_start", "acme/app", {}],
  ]);
});

/** Every route file under a directory. */
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : [];
  });
}

test("every /api/harness route checks the token and the invite before anything else", () => {
  const files = routes(join(process.cwd(), "app", "api", "harness"));
  assert.ok(files.length >= 2);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const handler of source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{([\s\S]*?)\n\}/g)) {
      const body = handler[2];
      const auth = body.indexOf("harnessUser(");
      assert.ok(auth >= 0, `${file} ${handler[1]} must call harnessUser`);
      assert.ok(body.includes(`harnessUser(db, req.headers.get("authorization"), canUse)`), `${file} ${handler[1]} must pass the request's token and canUse`);
      for (const before of ["readJsonBody(", "repoProfile(", "recordEvent(", "storedProfile("]) {
        const at = body.indexOf(before);
        assert.ok(at === -1 || at > auth, `${file} ${handler[1]}: ${before} runs before the token check`);
      }
    }
  }
});
