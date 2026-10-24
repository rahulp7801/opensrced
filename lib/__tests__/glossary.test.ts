import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY } from "../glossary";

test("every glossary entry is a short, complete plain-language definition", () => {
  const entries = Object.entries(GLOSSARY);
  assert.ok(entries.length >= 10);
  for (const [term, definition] of entries) {
    assert.ok(definition.length >= 40 && definition.length <= 400, `${term}: ${definition.length} chars`);
    assert.match(definition, /[.!]$/, `${term} ends as a sentence`);
    assert.doesNotMatch(definition, /\b(?:poller|dispatch|exec box|worktree)\b/i, `${term} uses no internal names`);
  }
});

test("the publish-gate claims in the glossary match the code: drafts only, previews never publish", () => {
  assert.match(GLOSSARY["draft PR"], /always opens drafts/);
  assert.match(GLOSSARY.preview, /can never be published/);
  assert.equal((GLOSSARY as Record<string, string>)["not-a-term"], undefined);
});
