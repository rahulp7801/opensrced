import { test } from "node:test";
import assert from "node:assert/strict";
import { safeAvatarUrl } from "../avatar-url";

test("OAuth avatars load only from GitHub's HTTPS image host", () => {
  assert.equal(safeAvatarUrl("https://avatars.githubusercontent.com/u/123?v=4"), "https://avatars.githubusercontent.com/u/123?v=4");
  for (const value of [
    "http://avatars.githubusercontent.com/u/123",
    "https://avatars.githubusercontent.com.evil.example/u/123",
    "https://user:pass@avatars.githubusercontent.com/u/123",
    "https://example.com/tracker.gif",
    "not a URL",
    null,
  ]) assert.equal(safeAvatarUrl(value), null);
});
