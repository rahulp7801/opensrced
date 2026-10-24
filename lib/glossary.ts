// Plain-language definitions for the git/GitHub words the app cannot avoid.
// Shown inline by components/term.tsx so a first-time contributor can look a
// word up where it appears. Keep each definition true to what opensrcer
// actually does, short, and free of other jargon.

export const GLOSSARY = {
  "pull request": "A proposed change to someone else's project. Maintainers read it, comment, and decide whether to merge (accept) it. Often shortened to PR.",
  "draft PR": "A pull request marked \"not finished yet\". Maintainers usually wait to review it until you click \"Ready for review\" on GitHub. opensrcer always opens drafts, so nothing is final until you say so.",
  fork: "Your own copy of the project on your GitHub account. You can't change someone else's project directly, so the change goes to your copy first and the pull request asks them to take it.",
  branch: "A named line of work inside a project. Your change lives on its own branch, so the project's main code is untouched until maintainers merge it.",
  "base branch": "The branch your change would be merged into, usually main. The pull request shows the difference between your branch and this one.",
  maintainer: "A person who looks after the project and decides which changes get merged. Often a volunteer with limited time.",
  CI: "Continuous integration: the project's automatic checks (tests, linting, builds) that run on every pull request. A failed check needs a look, but it is not always caused by your change.",
  "sign-off": "Some projects ask you to certify that you have the right to contribute the code (the Developer Certificate of Origin, DCO). Signing off adds a \"Signed-off-by: your name\" line to the commit. opensrcer adds it when the project asks for it.",
  "merge conflict": "Someone changed the same lines since your branch was made, so Git can't combine them automatically. Updating your branch with the latest code (a rebase) and choosing which lines to keep fixes it.",
  preview: "A practice run: the agent writes and checks a fix so you can read it, but a preview can never be published. To send a pull request, run the issue again as a publishable run; it also stops for your review first.",
  verified: "opensrcer ran the project's own tests on the final patch and they passed. \"Not verified\" means no passing test run was observed, so read the change more carefully.",
  "AI disclosure": "A short note opensrcer adds to every pull request saying an AI tool helped draft it, which model ran, and what was tested. Many projects require this.",
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;
