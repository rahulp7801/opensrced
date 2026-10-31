import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askAboutSelection, createLesson, draftClaim, getLesson, GRADED_QUIETLY, lessonPrefs, leakGate, lessonStatus, nextHint, publicLesson, revealLesson, saveIdeDiff,
  submitStep, suggestAtCursor, teacherTurn, updateLesson, LESSONS_DISABLED, type LessonDeps,
} from "../lesson/api";
import { MemoryLessonStore, type Lesson } from "../lesson/store";
import type { AnswerKeyStatus } from "../lesson/machine";
import type { RuntimeMessage, SendOptions, TeacherRuntime } from "../lesson/runtime";
import type { StepContext } from "../lesson/steps";
import { GitHubApiError } from "../github-api";
import { MaintainerPrefsFetchError, summarizePrefs } from "../maintainer-prefs";

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
    updateLesson(post({ path: "B" }), id, deps), askAboutSelection(post({ selection: "", file: "a" }), id, deps),
    suggestAtCursor(post({ file: "a", line: 1 }), id, deps), saveIdeDiff(post({ diff: "x" }), id, deps, false), saveIdeDiff(post({ diff: "x" }), id, deps, true),
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

test("get: pins the commit once, keeps going when GitHub fails, and returns the chat history", async () => {
  const h = harness();
  const id = await newLesson(h);
  const asked: string[] = [];
  h.deps.headSha = async (repo) => { asked.push(repo); throw new Error("rate limited"); };
  let body = await (await getLesson(id, h.deps)).json();
  assert.equal(body.lesson.base_sha, null, "a failed lookup leaves it unpinned");
  assert.match(h.logs.join("\n"), /could not pin a commit: rate limited/);
  h.deps.headSha = async (repo) => { asked.push(repo); return "not-a-sha"; };
  assert.equal((await (await getLesson(id, h.deps)).json()).lesson.base_sha, null, "only a full SHA is kept");
  h.deps.headSha = async (repo) => { asked.push(repo); return "A".repeat(40); };
  await h.store.appendMessage(id, { role: "user", content: "hello", step: null, at: "t" });
  body = await (await getLesson(id, h.deps)).json();
  assert.equal(body.lesson.base_sha, "a".repeat(40));
  assert.deepEqual(body.messages.map((m: { content: string }) => m.content), ["hello"]);
  await getLesson(id, h.deps);
  assert.deepEqual(asked, ["pallets/flask", "pallets/flask", "pallets/flask"], "pinned once, then never asked again");
});

test("update: the path changes until s8, the mode only during kickoff, and short mode can move the lesson on", async () => {
  const h = harness();
  const id = await newLesson(h, { repo_url: "https://github.com/pallets/flask/issues/5", mode: "full" });
  for (const [body, status] of [[{}, 400], [{ path: "C" }, 400], [{ mode: "long" }, 400]] as const) {
    assert.equal((await updateLesson(post(body), id, h.deps)).status, status, JSON.stringify(body));
  }
  assert.equal((await (await updateLesson(post({ path: "B" }), id, h.deps)).json()).lesson.path, "B");
  const done = { answer: "x", grade: null, done: true, hint_level: -1, hints_used: [], updated_at: "t" };
  await h.store.saveStep(id, { ...done, step: "s1" });
  await h.store.saveStep(id, { ...done, step: "s4" });
  const short = await (await updateLesson(post({ mode: "short" }), id, h.deps)).json();
  assert.deepEqual([short.lesson.mode, short.lesson.stage], ["short", "locate"], "s1 and s4 were all short mode needed");
  assert.equal((await updateLesson(post({ mode: "full" }), id, h.deps)).status, 409, "mode is fixed after kickoff");
  assert.equal((await (await updateLesson(post({ path: "A" }), id, h.deps)).json()).lesson.path, "A", "path still open in locate");
  await h.store.updateStage(id, "reveal");
  assert.equal((await updateLesson(post({ path: "B" }), id, h.deps)).status, 409, "closed once s8 is done");
  assert.equal((await updateLesson(post({ path: "A" }), id, h.deps)).status, 200, "the same path is not a change");
  assert.equal((await h.store.get(id))!.path, "A");
});

test("IDE ask and suggest: one leak-checked teacher turn each, saved with the chat", async () => {
  const h = harness({ replies: ["Open sessions.py and read save_session.", "What decides whether the cookie is written?", "What should happen to the status code here?"] });
  const id = await newLesson(h);
  const ask = await (await askAboutSelection(post({ selection: "def f():\n  pass\n", file: "src/app.py", question: "Why?" }), id, h.deps)).json();
  assert.equal(ask.reply, "What decides whether the cookie is written?", "the leaking first reply was regenerated");
  assert.match(h.sent[0].messages.at(-1)!.content, /Why\?\n\nIn src\/app\.py:\n```\ndef f\(\):/);
  const suggest = await (await suggestAtCursor(post({ file: "src/app.py", line: 3 }), id, h.deps)).json();
  assert.equal(suggest.suggestion, "What should happen to the status code here?");
  assert.equal((await h.store.listMessages(id)).length, 4);
  for (const body of [{}, { selection: 1, file: "a" }, { selection: "x".repeat(20_001), file: "a" }, { selection: "", file: "a", question: 3 }]) {
    assert.equal((await askAboutSelection(post(body), id, h.deps)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  for (const body of [{}, { file: "", line: 1 }, { file: "a", line: 0 }, { file: "a", line: 1.5 }]) {
    assert.equal((await suggestAtCursor(post(body), id, h.deps)).status, 400, JSON.stringify(body));
  }
  const none = harness({ runtime: false });
  const id2 = await newLesson(none);
  assert.equal((await suggestAtCursor(post({ file: "a", line: 1 }), id2, none.deps)).status, 409);
});

test("IDE diff: checkpoints save, submit needs path B and changes, moves ide to reveal, and freezes at the reveal", async () => {
  const h = harness();
  const id = await newLesson(h);
  const diff = "--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b\n";
  assert.equal((await (await saveIdeDiff(post({ diff }), id, h.deps, false)).json()).ok, true);
  assert.equal((await h.store.get(id))!.ide_diff, diff);
  assert.equal((await saveIdeDiff(post({ diff }), id, h.deps, true)).status, 409, "path A has nothing to submit");
  await updateLesson(post({ path: "B" }), id, h.deps);
  assert.equal((await saveIdeDiff(post({ diff: "  " }), id, h.deps, true)).status, 400);
  assert.equal((await saveIdeDiff(post({ diff: 3 }), id, h.deps, false)).status, 400);
  await h.store.updateStage(id, "ide");
  const submitted = await (await saveIdeDiff(post({ diff }), id, h.deps, true)).json();
  assert.deepEqual([submitted.lesson.stage, submitted.lesson.ide_submitted, "ide_diff" in submitted.lesson], ["reveal", true, false]);
  const revealed = await (await revealLesson(post({}), id, h.deps)).json();
  assert.equal(revealed.lesson.ide_diff, diff, "the contributor's diff comes back for the comparison");
  assert.equal((await saveIdeDiff(post({ diff: "" }), id, h.deps, false)).status, 409);
});

// ── Rapport: claiming the issue, the maintainers' preferences, docs first ──

test("create: someone else on the issue is a warning before any run starts; claim_ok starts anyway", async () => {
  const h = harness();
  const asked: unknown[] = [];
  h.deps.claims = async (repo, issue) => { asked.push([repo, issue]); return [{ by: "bob", kind: "assigned", url: "https://github.com/pallets/flask/issues/5" }]; };
  const res = await createLesson(post({ repo_url: "https://github.com/pallets/flask/issues/5" }), h.deps);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /bob is assigned/);
  assert.deepEqual(body.claimed, [{ by: "bob", kind: "assigned", url: "https://github.com/pallets/flask/issues/5" }]);
  assert.deepEqual(asked, [["pallets/flask", 5]]);
  assert.equal(h.started.length, 0, "no hidden run before the contributor decides");
  await newLesson(h, { repo_url: "https://github.com/pallets/flask/issues/5", claim_ok: true });
  assert.equal(h.started.length, 1);
  assert.equal(asked.length, 1, "claim_ok skips the check");
});

test("create: a free issue starts at once; a failed check asks the contributor to look first", async () => {
  const free = harness();
  free.deps.claims = async () => [];
  await newLesson(free);
  const failing = harness();
  failing.deps.claims = async () => { throw new GitHubApiError("GitHub request failed (502).", 502); };
  const res = await createLesson(post({ repo_url: "https://github.com/pallets/flask/issues/5" }), failing.deps);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Couldn't check whether someone else/);
  assert.equal(failing.started.length, 0);
  assert.match(failing.logs.join("\n"), /claim check failed/);
  const broken = harness();
  broken.deps.claims = async () => { throw new RangeError("a bug"); };
  await assert.rejects(createLesson(post({ repo_url: "https://github.com/pallets/flask/issues/5" }), broken.deps), RangeError, "only GitHub failures are softened");
});

const s4Done = { step: "s4" as const, answer: "When a view redirects, the session cookie is not sent, so users are logged out. Reproduce with a login view that redirects.", grade: { passed: true, feedback: "ok" }, done: true, hint_level: -1, hints_used: [], updated_at: "t" };

test("claim: a draft from the contributor's s4, mentions defused, one turn, without the answer key", async () => {
  const h = harness({ replies: ["I'd like to work on this, @team. My plan: reproduce it with a redirecting login view, then add a test."] });
  const id = await newLesson(h);
  const early = await draftClaim(post({}), id, h.deps);
  assert.equal(early.status, 409, "needs s4 first");
  assert.equal(h.sent.length, 0);
  await h.store.saveStep(id, s4Done);
  const res = await draftClaim(post({}), id, h.deps);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.draft, /^I'd like to work on this, @\u200bteam\./);
  assert.match(body.draft, /<sub>Drafted with help/);
  assert.equal(body.issue_url, "https://github.com/pallets/flask/issues/5");
  assert.equal(h.sent.length, 1);
  const sent = JSON.stringify(h.sent[0]);
  assert.match(sent, /session cookie is not sent/);
  assert.doesNotMatch(sent, /is_redirect|redirects skip the cookie/, "the answer key never reaches the drafter");
  assert.equal((await h.store.get(id))!.turns_used, 1);
});

test("claim: no teacher, an empty draft, or a draft that echoes the fix is refused", async () => {
  const none = harness({ runtime: false });
  const a = await newLesson(none);
  await none.store.saveStep(a, s4Done);
  assert.equal((await draftClaim(post({}), a, none.deps)).status, 409);
  const empty = harness({ replies: ["   "] });
  const b = await newLesson(empty);
  await empty.store.saveStep(b, s4Done);
  const res = await draftClaim(post({}), b, empty.deps);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /empty/);
  const leaky = harness({ replies: ["I'll set is_redirect = 300 <= response.status_code < 400 in save_session."] });
  const c = await newLesson(leaky);
  await leaky.store.saveStep(c, s4Done);
  const leaked = await draftClaim(post({}), c, leaky.deps);
  assert.equal(leaked.status, 502);
  assert.doesNotMatch(await leaked.text(), /is_redirect/);
});

test("prefs: the card's lines for the lesson's repo; a failed read is a 503; off without the dep", async () => {
  const h = harness();
  const id = await newLesson(h);
  assert.equal((await lessonPrefs(id, h.deps)).status, 404, "no prefs dep");
  h.deps.prefs = async (repo) => summarizePrefs(repo, [], true);
  const body = await (await lessonPrefs(id, h.deps)).json();
  assert.deepEqual(body, { repo: "pallets/flask", sample: 0, lines: [] });
  h.deps.prefs = async (repo) => { throw new MaintainerPrefsFetchError(repo); };
  const failed = await lessonPrefs(id, h.deps);
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /Could not read pallets\/flask's recent merged pull requests/);
  h.deps.owner = async () => "auth0|mallory";
  assert.equal((await lessonPrefs(id, h.deps)).status, 404, "someone else's lesson");
});

test("get: the docs-first suggestion appears from s10 on, built from the kickoff questions", async () => {
  const h = harness();
  const lesson = await h.store.create({ owner: OWNER, repo_url: "https://github.com/pallets/flask", issue_number: 5, run_id: "c_1", mode: "short", path: "A", stage: "kickoff", answer_key: "verified" });
  await h.store.appendMessage(lesson.id, { role: "user", content: "Where is the dev server's config documented?", step: "s1", at: "t" });
  assert.equal((await (await getLesson(lesson.id, h.deps)).json()).docs_issue, undefined, "not before s10");
  await h.store.updateStage(lesson.id, "next");
  const body = await (await getLesson(lesson.id, h.deps)).json();
  assert.match(body.docs_issue.body, /While working on #5[\s\S]*- Where is the dev server's config documented\?/);
});
