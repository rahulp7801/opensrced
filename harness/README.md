# opensrcer harness

A Claude Code plugin for contributing to open source. Before your agent touches a project it reads that project's **profile**: measured from the project's own recent pull requests, it says what share of outside contributors' PRs get merged, why PRs get closed (opened without being assigned, discuss first, duplicate, stale…), what reviewers keep asking for, how fast maintainers respond, and the house conventions. The `contribute` skill then works so the PR fits: test first, small change, the project's conventions, your own words in the description.

## Install

In Claude Code:

```
/plugin marketplace add rahulp7801/opensrced
/plugin install opensrcer@opensrced
```

Then sign in at https://opensrced.vercel.app, open **Account → Harness**, create a token, and add it to `~/.claude/settings.json`:

```json
{ "env": { "OPENSRCER_TOKEN": "osh_…" } }
```

Restart Claude Code. Ask it to help you contribute to a repository, or call the tools directly:

- `repo_profile` — `{ "repo": "pandas-dev/pandas" }`
- `record_event` — `{ "type": "pr_opened", "repo": "pandas-dev/pandas", "pr_url": "https://github.com/…/pull/123" }`

## What it sends

Only what the tools are called with: a repository name, and for events the event type, a PR URL and a verification outcome. No code, no prompts, no secrets. Events count toward your record on opensrcer; you can export or delete them from your Account page.

A token can do only what your account can, and stops working the moment you revoke it or lose access.
