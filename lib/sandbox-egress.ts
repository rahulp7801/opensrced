import type { NetworkPolicy } from "@vercel/sandbox";

// Egress allowlists for the worker VMs. Everything not listed is denied, so
// even a code-execution bug triggered by a hostile repository (in git, patch,
// a parser) cannot send the user's provider key or GitHub token anywhere but
// the services the job already talks to. The snapshot build keeps allow-all;
// it installs packages.
//
// Hosts come from what each job contacts: Claude Code -> api.anthropic.com
// (nonessential traffic disabled), clone/push -> github.com, REST ->
// api.github.com, run-record uploads -> vercel.com/api/blob and the Blob
// store, patch review -> Gemini.
const GITHUB = ["github.com", "api.github.com"];

const AGENT_HOSTS = ["api.anthropic.com", ...GITHUB, "vercel.com", "*.blob.vercel-storage.com", "generativelanguage.googleapis.com"];
export const AGENT_EGRESS: NetworkPolicy = { allow: AGENT_HOSTS };
// Hosted subscription runs sign in to Claude inside the VM. Measured with
// claude 2.1.269 behind a logging proxy: printing the sign-in URL contacts
// nothing, and the pasted code is exchanged at platform.claude.com, which also
// refreshes the token. claude.ai is Anthropic's documented "claude.ai account
// authentication" host (code.claude.com/docs/en/network-config); the
// browser-side hosts (claude.com, sso.claude.com) are the user's, not the VM's.
export const SUBSCRIPTION_AGENT_EGRESS: NetworkPolicy = {
  allow: [...AGENT_HOSTS, "platform.claude.com", "claude.ai"],
};
// OpenRouter-key runs: Claude Code talks to OpenRouter's Anthropic-compatible
// endpoint instead of api.anthropic.com.
export const OPENROUTER_AGENT_EGRESS: NetworkPolicy = { allow: [...AGENT_HOSTS, "openrouter.ai"] };
/** Agent VM of a hosted exec run: its usual hosts plus exactly one more, its
 *  own exec VM's public port route (`<id>.vercel.run`). The exact host, never
 *  a wildcard: other users' exec VMs share the suffix. */
export function agentEgressWithExec(base: NetworkPolicy, execHost: string): NetworkPolicy {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(execHost)) throw new RangeError("exec VM host must be a plain hostname");
  if (typeof base !== "object" || !Array.isArray(base.allow)) throw new RangeError("base policy must be a host allowlist");
  return { allow: [...base.allow, execHost.toLowerCase()] };
}

// The exec VM (OPENSRCER_HOSTED_EXEC) runs the target repository's code:
// installs, tests, linters. It holds no credential, so these hosts only bound
// what that code can download and where it can talk. Each is a package or
// source host that the setup recipes (lib/contrib-profile.ts) or the agent's
// own installs need:
//   pypi.org, files.pythonhosted.org   pip/uv index, wheel and sdist files
//   download.pytorch.org               CPU torch wheels (vllm, pytorch recipes)
//   registry.npmjs.org                 npm ci / npm install
//   registry.yarnpkg.com               yarn v1 lockfiles resolve here
//   github.com, codeload.github.com    git dependencies (pip "git+https", npm
//                                      "github:" tarballs), pre-commit hook repos
//   objects.githubusercontent.com,     where GitHub release and LFS downloads
//   release-assets.githubusercontent.com  redirect (uv-managed Python builds,
//                                      pre-commit tool binaries)
// and, for recipes compiled from other ecosystems' CI (PLAN.md §5.6), an
// explicit list per ecosystem rather than open internet:
//   Rust        crates.io index and downloads, rustup's static.rust-lang.org
//   Go          module proxy and checksum DB; module zips on
//               storage.googleapis.com; go.dev/dl.google.com for toolchains
//   Ruby        rubygems
//   JVM         Maven Central, the Gradle plugin portal and distributions
//   PHP         packagist
//   Conda       conda-forge / anaconda channels
//   Containers  Docker Hub (registry, auth, blob CDN), ghcr.io and its blob
//               host, mcr.microsoft.com: images for CI `services:`
//   apt         Ubuntu and Debian mirrors
//   Runtimes    nodejs.org and mise.jdx.dev (mise's own downloads; other
//               runtimes come from GitHub releases, already allowed)
// The VM holds no keys, so the risk is abuse (mining, scanning), not leaked
// secrets; the allowlist and short VM lifetimes keep that small. The
// benchmark logs blocked hosts, and each new one is added here by hand.
// Not listed on purpose: api.github.com, the Blob store, model providers.
export const EXEC_EGRESS: NetworkPolicy = {
  allow: [
    "pypi.org", "files.pythonhosted.org", "download.pytorch.org",
    "registry.npmjs.org", "registry.yarnpkg.com",
    "github.com", "codeload.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com",
    "crates.io", "index.crates.io", "static.crates.io", "static.rust-lang.org",
    "proxy.golang.org", "sum.golang.org", "storage.googleapis.com", "go.dev", "dl.google.com",
    "rubygems.org", "index.rubygems.org",
    "repo.maven.apache.org", "repo1.maven.org", "plugins.gradle.org", "services.gradle.org", "downloads.gradle.org",
    "packagist.org", "repo.packagist.org",
    "conda.anaconda.org", "repo.anaconda.com",
    "registry-1.docker.io", "auth.docker.io", "production.cloudflare.docker.com", "ghcr.io", "pkg-containers.githubusercontent.com", "mcr.microsoft.com",
    "archive.ubuntu.com", "security.ubuntu.com", "deb.debian.org",
    "nodejs.org", "mise.jdx.dev",
  ],
};
export const EXPLORE_EGRESS: NetworkPolicy = { allow: ["api.anthropic.com", ...GITHUB] };
export const PUSH_EGRESS: NetworkPolicy = { allow: GITHUB };
export const GRAPH_EGRESS: NetworkPolicy = { allow: ["github.com"] };
