---
name: contribute
description: Use when the user wants to contribute to an open-source repository they don't maintain — fixing an issue, opening a pull request, or deciding which issue to take. Brings in the project's measured unwritten rules (opensrcer repo_profile), then works so the PR fits the project and the user can stand behind it.
---

# Contributing to an open-source project

The person you are helping is the contributor. The pull request goes out in their name, so they must understand and be able to defend every line of it. Your job is to make the change fit how this project actually works, not just to make it compile.

## 1. Learn the project before touching code

1. Call the `repo_profile` tool (opensrcer MCP server) with the repository as `owner/name`. It reports what really gets merged there, why PRs get closed, what reviewers keep asking for, and the house conventions, each measured from the project's own recent PRs with links.
2. Read the project's CONTRIBUTING file, its pull request template, and any AI policy (AGENTS.md, CONTRIBUTING, the README).
3. Act on what you found **before** writing code:
   - The project bans AI-generated contributions: stop, and tell the user plainly. Do not work around it.
   - PRs get closed for being opened **without being assigned**: the user should ask to be assigned on the issue first. Draft that comment for them; they post it.
   - PRs get closed with **"discuss first"**: draft a short issue comment proposing the approach; they post it and wait.
   - Many PRs are closed as **duplicates**: search open PRs for the issue number first.
   - Outside PRs rarely get merged at all: tell the user, so they can choose a better project or issue.

Never post comments, push, or open PRs yourself unless the user explicitly asks for that specific action.

## 2. Make the change the way this project wants it

- Find the root cause, and say where it is (file and function) before fixing it.
- **Write the test first and run it to see it fail.** Then fix, and run it again to see it pass. A test that already passed before the fix proves nothing. If the project's tests can't run here, say so instead of claiming the fix is tested.
- Keep the change about as small as the profile says merged PRs are. Don't refactor or reformat around it.
- Follow the conventions the profile lists: PR title style, changelog location (add the entry), sign-off (`git commit -s`), and anything reviewers routinely ask for.
- Run the project's own formatter and linters (pre-commit, if it has one).

After verifying, call `record_event` with `type: "verification"` and `outcome` (`verified`, `failed`, or `inconclusive`).

## 3. Hand it to the contributor

- Walk the user through the change: what was wrong, what changed, how the test proves it. Ask them to explain it back in their own words, and use those words in the PR description.
- Fill in the project's PR template. Link the issue. Disclose AI assistance the way the project asks (and honestly when it doesn't ask).
- Call `check_pr` with the draft's facts: the title and description, the changed paths and line counts (`git diff --numstat` against the upstream branch), whether the description links an issue, and whether every commit is signed off. Fix each warning, or tell the user why it doesn't apply.
- Open the PR as a draft, and only when the user tells you to.

When a PR is opened, merged or closed, call `record_event` (`pr_opened`, `pr_merged`, `pr_closed`) with its `pr_url`. That counts toward the user's record on opensrcer.
