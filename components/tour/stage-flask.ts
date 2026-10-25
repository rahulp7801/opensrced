// The stage's story, told on pallets/flask end to end: the issue the scan picks, the
// render_template code the map traces, and the run that fixes it. Demo data for the stage
// only; the product tour (/demo) keeps its own run on the demo repository (data.ts).

export const FLASK_REPO = "pallets/flask";

export const FLASK_ISSUE = { number: 5912, title: "Values passed to render_template are overridden by context processors" };

export const FLASK_RUN = {
  id: "c_1793041188204_7f3a2c9e41b0",
  pr: 5914,
  head: "rahulp7801:opensrcer/issue-5912-7f3a2c9e41b0",
  base: "main",
  prTitle: "Keep values passed to render_template over context processors",
};

export const FLASK_DIAGNOSIS =
  "`_render` in `src/flask/templating.py` calls `app.update_template_context(context)`, which merges every context processor's values into the context. A processor that returns `name` replaced the `name` passed to `render_template`, though the docs say passed values take priority.";

export const FLASK_RISK = [
  "The change is in `_render`, which both `render_template` and `render_template_string` go through, so every templated view gets it. Passed values were always documented to win.",
  "Two new tests in `tests/test_templating.py`: a passed value beats a context processor, and a processor still fills a value you didn't pass. The template and signal tests pass (72).",
  "`stream_template` builds its context separately and isn't covered by this change.",
];

export const FLASK_PATCH_STATS = { files: 3, additions: 27, deletions: 0 };

/** The pull request description, as GitHub renders it. `spot` names what the stage can spotlight. */
export const FLASK_PR_BODY: Array<{ heading?: string; text: string; spot?: string }> = [
  { heading: "Summary", text: "Values passed to `render_template` were replaced by context processors that return the same key, contradicting the documented priority." },
  { heading: "Root cause", text: "`_render` in `src/flask/templating.py` merged the context processors' values in after the caller's, so the processors won." },
  { heading: "What changed", text: "- Copy the passed values before `update_template_context` runs, then put them back so they win.\n- `CHANGES.rst`: an entry under Unreleased, as the contributing guide asks." },
  { heading: "Tests", text: "Added two tests in `tests/test_templating.py`: a passed value beats a context processor, and a processor still fills a value that wasn't passed." },
  { text: "fixes #5912" },
  { heading: "Tests run", text: "- `python -m pytest tests/test_templating.py tests/test_signals.py` — 72 passed\n- Regression check: with the source change reverted (tests kept) the new test fails; with it, all pass." },
  { text: "Result: verified (declared tests pass, and fail with the source change reverted).", spot: "pr-verified" },
  { heading: "AI assistance", text: "This change was drafted with opensrcer, an AI coding tool, at the request of the PR author, who reviewed the diff and the test evidence before opening this PR and is responsible for it.\n- Model: claude-sonnet-5 (Anthropic), driven through Claude Code with repository-scoped tools.\n- Verification: The tool re-ran the commands under \"Tests run\" on the final patch: they pass, and the new test fails without the fix.", spot: "pr-ai" },
];
