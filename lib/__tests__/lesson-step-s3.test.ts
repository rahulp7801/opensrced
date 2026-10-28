import { test } from "node:test";
import assert from "node:assert/strict";
import { packageName, s3, topDependencies } from "../lesson/steps/s3";
import { StepInputError, type StepContext } from "../lesson/steps";
import type { GraphData } from "../graph";

// Six files import werkzeug, four jinja2, one click; the repo's own module does not count.
const ext = (id: string) => ({ id, label: id, community: 9, file_type: "module", source_file: "" });
const graph = {
  nodes: [ext("werkzeug.routing"), ext("werkzeug"), ext("jinja2"), ext("click"), ext("itsdangerous"), ext("blinker"), ext("markupsafe"),
    { id: "own", label: "flask.helpers", community: 1, file_type: "code", source_file: "src/flask/helpers.py" }],
  links: [
    ...Array.from({ length: 3 }, () => ({ source: "f", target: "werkzeug.routing", relation: "imports_from" })),
    ...Array.from({ length: 3 }, () => ({ source: "f", target: "werkzeug", relation: "imports" })),
    ...Array.from({ length: 4 }, () => ({ source: "f", target: "jinja2", relation: "imports" })),
    ...Array.from({ length: 9 }, () => ({ source: "f", target: "own", relation: "imports" })),
    { source: "f", target: "click", relation: "imports" }, { source: "f", target: "itsdangerous", relation: "imports" },
    { source: "f", target: "blinker", relation: "imports" }, { source: "f", target: "markupsafe", relation: "calls" },
  ],
} as unknown as GraphData;
const ctx: StepContext = { repo: "pallets/flask", issue: { number: 1, title: "", body: "" }, readme: "", graph, answerKey: null, answerKeyStatus: "pending" };

test("dependencies are ranked by import edges, external packages only", () => {
  assert.deepEqual(topDependencies(graph), ["werkzeug", "jinja2", "blinker", "click", "itsdangerous"]);
  assert.deepEqual(topDependencies(null), []);
  assert.equal(packageName("@scope/pkg/sub"), "@scope/pkg");
  assert.equal(packageName("Django.db.models"), "django");
});

test("s3 reads one pick per line, with its link", () => {
  assert.deepEqual(s3.parseAnswer("Werkzeug — https://werkzeug.palletsprojects.com/\n- jinja2: https://jinja.palletsprojects.com."), [
    { name: "Werkzeug", url: "https://werkzeug.palletsprojects.com/" }, { name: "jinja2", url: "https://jinja.palletsprojects.com" },
  ]);
  for (const bad of ["just one", "", "a\nb\nc\nd", 5]) assert.throws(() => s3.parseAnswer(bad), StepInputError, String(bad));
});

test("s3 passes with one of the top five and a link each, without a model", () => {
  const pass = s3.grade(ctx, s3.parseAnswer("werkzeug https://werkzeug.palletsprojects.com\nrequests https://requests.readthedocs.io"));
  assert.equal(pass?.passed, true);
  const noLink = s3.grade(ctx, s3.parseAnswer("werkzeug https://werkzeug.palletsprojects.com\njinja2"));
  assert.equal(noLink?.passed, false);
  assert.match(noLink!.feedback, /Add a link to learn jinja2/);
  const miss = s3.grade(ctx, s3.parseAnswer("numpy https://numpy.org\npandas https://pandas.pydata.org"));
  assert.equal(miss?.passed, false);
  assert.match(miss!.feedback, /werkzeug, jinja2/);
  assert.equal(s3.grade({ ...ctx, graph: null }, s3.parseAnswer("numpy https://numpy.org\npandas https://pandas.pydata.org"))?.passed, true, "no graph: the links decide");
});
