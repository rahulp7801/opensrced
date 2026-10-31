import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROACH_QUOTE_CHARS, approachBullets, approachForRun, clip } from "../lesson/approach";
import { MemoryLessonStore, type LessonStep } from "../lesson/store";
import type { StepId } from "../lesson/machine";

const step = (id: StepId, answer: string, done = true): LessonStep => ({ step: id, answer, grade: null, done, hint_level: -1, hints_used: [], updated_at: "t" });

test("clip: short text kept, long text cut at a sentence end or a word, whitespace flattened", () => {
  assert.equal(clip("  one\n\ntwo  "), "one two");
  assert.equal(clip(""), "");
  const sentences = `${"a".repeat(100)}. ${"b".repeat(200)}.`;
  assert.equal(clip(sentences), `${"a".repeat(100)}.`);
  const words = Array.from({ length: 100 }, () => "word").join(" ");
  const cut = clip(words);
  assert.ok(cut.endsWith("…") && cut.length <= APPROACH_QUOTE_CHARS + 1 && !cut.includes("wor…"), cut);
  assert.equal(clip("x".repeat(300)).length, APPROACH_QUOTE_CHARS + 1, "one long token: hard cut");
});

test("approachBullets: only finished s4, s7, s8 answers, in the contributor's words", () => {
  const all = approachBullets({ steps: {
    s1: step("s1", "Flask is a web framework."),
    s4: step("s4", "Redirects drop the session cookie.\nSo users get logged out."),
    s7: step("s7", JSON.stringify(["sessions.py", "app.py", "`wrappers.py`", "a", "b", "c"])),
    s8: step("s8", "Save the session before building the redirect, and test that the cookie survives a redirect."),
    "explain-it": step("explain-it", "{\"files\":{}}"),
  } });
  assert.deepEqual(all, [
    "The problem, as I understood it: Redirects drop the session cookie. So users get logged out.",
    "Where I started looking: `sessions.py`, `app.py`, `wrappers.py`, `a`, `b`",
    "What I predicted before seeing any fix: Save the session before building the redirect, and test that the cookie survives a redirect.",
  ]);
  assert.deepEqual(approachBullets({ steps: {} }), []);
  assert.deepEqual(approachBullets({ steps: { s4: step("s4", "x", false), s8: step("s8", "   ") } }), [], "unfinished or blank answers are skipped");
  assert.deepEqual(approachBullets({ steps: { s7: step("s7", "parse.py\nlexer.py") } }), ["Where I started looking: `parse.py`, `lexer.py`"], "older plain-text picks");
});

test("approachForRun: the owner's lesson for that run only; null otherwise", async () => {
  const store = new MemoryLessonStore();
  const lesson = await store.create({ owner: "github|1", repo_url: "https://github.com/a/x", issue_number: 1, run_id: "d_run1", mode: "short", path: "A", stage: "done", answer_key: "verified" });
  assert.equal(await approachForRun(store, "github|1", "d_run1"), null, "nothing written yet");
  await store.saveStep(lesson.id, step("s4", "The bug."));
  assert.deepEqual(await approachForRun(store, "github|1", "d_run1"), ["The problem, as I understood it: The bug."]);
  assert.equal(await approachForRun(store, "github|2", "d_run1"), null, "someone else's lesson");
  assert.equal(await approachForRun(store, "github|1", "d_other"), null, "not a lesson run");
  assert.equal((await store.findByRun("d_run1"))?.id, lesson.id);
  assert.equal(await store.findByRun("nope"), null);
});
