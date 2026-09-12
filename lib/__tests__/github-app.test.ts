import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { clearInstallationToken, getInstallationToken, installationFetch, mintInstallationToken } from "../crucible/github-app";
import { gitAuthArgs, redactGitCredentials } from "../git-auth";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("installation tokens share one mint and refresh after invalidation or expiry", async (t) => {
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY, previousId = process.env.GITHUB_APP_ID;
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_APP_ID = "123";
  t.after(() => {
    if (previousKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = previousKey;
    if (previousId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = previousId;
  });
  let mints = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.method, "POST");
    assert.ok(init.signal);
    mints++;
    return Response.json({ token: "test-installation-value" });
  });
  const results = await Promise.all(Array.from({ length: 50 }, () => getInstallationToken(701)));
  assert.equal(mints, 1);
  assert.ok(results.every(value => value === "test-installation-value"));
  clearInstallationToken(701);
  await getInstallationToken(701);
  assert.equal(mints, 2);
  const future = Date.now() + 56 * 60_000;
  t.mock.method(Date, "now", () => future);
  await getInstallationToken(701);
  assert.equal(mints, 3);
});

test("clearing an in-flight installation token prevents stale cache repopulation", async (t) => {
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY, previousId = process.env.GITHUB_APP_ID;
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_APP_ID = "123";
  t.after(() => {
    clearInstallationToken(703);
    if (previousKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = previousKey;
    if (previousId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = previousId;
  });
  let requests = 0;
  let finishStale!: (response: Response) => void;
  const staleResponse = new Promise<Response>(resolve => { finishStale = resolve; });
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return requests === 1 ? staleResponse : Response.json({ token: "fresh-installation-value" });
  });

  const stale = getInstallationToken(703);
  await Promise.resolve();
  clearInstallationToken(703);
  assert.equal(await getInstallationToken(703), "fresh-installation-value");
  finishStale(Response.json({ token: "stale-installation-value" }));
  assert.equal(await stale, "stale-installation-value");
  assert.equal(await getInstallationToken(703), "fresh-installation-value");
  assert.equal(requests, 2);
});

test("installation requests reject credential destinations and invalid IDs", async () => {
  for (const url of ["https://evil.example/repos", "http://api.github.com/repos", "https://api.github.com.evil.example/repos", "https://name@api.github.com/repos"]) {
    await assert.rejects(installationFetch(702, url), /Invalid GitHub API URL/);
  }
  for (const id of [0, -1, 1.2, Infinity]) await assert.rejects(mintInstallationToken(id), /Invalid installation ID/);
});

test("git failures cannot print encoded authentication headers", () => {
  const args = gitAuthArgs("test-installation-value");
  const error = redactGitCredentials(`Command failed: git ${args.join(" ")} push origin HEAD\nfatal: permission denied`);
  assert.equal(error.includes(Buffer.from("x-access-token:test-installation-value").toString("base64")), false);
  assert.match(error, /permission denied/);
  assert.match(error, /\[redacted\]/);
});
