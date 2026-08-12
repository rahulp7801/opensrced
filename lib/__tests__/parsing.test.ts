// The regex-heavy pure functions, which is where a silent break costs a
// bad PR on somebody else's repo.
//
//   node --test           (Node 24 strips types natively — no framework)
//
// Deliberately not a suite per function. These are the five places where
// the code parses text it did not write: LLM output, dispatch logs, and
// issue prose. Everything else in the app is I/O around them.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, describe } from "node:test";

import { extractFirstDiff, buildPrContent, parseGeminiVerdict } from "../agentic-pr";
import { normalizeDiff, diffTouchedFiles, applyDiff } from "../apply-diff";
import { gitAuthArgs } from "../git-auth";
import { classifyScope } from "../scope";
import {
  enrichWithPrStatus,
  isValidDispatchId,
  ownsDispatch,
  type Dispatch,
} from "../dispatcher";
import { sanitizeFilePath, sanitizeGitHubName } from "../sanitize";

const SAMPLE_DIFF = `--- a/src/util.ts
+++ b/src/util.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
`;

describe("extractFirstDiff", () => {
  test("pulls a ```diff fenced block", () => {
    const log = `blah\n\n\`\`\`diff\n${SAMPLE_DIFF}\`\`\`\n\nmore`;
    assert.equal(extractFirstDiff(log), SAMPLE_DIFF);
  });

  test("accepts ```patch and bare ``` fences", () => {
    for (const fence of ["patch", ""]) {
      const log = `\`\`\`${fence}\n${SAMPLE_DIFF}\`\`\``;
      assert.equal(extractFirstDiff(log), SAMPLE_DIFF, `fence=${fence || "(bare)"}`);
    }
  });

  test("always returns a trailing newline (git apply rejects input without one)", () => {
    const noNewline = SAMPLE_DIFF.trimEnd();
    const got = extractFirstDiff(`\`\`\`diff\n${noNewline}\n\`\`\``);
    assert.ok(got?.endsWith("\n"));
  });

  test("skips fenced blocks that are not diffs", () => {
    const log = "```js\nconst x = 1;\n```\n" + "```diff\n" + SAMPLE_DIFF + "```";
    assert.equal(extractFirstDiff(log), SAMPLE_DIFF);
  });

  test("returns null when there is no diff", () => {
    assert.equal(extractFirstDiff("I could not find the bug.\n"), null);
    // +++ without --- is not a diff
    assert.equal(extractFirstDiff("```diff\n+++ b/x.ts\n+foo\n```"), null);
  });

  test("handles /dev/null (new file) headers", () => {
    const newFile = "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+export const x = 1;\n";
    assert.equal(extractFirstDiff("```diff\n" + newFile + "```"), newFile);
  });
});

describe("buildPrContent", () => {
  test("prefers the model's explicit PR title/body sections", () => {
    const log = [
      "## Diagnosis",
      "The parser drops the last token.",
      "",
      "## PR title",
      "fix: keep the final token when the buffer is empty",
      "",
      "## PR body",
      "This restores the trailing token. It was lost because the flush ran before the append. Fixes #42",
    ].join("\n");
    const { title, body } = buildPrContent(42, "d_x", log, SAMPLE_DIFF);
    assert.equal(title, "fix: keep the final token when the buffer is empty");
    assert.match(body, /restores the trailing token/);
  });

  test("injects a close keyword when the body omits one", () => {
    const log = [
      "## PR body",
      "A sufficiently long body that clears the forty character minimum for section reuse.",
    ].join("\n");
    const { body } = buildPrContent(7, "d_x", log, SAMPLE_DIFF);
    assert.match(body, /Fixes #7/);
  });

  test("does not double up an existing close keyword", () => {
    const log = [
      "## PR body",
      "Closes #7 — a sufficiently long body that clears the forty character minimum.",
    ].join("\n");
    const { body } = buildPrContent(7, "d_x", log, SAMPLE_DIFF);
    assert.equal(body.match(/#7/g)?.length, 1);
  });

  test("truncates a runaway title at a sentence boundary", () => {
    const runaway =
      "fix: the parser drops tokens. " + "And then a great deal more prose that should not be here at all, ".repeat(3);
    const { title } = buildPrContent(1, "d_x", `## PR title\n${runaway}`, SAMPLE_DIFF);
    assert.ok(title.length <= 90, `title was ${title.length} chars`);
    assert.equal(title, "fix: the parser drops tokens.");
  });

  test("synthesizes a body from other sections when PR body is missing", () => {
    const log = "## Diagnosis\nOff-by-one in the loop bound.\n\n## Risk / Test\nRan the unit suite.";
    const { body } = buildPrContent(9, "d_x", log, SAMPLE_DIFF);
    assert.match(body, /Fixes #9/);
    assert.match(body, /Off-by-one/);
    assert.match(body, /src\/util\.ts/); // files-changed list
    assert.match(body, /Ran the unit suite/);
  });

  test("falls back cleanly for a finding (issue number 0)", () => {
    const { title, body } = buildPrContent(0, "d_x", "no sections here", SAMPLE_DIFF);
    assert.equal(title, "fix: remediate security vulnerability");
    assert.doesNotMatch(body, /#0/); // never emit "Fixes #0"
  });
});

describe("parseGeminiVerdict", () => {
  test("reads the trailing verdict line", () => {
    assert.equal(parseGeminiVerdict("- looks fine\n\nVERDICT: clean"), "clean");
    assert.equal(parseGeminiVerdict("VERDICT: critical\n"), "critical");
    assert.equal(parseGeminiVerdict("- eh\nverdict:   concerns  "), "concerns");
  });

  test("defaults to concerns when the line is missing or malformed", () => {
    // Neither silently clean nor PR-blocking — the safe middle.
    assert.equal(parseGeminiVerdict("the patch is fine, ship it"), "concerns");
    assert.equal(parseGeminiVerdict("VERDICT: looks-good"), "concerns");
  });

  test("does not match the word inside prose", () => {
    assert.equal(parseGeminiVerdict("my VERDICT: clean would be premature here"), "concerns");
  });
});

describe("normalizeDiff / diffTouchedFiles", () => {
  test("adds missing a/ b/ prefixes", () => {
    const out = normalizeDiff("--- src/x.ts\n+++ src/x.ts\n@@ -1 +1 @@\n-a\n+b\n");
    assert.match(out, /^--- a\/src\/x\.ts$/m);
    assert.match(out, /^\+\+\+ b\/src\/x\.ts$/m);
  });

  test("leaves correct prefixes alone and forces a trailing newline", () => {
    const out = normalizeDiff(SAMPLE_DIFF.trimEnd());
    assert.match(out, /^--- a\/src\/util\.ts$/m);
    assert.ok(out.endsWith("\n"));
  });

  test("lists touched files and ignores /dev/null", () => {
    const diff = "--- a/x.ts\n+++ b/x.ts\n--- a/y.ts\n+++ /dev/null\n";
    assert.deepEqual(diffTouchedFiles(diff), ["x.ts"]);
  });
});

describe("gitAuthArgs", () => {
  test("returns nothing without a token", () => {
    assert.deepEqual(gitAuthArgs(undefined), []);
    assert.deepEqual(gitAuthArgs(null), []);
    assert.deepEqual(gitAuthArgs(""), []);
  });

  test("builds a one-shot basic auth header and never a URL", () => {
    const args = gitAuthArgs("ghs_secret");
    assert.equal(args[0], "-c");
    assert.match(args[1], /^http\.extraheader=AUTHORIZATION: basic /);
    const b64 = args[1].split("basic ")[1];
    assert.equal(Buffer.from(b64, "base64").toString(), "x-access-token:ghs_secret");
    // The token must never appear verbatim — that is the whole point.
    assert.ok(!args.join(" ").includes("ghs_secret"));
  });
});

describe("classifyScope", () => {
  test("buckets a README-only issue as doc", () => {
    const s = classifyScope("Typo in README.md", "The install section says `npm nistall`.");
    assert.equal(s.bucket, "doc");
  });

  test("buckets a single source file as leaf", () => {
    const s = classifyScope("Crash in src/parser.ts", "`src/parser.ts` throws on empty input.");
    assert.equal(s.bucket, "leaf");
    assert.ok(s.files.includes("src/parser.ts"));
  });

  test("recognizes a repo-wide refactor", () => {
    const s = classifyScope(
      "Rename Foo to Bar across the codebase",
      "We should rename `Foo` in every caller and update all usages.",
    );
    assert.equal(s.bucket, "refactor");
  });

  test("returns unknown with no signal rather than guessing", () => {
    const s = classifyScope("It doesn't work", "please fix");
    assert.equal(s.bucket, "unknown");
  });

  test("always reports a reason", () => {
    for (const [t, b] of [["Typo in README.md", "x"], ["It doesn't work", "y"]]) {
      assert.ok(classifyScope(t, b).reason.length > 0);
    }
  });
});

describe("enrichWithPrStatus", () => {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-enrich-"));

  function withLog(text: string): Dispatch {
    const p = join(dir, `log-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(p, text);
    return {
      id: "d_test",
      repo_url: "https://github.com/o/n",
      mode: "agentic",
      dry_run: true,
      started_at: new Date(0).toISOString(),
      status: "succeeded",
      log_path: p,
    };
  }

  test("an opened PR wins over every other marker", () => {
    // A crucible run that passed tests AND opened a PR shows both.
    const d = enrichWithPrStatus(
      withLog("[crucible-tests] status=passed\nopened draft PR: https://github.com/o/n/pull/12\n"),
    );
    assert.equal(d.pr_status, "opened");
    assert.equal(d.tests, "passed");
  });

  test("gitleaks outranks a test failure", () => {
    const d = enrichWithPrStatus(
      withLog("[gitleaks] status=leaks_found\n[gitleaks] findings=3\n[crucible-tests] status=failed\n"),
    );
    assert.equal(d.pr_status, "failed");
    assert.match(d.pr_failure_reason ?? "", /3 secret/);
  });

  test("test failure blocks and captures the reason", () => {
    const d = enrichWithPrStatus(
      withLog("[crucible-tests] status=failed\n[crucible-tests] reason=npm test exited 1\n"),
    );
    assert.equal(d.pr_status, "tests_failed");
    assert.equal(d.pr_failure_reason, "npm test exited 1");
    assert.equal(d.tests, "failed");
  });

  test("records not_run so an unverified PR cannot look verified", () => {
    const d = enrichWithPrStatus(
      withLog("[crucible-tests] status=not_run reason=OPENSRCER_RUN_TESTS=crucible (public flow)\n"),
    );
    assert.equal(d.tests, "not_run");
  });

  test("captures a multi-line skip reason", () => {
    const d = enrichWithPrStatus(
      withLog("[agentic-pr] skipped: diff did not apply\n  via any strategy\n"),
    );
    assert.equal(d.pr_status, "failed");
    assert.match(d.pr_failure_reason ?? "", /diff did not apply/);
  });

  test("auto-PR started but unresolved reads as pending", () => {
    const d = enrichWithPrStatus(withLog("[agentic-pr] starting auto-PR at 2026-01-01\n"));
    assert.equal(d.pr_status, "pending");
  });

  test("never touches a running dispatch", () => {
    const d = { ...withLog("[agentic-pr] skipped: nope\n"), status: "running" as const };
    assert.equal(enrichWithPrStatus(d).pr_status, undefined);
  });
});

describe("applyDiff", () => {
  // A real git repo — the ladder shells out to git and GNU patch, so a
  // mock would test nothing that matters.
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "opensrcer-apply-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/util.ts"), "const a = 1;\nconst b = 2;\nconst c = 4;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    return dir;
  }

  test("tier 1: a clean diff applies strictly and stages the file", async () => {
    const dir = repo();
    const res = await applyDiff(dir, SAMPLE_DIFF, join(dir, "..", "p1.patch"));
    assert.ok(res.ok, `expected apply to succeed: ${!res.ok ? res.errors.join(" | ") : ""}`);
    assert.match(readFileSync(join(dir, "src/util.ts"), "utf8"), /const b = 3;/);
    // --index means the change is staged and ready to commit.
    const staged = execFileSync("git", ["-C", dir, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    });
    assert.match(staged, /src\/util\.ts/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("recovers from a wrong hunk header line number", async () => {
    const dir = repo();
    // @@ claims line 40; the content is really at line 2. git apply alone
    // refuses this; GNU patch --fuzz slides it into place.
    const drifted = SAMPLE_DIFF.replace("@@ -1,3 +1,3 @@", "@@ -40,3 +40,3 @@");
    const res = await applyDiff(dir, drifted, join(dir, "..", "p2.patch"));
    assert.ok(res.ok, `expected a fallback tier to apply: ${!res.ok ? res.errors.join(" | ") : ""}`);
    assert.match(readFileSync(join(dir, "src/util.ts"), "utf8"), /const b = 3;/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("normalizes missing a/ b/ prefixes before applying", async () => {
    const dir = repo();
    const bare = SAMPLE_DIFF.replace("--- a/", "--- ").replace("+++ b/", "+++ ");
    const res = await applyDiff(dir, bare, join(dir, "..", "p3.patch"));
    assert.ok(res.ok, `expected normalization to rescue it: ${!res.ok ? res.errors.join(" | ") : ""}`);
    rmSync(dir, { recursive: true, force: true });
  });

  test("reports every tier's error when the diff is unusable", async () => {
    const dir = repo();
    const nonsense = "--- a/src/util.ts\n+++ b/src/util.ts\n@@ -1,2 +1,2 @@\n-this line does not exist anywhere\n+replacement\n";
    const res = await applyDiff(dir, nonsense, join(dir, "..", "p4.patch"));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.ok(res.errors.length >= 3, `expected several tiers to be tried, got ${res.errors.length}`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips the 3-way tiers when deepen is unavailable", async () => {
    const dir = repo();
    let deepenCalls = 0;
    const nonsense = "--- a/src/util.ts\n+++ b/src/util.ts\n@@ -1,2 +1,2 @@\n-absent\n+present\n";
    await applyDiff(dir, nonsense, join(dir, "..", "p5.patch"), {
      deepen: async () => {
        deepenCalls++;
        return false;
      },
    });
    // Called at most once even though two tiers want three-way.
    assert.equal(deepenCalls, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── Security boundaries ───────────────────────────────────────────────
// These four are the checks that fail loudly if a fix for a real finding
// gets reverted or refactored away. They are here rather than in a separate
// file because they test the same pure functions this suite already covers.

describe("sanitizeFilePath", () => {
  test("accepts an ordinary repo-relative path", () => {
    assert.equal(sanitizeFilePath("src/lib/util.ts"), "src/lib/util.ts");
    assert.equal(sanitizeFilePath("./src/util.ts"), "src/util.ts");
    assert.equal(sanitizeFilePath(String.raw`src\win\path.ts`), "src/win/path.ts");
  });

  test("rejects traversal, including the strip-once bypass", () => {
    assert.equal(sanitizeFilePath("../../../etc/passwd"), null);
    // The old implementation removed the inner "../" and returned "../",
    // which is a traversal it had just been asked to prevent.
    assert.equal(sanitizeFilePath("....//etc/passwd"), null);
    assert.equal(sanitizeFilePath("src/../../secrets"), null);
  });

  test("rejects absolute paths on both platforms", () => {
    assert.equal(sanitizeFilePath("/etc/passwd"), null);
    assert.equal(sanitizeFilePath(String.raw`C:\Windows\win.ini`), null);
    // Drive-relative: no separator after the colon, still not repo-relative.
    assert.equal(sanitizeFilePath("C:Windows"), null);
    assert.equal(sanitizeFilePath(String.raw`\\host\share\f.txt`), null);
  });
});

describe("sanitizeGitHubName", () => {
  test("accepts real logins and repo names", () => {
    assert.equal(sanitizeGitHubName("torvalds"), "torvalds");
    assert.equal(sanitizeGitHubName("next.js"), "next.js");
    assert.equal(sanitizeGitHubName("some-repo_2"), "some-repo_2");
  });

  test("rejects anything that could reshape an API URL", () => {
    for (const bad of ["a/b", "..", "../org", "a?b", "a b", "a#b", ""]) {
      assert.equal(sanitizeGitHubName(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe("dispatch ownership", () => {
  const base: Dispatch = {
    id: "d_2026-01-01T00-00-00_abc123",
    repo_url: "https://github.com/o/r",
    mode: "agentic",
    dry_run: true,
    started_at: new Date(0).toISOString(),
    status: "succeeded",
    log_path: "/tmp/x.log",
  };

  test("only the owner sees their dispatch", () => {
    const mine = { ...base, auth0_user_id: "auth0|alice" };
    assert.equal(ownsDispatch(mine, "auth0|alice"), true);
    assert.equal(ownsDispatch(mine, "auth0|mallory"), false);
    assert.equal(ownsDispatch(mine, null), false);
  });

  test("an unowned legacy record is visible to nobody", () => {
    // Not "visible to everyone" — that is the leak the field exists for.
    assert.equal(ownsDispatch(base, "auth0|alice"), false);
  });

  test("only minted-shape ids reach the filesystem", () => {
    assert.equal(isValidDispatchId("d_2026-01-01T00-00-00_abc123"), true);
    for (const bad of ["../../package", "d_../x", "", "x_123", "d_" + "a".repeat(65)]) {
      assert.equal(isValidDispatchId(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe("applyDiff containment", () => {
  test("a diff aimed outside the worktree writes nothing outside it", async () => {
    const parent = mkdtempSync(join(tmpdir(), "opensrcer-escape-"));
    const dir = join(parent, "worktree");
    mkdirSync(dir);
    execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "pipe" });
    writeFileSync(join(dir, "keep.txt"), "inside\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "commit", "-qm", "init"], { stdio: "pipe" });

    // The target exists and the content matches, so the direct-edit tier
    // would happily rewrite it — if containment were not checked first.
    const outside = join(parent, "secret.txt");
    writeFileSync(outside, "ORIGINAL\n");

    const escaping = "--- a/../secret.txt\n+++ b/../secret.txt\n-ORIGINAL\n+PWNED\n";
    const res = await applyDiff(dir, escaping, join(parent, "escape.patch"));

    assert.equal(res.ok, false, "a patch pointing outside the worktree must not apply");
    assert.equal(readFileSync(outside, "utf8"), "ORIGINAL\n");
    rmSync(parent, { recursive: true, force: true });
  });
});
