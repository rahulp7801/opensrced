// A whole lesson through the harness: the site's lesson engine, with the
// context, the answer key and the grader's verdicts sent by the contributor's
// agent (lib/harness-lessons.ts), on a real (PGlite) database.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { createToken } from "../harness";
import {
  answerHarnessStep, createHarnessLesson, getHarnessLesson, harnessHint, harnessOwnDiff, harnessReveal, parseGraph, setHarnessKey,
  HarnessLessonInputError,
} from "../harness-lessons";
import { DbLessonStore } from "../lesson/db-store";

process.env.OPENSRCER_LESSONS = "1";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  await createToken(connection.db, "github|1", "alice", "laptop");
  await createToken(connection.db, "github|2", "bob", "laptop");
});
after(() => connection.close());

const GRAPH = {
  nodes: [
    { id: "app/fill.py", label: "fill.py", community: 0, file_type: "code", source_file: "app/fill.py" },
    { id: "app/fill.py::fill", label: "fill", community: 0, file_type: "code", source_file: "app/fill.py" },
    { id: "app/core.py", label: "core.py", community: 0, file_type: "code", source_file: "app/core.py" },
    { id: "tests/test_fill.py", label: "test_fill.py", community: 1, file_type: "code", source_file: "tests/test_fill.py" },
    { id: "ext:pandas", label: "pandas", community: 2, file_type: "external", source_file: "" },
  ],
  links: [
    { source: "app/fill.py", target: "app/fill.py::fill", relation: "contains", confidence: "EXTRACTED", confidence_score: 1, source_file: "app/fill.py" },
    { source: "app/core.py", target: "app/fill.py", relation: "imports", confidence: "EXTRACTED", confidence_score: 1, source_file: "app/core.py" },
    { source: "app/fill.py", target: "ext:pandas", relation: "imports", confidence: "EXTRACTED", confidence_score: 1, source_file: "app/fill.py" },
  ],
};
const KEY = [
  "diff --git a/app/fill.py b/app/fill.py", "--- a/app/fill.py", "+++ b/app/fill.py", "@@ -1,2 +1,2 @@",
  " def fill(df, value):", "-    return df", "+    return df.fillna(value)",
].join("\n");
const WORDS = (n: number, word = "word") => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");

const post = (body: unknown) => new Request("http://x/", { method: "POST", body: JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are probed field by field below
const read = async (res: Response) => ({ status: res.status, body: await res.json() as Record<string, any> });

async function start(user = "github|1", extra: Record<string, unknown> = {}) {
  const res = await read(await createHarnessLesson(post({
    repo: "acme/app", issue: 12, issue_title: "fill ignores value", issue_body: "Calling fill(df, 0) leaves NaN.", readme: "acme/app cleans data frames.", graph: GRAPH, ...extra,
  }), connection.db, user));
  return res;
}

test("a whole lesson: rubric, the agent's verdict, the key, a deterministic grade, the reveal and done", async () => {
  const db = connection.db;
  const created = await start();
  assert.equal(created.status, 201);
  const id = created.body.lesson.id as string;
  assert.equal(created.body.lesson.stage, "kickoff");
  assert.equal(created.body.lesson.answer_key, "pending");
  assert.ok(created.body.lesson.steps.some((s: { id: string; question: string }) => s.id === "s1" && /what does this project do/.test(s.question)));

  // s1 needs a model: the rubric comes back, nothing is saved.
  const s1 = WORDS(70);
  const rubric = await read(await answerHarnessStep(post({ step: "s1", answer: s1 }), id, db, "github|1"));
  assert.equal(rubric.status, 200);
  assert.equal(rubric.body.needs_grading, true);
  assert.match(rubric.body.rubric.system, /"users":true,"purpose":true,"parts":2/);
  assert.match(rubric.body.rubric.user, /acme\/app cleans data frames/);
  assert.equal((await read(await getHarnessLesson(id, db, "github|1"))).body.lesson.steps.find((s: { id: string }) => s.id === "s1").done, false);

  // A reply that isn't the rubric's JSON is refused; the right one is parsed by the step.
  assert.equal((await answerHarnessStep(post({ step: "s1", answer: s1, grader_reply: "looks good!" }), id, db, "github|1")).status, 502);
  const graded = await read(await answerHarnessStep(post({ step: "s1", answer: s1, grader_reply: '{"users":true,"purpose":true,"parts":2,"feedback":"Clear."}' }), id, db, "github|1"));
  assert.deepEqual([graded.body.step.done, graded.body.step.grade.feedback], [true, "Clear."]);

  const s4 = await read(await answerHarnessStep(post({ step: "s4", answer: WORDS(20, "repro"), grader_reply: '{"behaviour":true,"repro":true,"feedback":"Good."}' }), id, db, "github|1"));
  assert.equal(s4.body.lesson.stage, "locate");

  // The agent sends the hidden fix; s7 is then graded by graph distance, with no model.
  assert.equal((await setHarnessKey(post({ diff: "not a diff", verified: true }), id, db, "github|1")).status, 400);
  const keyed = await read(await setHarnessKey(post({ diff: KEY, diagnosis: "fill dropped value", title: "Fill with value", verified: true }), id, db, "github|1"));
  assert.equal(keyed.body.lesson.answer_key, "verified");
  const hint = await read(await harnessHint(post({ step: "s7" }), id, db, "github|1"));
  assert.equal(hint.status, 200);
  const s7 = await read(await answerHarnessStep(post({ step: "s7", answer: "app/fill.py\napp/core.py\ntests/test_fill.py" }), id, db, "github|1"));
  assert.equal(s7.body.needs_grading, undefined, "s7 is graded without a model");
  assert.equal(s7.body.step.done, true);
  assert.match(s7.body.step.grade.feedback, /app\/fill\.py: on target/);

  const s8answer = WORDS(70, "change");
  const s8rubric = await read(await answerHarnessStep(post({ step: "s8", answer: s8answer }), id, db, "github|1"));
  assert.match(s8rubric.body.rubric.user, /fillna\(value\)/, "the rubric carries the key for the agent to judge against");
  const s8 = await read(await answerHarnessStep(post({ step: "s8", answer: s8answer, grader_reply: '{"cause":true,"change":true,"proof":true,"alternative":false,"feedback":"Yes."}' }), id, db, "github|1"));
  assert.equal(s8.body.lesson.stage, "reveal");

  // Before the reveal the key is not in the lesson; after it, it is.
  assert.equal((await read(await getHarnessLesson(id, db, "github|1"))).body.key, undefined);
  const revealed = await read(await harnessReveal(post({}), id, db, "github|1"));
  assert.equal(revealed.body.lesson.stage, "explain");
  assert.equal((await read(await getHarnessLesson(id, db, "github|1"))).body.key.diff, KEY);
  assert.equal((await setHarnessKey(post({ diff: KEY, verified: true }), id, db, "github|1")).status, 409, "the key is frozen once revealed");

  const explain = { files: { "app/fill.py": "It passes the value to fillna so the gaps are filled." }, test: WORDS(12, "proof") };
  const explainRubric = await read(await answerHarnessStep(post({ step: "explain-it", answer: explain }), id, db, "github|1"));
  assert.equal(explainRubric.body.needs_grading, true);
  const explained = await read(await answerHarnessStep(post({ step: "explain-it", answer: explain, grader_reply: '{"proves":true,"feedback":"Right."}' }), id, db, "github|1"));
  assert.equal(explained.body.lesson.stage, "next");
  const done = await read(await answerHarnessStep(post({ step: "s10", answer: "Follow the PR." }), id, db, "github|1"));
  assert.equal(done.body.lesson.stage, "done");
});

test("path B: the contributor's own diff from their checkout leads to the reveal", async () => {
  const db = connection.db;
  const id = (await start("github|1", { path: "B" })).body.lesson.id as string;
  assert.equal((await harnessOwnDiff(post({ diff: KEY }), id, db, "github|1", false)).status, 200);
  const submitted = await read(await harnessOwnDiff(post({ diff: KEY }), id, db, "github|1", true));
  assert.equal(submitted.body.lesson.ide_submitted, true);
});

const BAD_CREATES: Array<[string, Record<string, unknown>, RegExp]> = [
  ["no issue title", { issue_title: "  " }, /issue_title is required/],
  ["a graph link to a missing node", { graph: { nodes: GRAPH.nodes, links: [{ source: "app/fill.py", target: "nowhere", relation: "imports" }] } }, /link needs a source and target/],
  ["a graph without links", { graph: { nodes: [] } }, /nodes and links arrays/],
  ["a bad issue number", { issue: 0 }, /issue_number must be a positive whole number/],
];
for (const [name, extra, message] of BAD_CREATES) {
  test(`creating a harness lesson with ${name} is refused, storing nothing`, async () => {
    const res = await start("github|1", extra);
    assert.equal(res.status, 400);
    assert.match(res.body.error, message);
  });
}

test("a lesson is its owner's alone, and site lessons are not reachable through the harness", async () => {
  const db = connection.db;
  const id = (await start()).body.lesson.id as string;
  assert.equal((await getHarnessLesson(id, db, "github|2")).status, 404);
  assert.equal((await answerHarnessStep(post({ step: "s1", answer: WORDS(70) }), id, db, "github|2")).status, 404);
  assert.equal((await setHarnessKey(post({ diff: KEY, verified: true }), id, db, "github|2")).status, 404);
  const site = await new DbLessonStore(async () => db).create({ owner: "github|1", repo_url: "https://github.com/acme/app", issue_number: 3, run_id: "r_1", mode: "short", path: "A", stage: "kickoff", answer_key: "pending" });
  assert.equal((await getHarnessLesson(site.id, db, "github|1")).status, 404);
  assert.equal((await getHarnessLesson("l_nonsense", db, "github|1")).status, 404);
});

test("answers are checked before anything is graded or saved", async () => {
  const db = connection.db;
  const id = (await start()).body.lesson.id as string;
  const cases: Array<[Record<string, unknown>, number, RegExp]> = [
    [{ step: "s9", answer: "x" }, 400, /step must be one of/],
    [{ step: "s1", answer: "too short" }, 400, /at least 60 words/],
    [{ step: "s1", answer: WORDS(70), grader_reply: 42 }, 400, /grader_reply must be/],
    [{ step: "s8", answer: WORDS(70) }, 409, /not open in the kickoff stage/],
  ];
  for (const [body, status, message] of cases) {
    const res = await read(await answerHarnessStep(post(body), id, db, "github|1"));
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match(res.body.error, message);
  }
});

test("parseGraph accepts none, and refuses anything that isn't nodes and links", () => {
  assert.equal(parseGraph(undefined), null);
  assert.equal(parseGraph(GRAPH)?.nodes.length, 5);
  assert.throws(() => parseGraph([]), HarnessLessonInputError);
  assert.throws(() => parseGraph({ nodes: [{ id: 1 }], links: [] }), HarnessLessonInputError);
});
