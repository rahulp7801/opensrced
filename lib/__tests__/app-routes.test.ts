import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { APP_FOLDERS, unknownRoute } from "../app-routes";

test("APP_FOLDERS lists exactly the route folders under app/", () => {
  // A new route folder missing here would 404 instead of reaching the sign-in gate.
  const folders = readdirSync("app", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual([...APP_FOLDERS].sort(), folders);
});

test("unknownRoute: paths no route serves", () => {
  for (const path of ["/nope", "/docs", "/terms", "/about", "/manifest.webmanifest", "/nope/deeper"]) assert.equal(unknownRoute(path), true, path);
});

test("unknownRoute fails closed: encoded, re-cased or undecodable spellings of a route stay gated", () => {
  for (const path of ["/%61pi/dispatches", "/API/dispatches", "/Discover", "/%64ispatches", "/%E0%A4%A/x", "/%"]) assert.equal(unknownRoute(path), false, path);
});

test("unknownRoute: the landing page, app routes and SDK routes are known", () => {
  for (const path of ["/", "/discover", "/prs/a/b/1", "/api/dispatches", "/auth/login", "/me/x", "/demo/stage", "/crucible/orgs/x"]) assert.equal(unknownRoute(path), false, path);
});
