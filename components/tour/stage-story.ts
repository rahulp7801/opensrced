// The stage's story, told on pydantic/pydantic end to end: the issue the scan picks, the
// to_pascal code the map traces, and the run that fixes it. Pydantic welcomes AI-assisted
// contributions from people who understand them (docs/contributing.md), which is what the run
// checks. Demo data for the stage only; the product tour (/demo) keeps its own run (data.ts).
//
// What is real: the repository's rules as lib/contrib-profile.ts reads them, the map, the
// Explore answer, and the fix and test results below, which were run against Pydantic's
// pydantic/alias_generators.py and its own alias-generator tests (tests/test_utils.py).
// The issue and pull request numbers are the demo's.

export const STORY_REPO = "pydantic/pydantic";

export const STORY_ISSUE = { number: 12471, title: "to_pascal keeps double underscores in the names it generates" };

export const STORY_RUN = {
  id: "c_1793124417306_3e91b7c25a40",
  pr: 12474,
  head: "rahulp7801:opensrcer/issue-12471-3e91b7c25a40",
  base: "main",
  prTitle: "Collapse repeated underscores in to_pascal",
};

/** What lib/contrib-profile.ts detectProfile reports for pydantic/pydantic. */
export const STORY_PROFILE = {
  sources: ["CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md", "docs/contributing.md"],
  aiPolicy: { stance: "welcome" as const, source: "docs/contributing.md", excerpt: "We welcome the use of AI when contributing to Pydantic." },
  templateHeadings: 3, // Change Summary, Related issue number, Checklist
};

export const STORY_DIAGNOSIS =
  "`to_pascal` in `pydantic/alias_generators.py` title-cases the name, then removes an underscore only when a letter or digit sits on both sides of it. In `my__field` each underscore has another underscore beside it, so both survive: `to_pascal('my__field')` returned `'My__Field'`.";

export const STORY_RISK = [
  "The change is in `to_pascal`, which `to_camel` also calls, so camelCase aliases get the same fix. Leading and trailing underscores are untouched: `__private` stays `__Private`.",
  "A new test in `tests/test_utils.py` covers `my__field`, `user___id` and `__private`; Pydantic's 42 existing alias-generator tests still pass (45 in all).",
  "`to_snake` is unchanged, so a round trip of a name with a double underscore isn't covered.",
];

/** The final patch, as the review and the proof show it. */
export const STORY_DIFF = {
  file: "pydantic/alias_generators.py",
  removed: "    camel = snake.title()",
  added: "    camel = re.sub(r'(?<=[0-9A-Za-z])_{2,}(?=[0-9A-Za-z])', '_', snake).title()",
  testFile: "tests/test_utils.py",
  test: [
    "@pytest.mark.parametrize('value,result', [",
    "    ('my__field', 'MyField'),",
    "    ('user___id', 'UserId'),",
    "    ('__private', '__Private'),",
    "])",
    "def test_to_pascal_repeated_underscores(value, result):",
    "    assert to_pascal(value) == result",
  ],
};

export const STORY_TEST_COMMAND = `pytest tests/test_utils.py -k "snake2camel_start_lower or snake2pascal or to_snake or to_pascal"`;

export const STORY_PATCH_STATS = { files: 2, additions: 12, deletions: 1 };

/** The pull request description: Pydantic's template headings, then what opensrcer adds. */
export const STORY_PR_BODY: Array<{ heading?: string; text: string; spot?: string }> = [
  { heading: "Change Summary", text: "`to_pascal` (and so `to_camel`) left double underscores in generated names: `to_pascal('my__field')` returned `'My__Field'`. Repeated underscores between letters or digits now collapse before title-casing, so it returns `'MyField'`; leading and trailing underscores are unchanged." },
  { heading: "Related issue number", text: "fix #12471" },
  { heading: "Checklist", text: "- [x] The pull request title is a good summary of the changes - it will be used in the changelog\n- [x] Unit tests for the changes exist\n- [ ] Tests pass on CI\n- [ ] Documentation reflects the changes where applicable (no docs change)" },
  { heading: "Tests run", text: `- \`${STORY_TEST_COMMAND}\` — 45 passed\n- Regression check: with the source change reverted (tests kept) the new test fails (2 cases); with it, all pass.` },
  { text: "Result: verified (declared tests pass, and fail with the source change reverted).", spot: "pr-verified" },
  { heading: "AI assistance", text: "This change was drafted with opensrcer, an AI coding tool, at the request of the PR author, who reviewed the diff and the test evidence before opening this PR and is responsible for it.\n- Model: claude-sonnet-5 (Anthropic), driven through Claude Code with repository-scoped tools.\n- Verification: The tool re-ran the commands under \"Tests run\" on the final patch: they pass, and the new test fails without the fix.", spot: "pr-ai" },
];
