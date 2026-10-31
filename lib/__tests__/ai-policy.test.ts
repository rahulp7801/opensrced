// Repository AI policies: hand-written fixtures modelled on real projects'
// guides (no live fetches), the GraphQL read through a fake fetch, and the cache.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { gh } from "../gh";
import {
  AI_POLICY_FILES, AI_POLICY_TTL_MS, AiPolicyFetchError, aiPolicyBanReason, classifyRepoAiPolicy, clearAiPolicyCache,
  fetchAiPolicy, InvalidRepoNameError, repoAiPolicy, type AiPolicyStance,
} from "../ai-policy";

// Modelled on real policies; wording shortened, structure kept.
const FIXTURES: Array<{ name: string; text: string; stance: AiPolicyStance; evidence?: RegExp }> = [
  { name: "Gentoo-style outright ban", stance: "banned", evidence: /^It is expressly forbidden/,
    text: "# Contributing\n\n## AI policy\n\nIt is expressly forbidden to contribute to this project any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.\n" },
  { name: "QEMU-style decline", stance: "banned", evidence: /will decline any contribution/,
    text: "Use of AI content generators\n\nThe project requires that contributors refrain from using AI content generators on patches intended for the project, and will decline any contribution if use of AI is either known or suspected.\n" },
  { name: "Zig-style one-liner", stance: "banned", evidence: /No LLMs/,
    text: "## Strict no LLM / no AI policy\n\nNo LLMs for issues, pull requests, or comments on the bug tracker.\n" },
  { name: "Pallets-style closed on sight", stance: "banned",
    text: "AI-generated PRs and issues are closed on sight, without review or discussion." },
  { name: "Ghostty-style must disclose", stance: "disclosure-required", evidence: /must be disclosed/,
    text: "## AI Assistance Notice\n\nIf you are using any kind of AI assistance to contribute, it must be disclosed in the pull request, along with the extent of the assistance.\n" },
  { name: "curl-style disclose if used", stance: "disclosure-required",
    text: "If you use AI tools when you contribute to this project, you must disclose that fact in the pull request." },
  { name: "AI-assisted is fine if you understand it", stance: "allowed", evidence: /are fine/,
    text: "AI-assisted pull requests are fine, as long as you understand and can explain every change you submit." },
  { name: "LLVM-style contributors may use", stance: "allowed",
    text: "Contributors may use AI tools to help write their patches, but they are responsible for every line." },
  { name: "Pydantic-style welcome", stance: "allowed",
    text: "We welcome the use of AI when contributing to Pydantic. However, users should certify that they fully understand the code being submitted." },
  { name: "silence", stance: "unknown",
    text: "# Contributing\n\nFork the repo, create a branch, add tests, and open a pull request. We use a CLA bot." },
  { name: "silence that mentions Copilot", stance: "unknown",
    text: "We run Copilot code review on every PR; do not take its comments as final. Force pushes are fine before review." },
  { name: "silence that says forbidden about something else", stance: "unknown",
    text: "Force pushes to main are forbidden. Rebase your branch instead." },
];

test("classifyRepoAiPolicy: real-policy fixtures, one file each", () => {
  for (const f of FIXTURES) {
    const policy = classifyRepoAiPolicy([{ path: "CONTRIBUTING.md", text: f.text }]);
    assert.equal(policy.stance, f.stance, f.name);
    if (f.stance === "unknown") assert.deepEqual(policy, { stance: "unknown", source: null, evidence: null }, f.name);
    else assert.equal(policy.source, "CONTRIBUTING.md", f.name);
    if (f.evidence) assert.match(policy.evidence ?? "", f.evidence, f.name);
  }
});

test("classifyRepoAiPolicy: the strictest file wins, whatever the order", () => {
  const allowed = { path: "CONTRIBUTING.md", text: FIXTURES.find((f) => f.stance === "allowed")!.text };
  const banned = { path: "AI_POLICY.md", text: FIXTURES[0].text };
  const disclose = { path: ".github/CONTRIBUTING.md", text: FIXTURES.find((f) => f.stance === "disclosure-required")!.text };
  for (const files of [[allowed, banned, disclose], [banned, disclose, allowed], [disclose, allowed, banned]]) {
    assert.equal(classifyRepoAiPolicy(files).source, "AI_POLICY.md");
  }
  assert.equal(classifyRepoAiPolicy([allowed, disclose]).stance, "disclosure-required");
  assert.deepEqual(classifyRepoAiPolicy([]), { stance: "unknown", source: null, evidence: null });
  assert.equal(classifyRepoAiPolicy([{ path: "AI.md", text: "" }]).stance, "unknown");
});

test("AI_POLICY_FILES covers the guides in root, .github and docs, and AI policy files", () => {
  for (const f of ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "AI_POLICY.md", "AI.md", ".github/AI_POLICY.md"]) {
    assert.ok(AI_POLICY_FILES.includes(f), f);
  }
  assert.equal(new Set(AI_POLICY_FILES).size, AI_POLICY_FILES.length);
});

test("aiPolicyBanReason quotes the policy for a ban only", () => {
  const reason = aiPolicyBanReason({ stance: "banned", source: "AI.md", evidence: "No LLMs for pull requests." });
  assert.equal(reason, 'this project does not accept AI-generated contributions (AI.md: "No LLMs for pull requests.")');
  for (const stance of ["disclosure-required", "allowed", "unknown"] as const) {
    assert.equal(aiPolicyBanReason({ stance, source: null, evidence: null }), null, stance);
  }
});

/** GitHub GraphQL answering with the given files (by path), counting calls. */
function fakeGitHub(files: Record<string, string> | "missing" | "error") {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(request);
    if (files === "error") return new Response("{\"message\":\"Bad credentials\"}", { status: 401, headers: { "content-type": "application/json" } });
    const repository = files === "missing" ? null
      : Object.fromEntries(AI_POLICY_FILES.map((path, i) => [`f${i}`, path in files ? { text: files[path] } : null]));
    return new Response(JSON.stringify({ data: { repository } }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { client: gh(`t-${Math.random()}`, { fetch }), calls };
}

beforeEach(() => clearAiPolicyCache());

test("fetchAiPolicy: one GraphQL call over every policy file, classified", async () => {
  const github = fakeGitHub({ "docs/CONTRIBUTING.md": "Hello.", "AI.md": "", ".github/AI.md": FIXTURES[2].text });
  const policy = await fetchAiPolicy(github.client, "ziglang/zig");
  assert.equal(policy.stance, "banned");
  assert.equal(policy.source, ".github/AI.md");
  assert.equal(github.calls.length, 1);
  assert.deepEqual(github.calls[0].variables, { owner: "ziglang", name: "zig" });
  for (const f of AI_POLICY_FILES) assert.ok(github.calls[0].query.includes(JSON.stringify(`HEAD:${f}`)), f);
});

test("fetchAiPolicy: failures are named errors, never a silent unknown", async () => {
  await assert.rejects(fetchAiPolicy(fakeGitHub("missing").client, "a/b"), AiPolicyFetchError);
  await assert.rejects(fetchAiPolicy(fakeGitHub("error").client, "a/b"), AiPolicyFetchError);
  for (const bad of ["", "a", "a/b/c", "../x", "a/..", "a b/c"]) {
    const github = fakeGitHub({});
    await assert.rejects(fetchAiPolicy(github.client, bad), InvalidRepoNameError, bad);
    assert.equal(github.calls.length, 0, bad);
  }
});

test("repoAiPolicy: cached per repository (case-insensitive) until the TTL passes", async () => {
  const github = fakeGitHub({ "CONTRIBUTING.md": FIXTURES[4].text });
  const now = 1_800_000_000_000;
  assert.equal((await repoAiPolicy(github.client, "ghostty-org/ghostty", now)).stance, "disclosure-required");
  await repoAiPolicy(github.client, "Ghostty-Org/Ghostty", now + AI_POLICY_TTL_MS - 1);
  assert.equal(github.calls.length, 1);
  await repoAiPolicy(github.client, "ghostty-org/ghostty", now + AI_POLICY_TTL_MS);
  assert.equal(github.calls.length, 2);
  // A failed read is not cached.
  const failing = fakeGitHub("error");
  await assert.rejects(repoAiPolicy(failing.client, "x/y", now), AiPolicyFetchError);
  await assert.rejects(repoAiPolicy(failing.client, "x/y", now), AiPolicyFetchError);
  assert.equal(failing.calls.length, 2);
});
