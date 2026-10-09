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

export const AGENT_EGRESS: NetworkPolicy = {
  allow: ["api.anthropic.com", ...GITHUB, "vercel.com", "*.blob.vercel-storage.com", "generativelanguage.googleapis.com"],
};
export const EXPLORE_EGRESS: NetworkPolicy = { allow: ["api.anthropic.com", ...GITHUB] };
export const PUSH_EGRESS: NetworkPolicy = { allow: GITHUB };
export const GRAPH_EGRESS: NetworkPolicy = { allow: ["github.com"] };
