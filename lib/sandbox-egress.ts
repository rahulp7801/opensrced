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
export const EXPLORE_EGRESS: NetworkPolicy = { allow: ["api.anthropic.com", ...GITHUB] };
export const PUSH_EGRESS: NetworkPolicy = { allow: GITHUB };
export const GRAPH_EGRESS: NetworkPolicy = { allow: ["github.com"] };
