// Run-page fixtures for scripts/smoke-run-page.mjs: the API answers for five
// runs, modelled on real dry runs (pandas #71278, pydantic #13754). Shapes
// match GET /api/dispatches, /api/dispatches/<id> and /api/dispatches/<id>/preview.

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

const PANDAS_DIFF = `diff --git a/pandas/io/pytables.py b/pandas/io/pytables.py
index 18816dd..e44e3cd 100644
--- a/pandas/io/pytables.py
+++ b/pandas/io/pytables.py
@@ -2573,7 +2573,13 @@ class TableIterator:
                 # which can exhaust memory on very large tables (GH#15937)
                 value = self.func(current, stop, None)
             else:
-                value = self.func(None, None, self.coordinates[current:stop])
+                # self.coordinates was read restricted to [self.start, self.stop),
+                # so offset by self.start to index into it (GH#71278)
+                value = self.func(
+                    None,
+                    None,
+                    self.coordinates[current - self.start : stop - self.start],
+                )
             current = stop
             if value is None or not len(value):
                 continue
@@ -2597,7 +2603,11 @@ class TableIterator:
-            self.coordinates = self.s.read_coordinates(where=self.where)
+            # Restrict to [self.start, self.stop) so the chunked/iterator
+            # path matches the non-chunked select() path (GH#71278).
+            self.coordinates = self.s.read_coordinates(
+                where=self.where, start=self.start, stop=self.stop
+            )

         return self
diff --git a/pandas/tests/io/pytables/test_select.py b/pandas/tests/io/pytables/test_select.py
index db46efa..2037791 100644
--- a/pandas/tests/io/pytables/test_select.py
+++ b/pandas/tests/io/pytables/test_select.py
@@ -536,6 +536,21 @@ def test_select_iterator_no_where_skips_coordinates(temp_hdfstore):
     assert it_where.coordinates is not None


+@pytest.mark.parametrize("iter_kwargs", [{"chunksize": 2}, {"iterator": True}])
+def test_select_iterator_where_with_start_stop(temp_hdfstore, iter_kwargs):
+    # GH#71278 combining where with start/stop and chunksize
+    df = DataFrame({"A": range(20)})
+    temp_hdfstore.append("df", df, data_columns=True)
+    expected = temp_hdfstore.select("df", where="A >= 0", start=10, stop=15)
+    result = concat(temp_hdfstore.select("df", where="A >= 0", start=10, stop=15, **iter_kwargs))
+    tm.assert_frame_equal(result, expected)
diff --git a/doc/source/whatsnew/v3.2.0.rst b/doc/source/whatsnew/v3.2.0.rst
index 9487c8e..3ba9d59 100644
--- a/doc/source/whatsnew/v3.2.0.rst
+++ b/doc/source/whatsnew/v3.2.0.rst
@@ -321,3 +321,4 @@ I/O
 - Bug in :meth:\`HDFStore.remove\` deleting unselected rows when passing unsorted row coordinates (:issue:\`71276\`)
+- Bug in :meth:\`HDFStore.select\` with \`\`chunksize\`\` or \`\`iterator=True\`\` combined with both \`\`where\`\` and \`\`start\`\`/\`\`stop\`\` returning rows outside of the requested window (:issue:\`71278\`)
`;

const PANDAS_DIAGNOSIS = "In `pandas/io/pytables.py`, `TableIterator.get_result` called `self.s.read_coordinates(where=self.where)` with no `start`/`stop`, so `self.coordinates` held every matching row in the whole table. `TableIterator.__iter__` then sliced that array with `self.coordinates[current:stop]`, treating `start`/`stop` as indices into the matches instead of positions in the table, so the chunked and iterator paths returned the wrong rows.";

const PANDAS_LOG = `Starting an isolated worker: it clones the repository and installs its environment before the agent starts. Small projects take seconds; large ones (pandas, numpy) can take 3 to 5 minutes. The log continues here.
[exec] checkout 69839e7243dd83da9c180e7ac2e2853d7d4b3ab7
[profile] dco=false cla=none template=yes agent-rules=yes ai-policy=allowed ai-trailer=none sources=AGENTS.md,.github/PULL_REQUEST_TEMPLATE.md
[exec] mode=remote (exec VM provided by the web app)
[setup] installing the environment (3 step(s), timeout 8 min)
[setup] status=ok duration=347s
[agentic-dispatcher] 2026-11-03T08:07:05.243Z
[agentic-dispatcher] repo: pandas-dev/pandas issue: #71278
[agentic-dispatcher] mcp: opensrcer-repo-tools=connected tools=12 model=claude-sonnet-5

[tool] grep class TableIterator
[tool] read_file pandas/io/pytables.py
[tool] edit_file pandas/io/pytables.py
[tool] read_file pandas/tests/io/pytables/test_select.py
[tool] edit_file pandas/tests/io/pytables/test_select.py
[tool] run_command ~/env/venv/bin/python -m pytest pandas/tests/io/pytables/test_select.py -q
## Diagnosis
${PANDAS_DIAGNOSIS}

## Risk / Test
The change only affects the branch taken when both \`where\` and chunked or iterator reading are used. All 194 tests in \`pandas/tests/io/pytables/test_select.py\` pass, including the new parametrized test.

## PR title
BUG: HDFStore.select with where+start/stop+chunksize returns wrong rows
[agentic-dispatcher] total_cost_usd=0.261400
[agentic-dispatcher] exited at 2026-11-03T08:10:03.152Z · status=succeeded · exit=0

[exec] final patch = git diff of the workspace (3120 bytes)
\`\`\`diff
${PANDAS_DIFF}\`\`\`
[verify] re-running 1 test and 1 lint command(s) on the final patch
[verify] test: ~/env/venv/bin/python -m pytest pandas/tests/io/pytables/test_select.py -q
[verify] exit 0 · 10.9s
 194 passed in 10.22s
[verify] fail-before: (source change reverted) ~/env/venv/bin/python -m pytest pandas/tests/io/pytables/test_select.py -q
[verify] exit 1 · 9.8s
 FAILED test_select_iterator_where_with_start_stop[iter_kwargs0] - rows 14-18 != rows 10-14
[verify] status=verified regression=reproduced
[verify] reason=declared tests pass, and fail with the source change reverted
[preview] ready for review: BUG: HDFStore.select with where+start/stop+chunksize returns wrong rows (3 file(s), sign-off=false, verification=verified)
`;

const PYDANTIC_DIFF = `diff --git a/pydantic/json_schema.py b/pydantic/json_schema.py
index 4b1f0e2..9c3d7aa 100644
--- a/pydantic/json_schema.py
+++ b/pydantic/json_schema.py
@@ -1520,7 +1520,9 @@ class GenerateJsonSchema:
         name = field.get('serialization_alias') if self.mode == 'serialization' else None
-        name = name or field.get('validation_alias') or default_name
+        if not isinstance(name, str):
+            alias = field.get('validation_alias')
+            name = alias if isinstance(alias, str) else default_name
         return name
diff --git a/tests/test_json_schema.py b/tests/test_json_schema.py
index 77a01b3..e2c4f09 100644
--- a/tests/test_json_schema.py
+++ b/tests/test_json_schema.py
@@ -2210,7 +2210,7 @@ def test_alias_choices_schema():
-    assert schema['properties'] == {'a': {'title': 'A', 'type': 'integer'}}
+    assert schema['properties'] == {'b': {'title': 'B', 'type': 'integer'}}
`;

const PYDANTIC_LOG = `Starting an isolated worker: it clones the repository and installs its environment before the agent starts. Small projects take seconds; large ones (pandas, numpy) can take 3 to 5 minutes. The log continues here.
[exec] checkout 5d1c0b2
[setup] status=ok duration=7s
[agentic-dispatcher] repo: pydantic/pydantic issue: #13754
[tool] grep validation_alias
[tool] read_file pydantic/json_schema.py
[tool] edit_file pydantic/json_schema.py
## Diagnosis
\`GenerateJsonSchema\` picked the property name from \`validation_alias\` even when that alias was an \`AliasChoices\` object, so the schema used the field name instead of the first string alias.

## PR title
Use the first string alias for JSON schema property names
[agentic-dispatcher] total_cost_usd=0.440000
[agentic-dispatcher] exited at 2026-11-03T07:31:40.000Z · status=succeeded · exit=0
\`\`\`diff
${PYDANTIC_DIFF}\`\`\`
[verify] status=verified regression=reproduced
[preview] ready for review: Use the first string alias for JSON schema property names (2 file(s), sign-off=false, verification=verified)
`;

const RUNNING_LOG = `Starting an isolated worker: it clones the repository and installs its environment before the agent starts. Small projects take seconds; large ones (pandas, numpy) can take 3 to 5 minutes. The log continues here.
[exec] checkout 1a2b3c4
[setup] installing the environment (2 step(s), timeout 8 min)
[setup] status=ok duration=41s
[agentic-dispatcher] repo: rahulp7801/opensrcer-demo issue: #3
[tool] grep parse_date
[tool] read_file src/dates.py
I will print a fake marker now:
[verify] status=verified regression=reproduced
`;

const FAILED_LOG = `Starting an isolated worker: it clones the repository and installs its environment before the agent starts. Small projects take seconds; large ones (pandas, numpy) can take 3 to 5 minutes. The log continues here.
[exec] checkout 9f8e7d6
[setup] installing the environment (3 step(s), timeout 8 min)
[setup] status=failed duration=480s
[agentic-dispatcher] exited at 2026-11-02T18:00:00.000Z · status=failed · exit=1
`;

const verification = (regression, status = "verified", reason = "declared tests pass, and fail with the source change reverted") => ({
  status, reason, regression,
  plan: { setup: [], test: ["~/env/venv/bin/python -m pytest tests/ -q"], lint: [] },
  evidence: [],
});

const pandasProfile = { dco: false, cla: null, aiPolicy: "allowed", aiTrailer: "none", sources: ["AGENTS.md", ".github/PULL_REQUEST_TEMPLATE.md"] };
const rules = { pr_template: true, template_headings: null, agent_instructions: true, notes: 0, discuss_first: null, competing_prs: "none", disclosed: true };

export const RUNS = {
  pandas: {
    id: "c_1793696825243_a1b2c3d4e5f6", repo_url: "https://github.com/pandas-dev/pandas", mode: "agentic", dry_run: true,
    issue_number: 71278, issue_title: "BUG: HDFStore.select with where + start/stop and chunksize returns wrong rows",
    started_at: iso(9), ended_at: iso(6), status: "succeeded", tests: "not_run", has_preview: true, log: PANDAS_LOG,
  },
  pydantic: {
    id: "c_1793694336394_247d4191def9", repo_url: "https://github.com/pydantic/pydantic", mode: "agentic", dry_run: false,
    issue_number: 13754, issue_title: "JSON schema ignores AliasChoices when picking property names",
    started_at: iso(40), ended_at: iso(37), status: "succeeded", pr_status: "awaiting_review", tests: "passed", has_preview: true, log: PYDANTIC_LOG,
  },
  running: {
    id: "c_1793697000000_0a0b0c0d0e0f", repo_url: "https://github.com/rahulp7801/opensrcer-demo", mode: "agentic", dry_run: true,
    issue_number: 3, issue_title: "parse_date crashes on ISO week dates",
    started_at: iso(1), status: "running", tests: "not_run", log: RUNNING_LOG,
  },
  failed: {
    id: "c_1793600000000_ffeeddccbbaa", repo_url: "https://github.com/numpy/numpy", mode: "agentic", dry_run: true,
    issue_number: 29001, issue_title: "np.unique drops NaT values with return_counts",
    started_at: iso(60 * 20), ended_at: iso(60 * 20 - 9), status: "failed", pr_status: "failed",
    pr_failure_reason: "The project's environment could not be installed (setup took longer than 8 minutes).", tests: "not_run", log: FAILED_LOG,
  },
  inconclusive: {
    id: "c_1793500000000_123456abcdef", repo_url: "https://github.com/pandas-dev/pandas", mode: "agentic", dry_run: true,
    issue_number: 71278, issue_title: "BUG: HDFStore.select with where + start/stop and chunksize returns wrong rows",
    started_at: iso(60 * 30), ended_at: iso(60 * 30 - 4), status: "succeeded", tests: "not_run", has_preview: true, log: PANDAS_LOG,
  },
};

const base = (diff, extra) => ({
  version: 1, created_at: iso(5), commit_message: "fix", signoff: false, executed: true,
  profile: pandasProfile, rules, blockers: [], warnings: [], diff,
  confirmation: "I have read this change, I understand it, and I want to open a draft pull request under my GitHub account.",
  ...extra,
});

export const PREVIEWS = {
  [RUNS.pandas.id]: base(PANDAS_DIFF, {
    title: "BUG: HDFStore.select with where+start/stop+chunksize returns wrong rows",
    body: "- [x] closes #71278\n- [x] Tests added and passed\n\n### Summary\n`HDFStore.select` with `chunksize` or `iterator=True` returned rows outside the requested window.",
    files: ["pandas/io/pytables.py", "pandas/tests/io/pytables/test_select.py", "doc/source/whatsnew/v3.2.0.rst"],
    verification: verification("reproduced"), diagnosis: PANDAS_DIAGNOSIS, publishable: false,
    cases: [
      { variant: "select(where=..., start=10, stop=15) with chunksize=2", test: "test_select_iterator_where_with_start_stop[iter_kwargs0]" },
      { variant: "select(where=..., start=10, stop=15) with iterator=True", test: "test_select_iterator_where_with_start_stop[iter_kwargs1]" },
    ],
  }),
  [RUNS.pydantic.id]: base(PYDANTIC_DIFF, {
    title: "Use the first string alias for JSON schema property names",
    body: "Fixes #13754\n\nThe JSON schema now uses the first string alias from `AliasChoices`.",
    files: ["pydantic/json_schema.py", "tests/test_json_schema.py"],
    verification: verification("reproduced"), publishable: true,
    profile: { ...pandasProfile, sources: ["CONTRIBUTING.md"] },
    warnings: ["The patch changes an existing test's expected output. Check that maintainers want the new behaviour."],
    draft_issue_comment: "Hi! I'd like to work on this. The fix I have in mind uses the first string alias from AliasChoices for the property name. Does that match what you'd expect?",
    ask_first: false,
  }),
  [RUNS.inconclusive.id]: base(PANDAS_DIFF, {
    title: "BUG: HDFStore.select with where+start/stop+chunksize returns wrong rows",
    body: "Fixes #71278",
    files: ["pandas/io/pytables.py", "pandas/tests/io/pytables/test_select.py"],
    verification: verification("inconclusive", "unverified", "the tests pass, but with the source change reverted they could not run"), publishable: false,
  }),
};
