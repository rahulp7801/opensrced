import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLesson, getLesson, GRADED_QUIETLY, leakGate, lessonStatus, nextHint, publicLesson, revealLesson, submitStep, teacherTurn,
  LESSONS_DISABLED, type LessonDeps,
} from "../lesson/api";
import { MemoryLessonStore, type Lesson } from "../lesson/store";
import type { AnswerKeyStatus } from "../lesson/machine";
import type { RuntimeMessage, SendOptions, TeacherRuntime } from "../lesson/runtime";
import type { StepContext } from "../lesson/steps";

process.env.OPENSRCER_LESSONS = "1";

const DIFF = "--- a/src/flask/sessions.py\n+++ b/src/flask/sessions.py\n@@ -340,3 +340,4 @@ def save_session(self, app, session, response):\n+        is_redirect = 300 <= response.status_code < 400\n";
const OWNER = "auth0|alice";
const post = (body: unknown) => new Request("http://local/x", { method: "POST", body: JSON.stringify(body) });

function harness(opts: { key?: AnswerKeyStatus; replies?: string[]; runtime?: boolean; owner?: string | null } = {}) {
  const store = new MemoryLessonStore();
  const sent: Array<{ messages: RuntimeMessage[]; opts: SendOptions }> = [];
  const replies = opts.replies ?? [];
  const runtime: TeacherRuntime = {
    provider: "anthropic-key",
    send(messages, o) {
      sent.push({ messages, opts: o });
      return new Response(`data: ${JSON.stringify({ text: replies.shift() ?? "" })}\n\ndata: ${JSON.stringify({ cost: 0, done: true })}\n\n`);
    },
  };
  const revealed: string[] = [];
  const started: unknown[] = [];
  let key: AnswerKeyStatus = opts.key ?? "verified";
  const logs: string[] = [];
  const deps: LessonDeps = {
    owner: async () => (opts.owner === undefined ? OWNER : opts.owner),
    store,
    startRun: async (input) => { started.push(input); return { id: "c_1700000000000_aaaaaaaaaaaa" }; },
    runState: async () => ({ status: "running", log: "[agentic-dispatcher] bin: claude\n[tool] edit_file src/flask/sessions.py\n" }),
    keyStatus: async () => key,
    context: async (): Promise<StepContext> => ({
      repo: "pallets/flask", issue: { number: 5, title: "Session lost on redirect", body: "The cookie is missing after a redirect." }, readme: "", graph: null,
      answerKey: key === "verified" || key === "unverified" ? { diff: DIFF, diagnosis: "redirects skip the cookie", cases: [], title: "t" } : null, answerKeyStatus: key,
    }),
    runtime: async () => (opts.runtime === false ? null : runtime),
    reveal: async (owner, runId) => { revealed.push(`${owner} ${runId}`); },
    log: (l) => logs.push(l),
  };
  return { deps, store, sent, revealed, started, logs, setKey: (k: AnswerKeyStatus) => { key = k; } };
}

async function newLesson(h: ReturnType<typeof harness>, body: object = { repo_url: "https://github.com/pallets/flask/issues/5" }): Promise<string> {
  const res = await createLesson(post(body), h.deps);
  assert.equal(res.status, 201);
  return (await res.json()).lesson.id;
}

test("create: validates, starts a hidden run for the owner, and saves a short-mode lesson", async () => {
  const h = harness();
  const id = await newLesson(h);
  assert.deepEqual(h.started.map((s) => ({ ...(s as object), signal: undefined })), [{ repoUrl: "https://github.com/pallets/flask", issueNumber: 5, owner: OWNER, signal: undefined }]);
  const lesson = (await h.store.get(id))!;
  assert.deepEqual([lesson.owner, lesson.run_id, lesson.mode, lesson.path, lesson.stage, lesson.answer_key], [OWNER, "c_1700000000000_aaaaaaaaaaaa", "short", "A", "kickoff", "pending"]);
  for (const [body, status] of [
    [{ repo_url: "not a url" }, 400], [{ repo_url: "https://github.com/pallets/flask" }, 400], [{ repo_url: "https://github.com/pallets/flask/issues/5", issue_number: 6 }, 400],
    [{ repo_url: "https://github.com/pallets/flask", issue_number: 5, mode: "long" }, 400], [{ repo_url: "https://github.com/pallets/flask", issue_number: 5, path: "C" }, 400],
  ] as const) assert.equal((await createLesson(post(body), h.deps)).status, status, JSON.stringify(body));
  assert.equal(h.started.length, 1, "nothing starts on bad input");
  const failing = harness();
  failing.deps.startRun = async () => { throw Object.assign(new Error("You already have a run in progress."), { status: 429 }); };
  const res = await createLesson(post({ repo_url: "https://github.com/pallets/flask/issues/5" }), failing.deps);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /already have a run/);
});

test("every route: off without the flag, 401 anonymous, 404 for someone else's lesson", async () => {
  const h = harness();
  const id = await newLesson(h);
  const mallory = harness({ owner: "auth0|mallory" });
  mallory.deps.store = h.store;
  const anon = harness({ owner: null });
  anon.deps.store = h.store;
  const calls = (deps: LessonDeps) => [
    getLesson(id, deps), lessonStatus(id, deps), submitStep(post({ answer: "x" }), id, "s1", deps), nextHint(post({ step: "s1" }), id, deps),
    teacherTurn(post({ message: "hi" }), id, deps), revealLesson(post({ give_up: true }), id, deps),
  ];
  for (const res of await Promise.all(calls(mallory.deps))) assert.equal(res.status, 404);
  for (const res of await Promise.all(calls(anon.deps))) assert.equal(res.status, 401);
  assert.equal(mallory.revealed.length + h.revealed.length, 0);
  assert.equal((await getLesson("../x", h.deps)).status, 404);
  process.env.OPENSRCER_LESSONS = "0";
  try {
    for (const res of await Promise.all([...calls(h.deps), createLesson(post({}), h.deps)])) {
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error, LESSONS_DISABLED);
    }
  } finally { process.env.OPENSRCER_LESSONS = "1"; }
});

test("status: the phase only, never the log's file names", async () => {
  const h = harness();
  const id = await newLesson(h);
  const res = await lessonStatus(id, h.deps);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { phase: "solving", label: "Solving…" });
  assert.doesNotMatch(text, /sessions/);
});

test("get: the lesson without the run's content; the answer key status catches up", async () => {
  const h = harness({ key: "pending" });
  const id = await newLesson(h);
  assert.equal((await (await getLesson(id, h.deps)).json()).lesson.answer_key, "pending");
  h.setKey("verified");
  const body = await (await getLesson(id, h.deps)).json();
  assert.equal(body.lesson.answer_key, "verified");
  assert.equal(body.teacher_available, true);
  assert.doesNotMatch(JSON.stringify(body), /is_redirect|sessions\.py|redirects skip/);
});

test("steps: kickoff in short mode moves to locate; s7 is graded by graph distance with a verified key", async () => {
  const h = harness();
  const id = await newLesson(h);
  assert.equal((await submitStep(post({ answer: "x" }), id, "s7", h.deps)).status, 409, "s7 is not open during kickoff");
  assert.equal((await submitStep(post({ answer: "short" }), id, "s1", h.deps)).status, 400);
  assert.equal((await submitStep(post({ answer: "x" }), id, "s99", h.deps)).status, 404);
  // s1 and s4 go to the grader model, which answers each step's JSON.
  h.deps.runtime = async () => ({ provider: "anthropic-key", send: (_m, o) => {
    const text = /what an open-source project/.test(o.system) ? '{"users":true,"purpose":true,"parts":2,"feedback":"Clear."}' : '{"behaviour":true,"repro":true,"feedback":"Good."}';
    return new Response(`data: ${JSON.stringify({ text })}\n\ndata: {"done":true,"cost":0}\n\n`);
  } });
  const s1 = await submitStep(post({ answer: "Flask is a small Python library people use to build websites and web APIs. Backend developers pick it when they want something lighter than Django. The main parts are the app object that holds routes and configuration, the request and response helpers, sessions that remember users between requests, and templates rendered with Jinja. You write a function, attach it to a URL, and Flask calls it." }), id, "s1", h.deps);
  assert.equal(s1.status, 200);
  assert.equal((await s1.json()).step.done, true);
  assert.equal((await h.store.get(id))!.turns_used, 1, "one grader call spent one turn");
  const s4 = await submitStep(post({ answer: "When a view logs someone in and then redirects, the browser never gets the session cookie, so the next page treats them as logged out. To reproduce: set session['user'] then redirect('/home') and check Set-Cookie." }), id, "s4", h.deps);
  assert.equal((await s4.json()).lesson.stage, "locate");
  const s7 = await (await submitStep(post({ answer: "src/flask/sessions.py\nsrc/flask/app.py\nsrc/flask/cli.py" }), id, "s7", h.deps)).json();
  assert.equal(s7.step.done, true);
  assert.equal(s7.lesson.stage, "predict");
});

test("steps: with an unverified key s7 is saved without a grade ('investigate together')", async () => {
  const h = harness({ key: "unverified" });
  const id = await newLesson(h);
  await h.store.updateStage(id, "locate");
  const s7 = await (await submitStep(post({ answer: "a.py\nb.py\nc.py" }), id, "s7", h.deps)).json();
  assert.equal(s7.step.grade, null);
  assert.equal(s7.step.done, true);
  assert.equal(h.sent.length, 0, "no model call");
});

test("steps: a grader's feedback that names the fix is replaced before it is returned", async () => {
  const h = harness({ replies: ['{"cause":true,"change":true,"proof":false,"alternative":false,"feedback":"Yes: add is_redirect = 300 <= response.status_code < 400 in save_session."}'] });
  const id = await newLesson(h);
  await h.store.updateStage(id, "predict");
  const res = await (await submitStep(post({ answer: "The cookie is skipped for redirect responses because the save step only checks whether the session changed; I would also write it for 3xx and test a login redirect." }), id, "s8", h.deps)).json();
  assert.equal(res.step.done, true);
  assert.equal(res.step.grade.feedback, GRADED_QUIETLY);
  assert.match(h.logs.join(" "), /grader feedback replaced/);
});

test("steps: no engine or no turns left means no model grading, with a clear message", async () => {
  const none = harness({ runtime: false });
  const id = await newLesson(none);
  const s4 = await submitStep(post({ answer: "When a view logs someone in and then redirects, the browser never gets the session cookie, so the next page treats them as logged out." }), id, "s4", none.deps);
  assert.equal(s4.status, 409);
  assert.match((await s4.json()).error, /Copilot or your own API key/);
  const broke = harness();
  const id2 = await newLesson(broke);
  await broke.store.updateStage(id2, "kickoff", { turns_used: 59 });
  assert.equal((await submitStep(post({ answer: "When a view logs someone in and then redirects, the browser never gets the session cookie, so the next page treats them as logged out." }), id2, "s4", broke.deps)).status, 429);
});

test("hints climb the ladder, are stored, and the pointing ones come from the hidden diff", async () => {
  const h = harness();
  const id = await newLesson(h);
  await h.store.updateStage(id, "locate");
  const texts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const res = await (await nextHint(post({ step: "s7" }), id, h.deps)).json();
    assert.equal(res.level, i);
    texts.push(res.text);
  }
  assert.match(texts[1], /src\/flask\//);
  assert.match(texts[2], /`src\/flask\/sessions\.py`/);
  assert.equal((await nextHint(post({ step: "s7" }), id, h.deps)).status, 409, "the ladder ends");
  const lesson = (await h.store.get(id))!;
  assert.deepEqual(lesson.steps.s7?.hints_used, [0, 1, 2]);
  assert.equal(leakGate(lesson).s7HintLevel, 2);
  assert.equal((await nextHint(post({ step: "s8" }), id, h.deps)).status, 409, "s8 is not open yet");
  assert.equal((await nextHint(post({}), id, h.deps)).status, 400);
});

test("teacher: replies are leak-checked before they go out, history is saved, turns are counted", async () => {
  const h = harness({ replies: ["Open sessions.py and read save_session.", "What decides whether the cookie is written on a redirect?"] });
  const id = await newLesson(h);
  const res = await teacherTurn(post({ message: "Where do I look?", step: "s4" }), id, h.deps);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const body = await res.text();
  assert.match(body, /What decides whether the cookie is written on a redirect\?/);
  assert.doesNotMatch(body, /sessions\.py|save_session/);
  assert.match(body, /"done":true,"turns_left":58/);
  assert.equal(h.sent.length, 2, "regenerated once");
  assert.match(h.sent[0].opts.system, /<answer-key>/);
  assert.match(h.sent[0].messages.at(-1)!.content, /^<lesson>\nStage: kickoff/);
  const messages = await h.store.listMessages(id);
  assert.deepEqual(messages.map((m) => [m.role, m.content]), [["user", "Where do I look?"], ["teacher", "What decides whether the cookie is written on a redirect?"]]);
  assert.equal((await h.store.get(id))!.turns_used, 2);
  for (const body of [{}, { message: "" }, { message: "x".repeat(2001) }, { message: "hi", step: "s99" }]) {
    assert.equal((await teacherTurn(post(body), id, h.deps)).status, 400, JSON.stringify(body).slice(0, 30));
  }
  assert.equal((await teacherTurn(post({ message: "hi" }), id, harness({ runtime: false }).deps)).status, 404, "another store: not found");
});

test("teacher: unavailable without Copilot or a key, and stops at the turn budget", async () => {
  const none = harness({ runtime: false });
  const id = await newLesson(none);
  assert.equal((await teacherTurn(post({ message: "hi" }), id, none.deps)).status, 409);
  const h = harness();
  const id2 = await newLesson(h);
  await h.store.updateStage(id2, "kickoff", { turns_used: 60 });
  assert.equal((await teacherTurn(post({ message: "hi" }), id2, h.deps)).status, 429);
  assert.equal(h.sent.length, 0);
});

test("reveal: only after s8 or an explicit give-up, only once the fix is ready, and it sets the marker", async () => {
  const h = harness({ key: "pending" });
  const id = await newLesson(h);
  assert.equal((await revealLesson(post({}), id, h.deps)).status, 409, "not before s8");
  assert.equal((await revealLesson(post({ give_up: true }), id, h.deps)).status, 409, "the fix is still running");
  h.setKey("failed");
  assert.match((await (await revealLesson(post({ give_up: true }), id, h.deps)).json()).error, /nothing to reveal/);
  h.setKey("verified");
  assert.equal(h.revealed.length, 0);
  const res = await (await revealLesson(post({ give_up: true }), id, h.deps)).json();
  assert.deepEqual(h.revealed, [`${OWNER} c_1700000000000_aaaaaaaaaaaa`]);
  assert.equal(res.lesson.stage, "explain");
  assert.equal(res.lesson.revealed, true);
  assert.equal(res.lesson.gave_up, true);
  assert.equal((await revealLesson(post({}), id, h.deps)).status, 200, "revealing again is harmless");
  assert.equal(h.revealed.length, 1);

  const after = harness();
  const id2 = await newLesson(after);
  await after.store.updateStage(id2, "reveal");
  assert.equal((await (await revealLesson(post({}), id2, after.deps)).json()).lesson.gave_up, false, "after s8 no give-up is needed");
});

test("publicLesson lists the steps a contributor can see, and nothing of the run", () => {
  const lesson: Lesson = { id: "l_1", owner: OWNER, repo_url: "https://github.com/o/r", issue_number: 1, run_id: "c_1", mode: "short", path: "A", stage: "kickoff", answer_key: "verified", turns_used: 3, created_at: "t", steps: {} };
  const view = publicLesson(lesson, "copilot");
  assert.deepEqual(view.required, ["s1", "s4", "s7", "s8", "explain-it", "s10"]);
  assert.ok(view.steps.some((s) => s.id === "s2"), "optional kickoff steps are offered");
  assert.deepEqual(view.turns, { limit: 15, used: 3, left: 12, low: false, exhausted: false });
  assert.equal("owner" in view, false);
});

test("finishing the lesson (s10) calls deps.finished once, with the done lesson", async () => {
  const h = harness();
  const finished: Lesson[] = [];
  h.deps.finished = async (lesson) => { finished.push(lesson); };
  const lesson = await h.store.create({ owner: OWNER, repo_url: "https://github.com/pallets/flask", issue_number: 5, run_id: "c_1", mode: "short", path: "A", stage: "next", answer_key: "verified" });
  const res = await submitStep(post({ answer: "Pick a related issue." }), lesson.id, "s10", h.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(finished.map((l) => [l.id, l.stage]), [[lesson.id, "done"]]);
  assert.equal((await submitStep(post({ answer: "Again." }), lesson.id, "s10", h.deps)).status, 409, "done: s10 is closed");
  assert.equal(finished.length, 1);
  // Without the hook (record off) finishing still works.
  const plain = harness();
  const other = await plain.store.create({ owner: OWNER, repo_url: "https://github.com/pallets/flask", issue_number: 5, run_id: "c_2", mode: "short", path: "A", stage: "next", answer_key: "verified" });
  assert.equal((await submitStep(post({ answer: "Next." }), other.id, "s10", plain.deps)).status, 200);
});
