import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRepoId } from "../sanitize";

test("repository inputs preserve complete names without silently changing the target", () => {
  for (const input of ["acme/project.name", "https://github.com/acme/project.name", "github.com/acme/project.name.git", " acme/project.name/ "]) {
    assert.equal(sanitizeRepoId(input), "acme/project.name");
  }
  for (const input of [null, 42, {}, "https://example.com/acme/project", "https://github.com.evil/acme/project", "prefix acme/project", "acme/project/extra", "acme/project?branch=main", "acme/project#fragment", "acme/../project", "acme/project\\secret", "acme/project\0", `acme/${"a".repeat(101)}`, "acme/.", "acme/..", "https://github.com/user:password@acme/project"]) {
    assert.equal(sanitizeRepoId(input), null, JSON.stringify(input));
  }
});
