// Plain-language guidance for first-time contributors: what publishing will
// do, what happens after, and how a run is paid for. Pure, so the claims stay
// tied to the code paths they describe (lib/agentic-pr.ts opens the PR,
// lib/run-payment.ts picks how a run is paid) and can be tested.

export type PublishStepInput = {
  /** Number of files in the frozen patch. */
  files: number;
  /** `git commit -s`: the project asks for a DCO sign-off. */
  signoff: boolean;
  /** A follow-up run: publishing adds one commit to this existing PR. */
  followupPr?: string;
};

/** What pressing Publish does, in order (lib/agentic-pr.ts createDraftPrFromLog). */
export function publishSteps(input: PublishStepInput): string[] {
  if (!Number.isSafeInteger(input.files) || input.files < 0) throw new RangeError(`files must be a non-negative integer, got ${input.files}`);
  const files = `${input.files} file${input.files === 1 ? "" : "s"}`;
  if (input.followupPr) {
    return [
      `Adds exactly this patch (${files}) as one new commit to your pull request${input.signoff ? ", signed off as the project asks" : ""}.`,
      "Reviewers see the new commit on the pull request. No comment is posted; reply to the review yourself when you are ready.",
    ];
  }
  return [
    "Makes your own copy of the project on your GitHub account (a fork), unless you own the project or already have one.",
    `Saves exactly this patch (${files}) as one commit on a new branch in that copy${input.signoff ? ", signed off as the project asks" : ""}.`,
    "Opens a draft pull request from your account to the project, with the text shown here and a note that an AI tool helped (AI disclosure).",
    "Nothing is merged. Maintainers can see the draft, but most wait until you mark it Ready for review on GitHub.",
  ];
}

/** After a pull request opens: the next steps and the etiquette. */
export const AFTER_PUBLISH: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Check it, then mark it ready", body: "It opens as a draft. Read it once more on GitHub; when you're happy, click \"Ready for review\" there so maintainers know it's finished." },
  { title: "Give it time", body: "Reviews often take a few days, sometimes weeks. Maintainers are often volunteers." },
  { title: "Don't chase people", body: "Avoid @-mentioning maintainers to hurry it. If nothing happens for a week or two, one polite comment asking whether anything else is needed is fine." },
  { title: "Answer every review comment", body: "Make the change, or reply explaining why not. The pull request page drafts fixes and replies for you to check; nothing is posted until you send it." },
  { title: "Let follow-ups help", body: "Turn on \"Help me with follow-ups\" on the pull request page: when checks fail or a reviewer asks for changes, start a run that stops for your review again." },
  { title: "Closed without merging?", body: "It happens to everyone. Thank them, read why, and try another issue." },
];

export type PaymentInput = {
  /** Payment methods this deployment offers (/api/settings/keys `offered`). */
  offered: string[];
  /** Per-run cap for API-key runs, in dollars. */
  maxSpendUsd: number;
};

/** Why a run needs a payment method and what it costs, for onboarding. */
export function paymentSummary(input: PaymentInput): string {
  if (!Number.isFinite(input.maxSpendUsd) || input.maxSpendUsd <= 0) throw new RangeError(`maxSpendUsd must be positive, got ${input.maxSpendUsd}`);
  const cap = `$${input.maxSpendUsd.toFixed(2)}`;
  const subscriptions = input.offered.filter((p) => p === "claude-subscription" || p === "codex-subscription");
  const plans = subscriptions.length === 2 ? "Claude or ChatGPT" : subscriptions[0] === "codex-subscription" ? "ChatGPT" : "Claude";
  const free = "Finding and checking issues is free; only the agent's runs cost money.";
  if (subscriptions.length > 0) {
    return `The agent is an AI model, so each run uses AI time. Use the ${plans} subscription you already have (no per-run charge), or an Anthropic API key billed per use, where each run stops at ${cap}. ${free}`;
  }
  return `The agent is an AI model (Claude), so each run costs a little. Add your own Anthropic API key: Anthropic bills you per use, and each run stops at ${cap} (change it in Settings). ${free}`;
}
