import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_EGRESS, EXEC_EGRESS, EXPLORE_EGRESS, SUBSCRIPTION_AGENT_EGRESS, agentEgressWithExec } from "../sandbox-egress";

const hosts = (policy: unknown) => (policy as { allow: string[] }).allow;

test("subscription runs add exactly Anthropic's sign-in hosts to the agent allowlist", () => {
  const added = hosts(SUBSCRIPTION_AGENT_EGRESS).filter((host) => !hosts(AGENT_EGRESS).includes(host));
  assert.deepEqual(added.sort(), ["claude.ai", "platform.claude.com"]);
  for (const host of hosts(AGENT_EGRESS)) assert.ok(hosts(SUBSCRIPTION_AGENT_EGRESS).includes(host), host);
});

test("API-key runs and exploration do not gain the sign-in hosts", () => {
  for (const policy of [AGENT_EGRESS, EXPLORE_EGRESS]) {
    assert.ok(!hosts(policy).includes("claude.ai"));
    assert.ok(!hosts(policy).includes("platform.claude.com"));
    assert.ok(!hosts(policy).some((host) => host === "*" || host.startsWith("*.claude")), "no wildcard Anthropic hosts");
  }
});

test("the exec VM reaches only package registries, runtime and image hosts, and git hosts (PLAN §5.6)", () => {
  const byEcosystem = {
    python: ["pypi.org", "files.pythonhosted.org", "download.pytorch.org"],
    js: ["registry.npmjs.org", "registry.yarnpkg.com"],
    git: ["github.com", "codeload.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"],
    rust: ["crates.io", "index.crates.io", "static.crates.io", "static.rust-lang.org"],
    go: ["proxy.golang.org", "sum.golang.org", "storage.googleapis.com", "go.dev", "dl.google.com"],
    ruby: ["rubygems.org", "index.rubygems.org"],
    jvm: ["repo.maven.apache.org", "repo1.maven.org", "plugins.gradle.org", "services.gradle.org", "downloads.gradle.org"],
    php: ["packagist.org", "repo.packagist.org"],
    conda: ["conda.anaconda.org", "repo.anaconda.com"],
    containers: ["registry-1.docker.io", "auth.docker.io", "production.cloudflare.docker.com", "ghcr.io", "pkg-containers.githubusercontent.com", "mcr.microsoft.com"],
    apt: ["archive.ubuntu.com", "security.ubuntu.com", "deb.debian.org"],
    runtimes: ["nodejs.org", "mise.jdx.dev"],
  };
  assert.deepEqual([...hosts(EXEC_EGRESS)].sort(), Object.values(byEcosystem).flat().sort());
  assert.equal(new Set(hosts(EXEC_EGRESS)).size, hosts(EXEC_EGRESS).length, "no duplicates");
  // Nothing that holds or accepts the run's credentials.
  for (const host of ["api.github.com", "api.anthropic.com", "vercel.com", "*.blob.vercel-storage.com", "generativelanguage.googleapis.com"]) {
    assert.ok(!hosts(EXEC_EGRESS).includes(host), host);
  }
  assert.ok(!hosts(EXEC_EGRESS).some((host) => host.includes("*")), "no wildcards");
});

test("an exec run's agent VM gains exactly its own exec VM host", () => {
  for (const base of [AGENT_EGRESS, SUBSCRIPTION_AGENT_EGRESS]) {
    const policy = agentEgressWithExec(base, "SB-5zdo739d092s.vercel.run");
    assert.deepEqual(hosts(policy), [...hosts(base), "sb-5zdo739d092s.vercel.run"]);
  }
  assert.ok(!hosts(AGENT_EGRESS).includes("sb-5zdo739d092s.vercel.run"), "the shared base list is not mutated");
});

test("agentEgressWithExec refuses wildcards, URLs and non-list policies", () => {
  for (const bad of ["*.vercel.run", "https://sb-x.vercel.run", "sb-x.vercel.run/path", "", "localhost"]) {
    assert.throws(() => agentEgressWithExec(AGENT_EGRESS, bad), RangeError, bad);
  }
  assert.throws(() => agentEgressWithExec("allow-all", "sb-x.vercel.run"), RangeError);
});
