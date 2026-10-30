import { test } from "node:test";
import assert from "node:assert/strict";
import { resourceLinks, s2 } from "../lesson/steps/s2";
import { StepInputError } from "../lesson/steps";

test("s2 finds the places a project talks, from its README", () => {
  const readme = [
    "Docs: https://flask.palletsprojects.com/docs/ and https://pallets.github.io/x.",
    "Chat on Discord: https://discord.gg/pallets, or https://join.slack.com/t/x.",
    "Ask on https://github.com/pallets/flask/discussions.",
    "Forum: https://discuss.python.org/c/web.",
    "See https://github.com/pallets/flask/blob/main/CONTRIBUTING.rst",
    "Unrelated: https://example.com/shop",
  ].join("\n");
  const links = resourceLinks(readme, "pallets/flask");
  const kinds = Object.fromEntries(links.map((l) => [l.url, l.kind]));
  assert.equal(kinds["https://github.com/pallets/flask/blob/HEAD/CONTRIBUTING.md"], "contributing", "always offered");
  assert.equal(kinds["https://discord.gg/pallets"], "chat");
  assert.equal(kinds["https://join.slack.com/t/x"], "chat");
  assert.equal(kinds["https://github.com/pallets/flask/discussions"], "discussions");
  assert.equal(kinds["https://discuss.python.org/c/web"], "forum");
  assert.equal(kinds["https://flask.palletsprojects.com/docs/"], "docs");
  assert.equal(kinds["https://pallets.github.io/x"], "docs", "trailing punctuation is not part of a link");
  assert.equal(kinds["https://example.com/shop"], undefined);
  assert.equal(resourceLinks("", "o/r").length, 1);
});

test("s2 is free text and never graded", () => {
  assert.equal(s2.parseAnswer("  Discussions, because questions go there. "), "Discussions, because questions go there.");
  assert.throws(() => s2.parseAnswer(""), StepInputError);
  assert.equal(s2.prompt, undefined, "no model");
});
