# opensrcer harness

A plugin for contributing to open source, for Claude Code, VS Code with GitHub Copilot, Codex and any agent that speaks MCP. Two ways to work:

- **Contribute.** Before your agent touches a project it reads that project's **profile**: measured from the project's own recent pull requests, it says what share of outside contributors' PRs get merged, why PRs get closed (opened without being assigned, discuss first, duplicate, stale…), what reviewers keep asking for, how fast maintainers respond, and the house conventions. The `contribute` skill then works so the PR fits, and `check_pr` checks the draft before you open it.
- **Learn.** `lesson_start` turns an issue into a lesson where your agent is the teacher: what the project does, the task, where to look, what to change and how to prove it, then the fix (revealed after you predict it, or written by you), and explaining it. In VS Code with Copilot and in Claude, the lesson opens as a panel in the chat with the questions, hints and a map of the code; everywhere else it runs in the chat.

The website is only needed once, to sign in and make a token; your lessons and contributions are counted on your account there.

## Install

Lessons draw their code map with [graphify](https://pypi.org/project/graphifyy/), the same graph the site uses. Install it once (Python 3.10+):

```sh
pip install graphifyy==0.9.73
```

If it lives in a virtualenv, set `OPENSRCER_GRAPH_PYTHON` to that Python (e.g. `~/.venvs/graph/bin/python`).

### Claude Code

```
/plugin marketplace add rahulp7801/opensrced
/plugin install opensrcer@opensrced
```

The install asks for your token: sign in at https://opensrced.vercel.app, open **Account → Harness**, create one and paste it. (From a shell: `claude plugin install opensrcer@opensrced --config opensrcer_token=osh_…`; to change it later, `/plugin configure opensrcer@opensrced`.) Then restart Claude Code.

### VS Code with GitHub Copilot, Codex, other agents

The harness is a dependency-free MCP server (Node 20+). Get it:

```sh
git clone --depth 1 https://github.com/rahulp7801/opensrced ~/.opensrcer/src
```

Set `OPENSRCER_TOKEN` in your environment (a token from Account → Harness), then add the server with the absolute path to `~/.opensrcer/src/harness/server.mjs`:

**VS Code** — run **MCP: Open User Configuration** and add:

```json
{
  "servers": {
    "opensrcer": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/you/.opensrcer/src/harness/server.mjs"],
      "env": { "OPENSRCER_TOKEN": "${env:OPENSRCER_TOKEN}" }
    }
  }
}
```

**GitHub Copilot CLI** — `~/.copilot/mcp-config.json`, the same entry under `"mcpServers"`.

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.opensrcer]
command = "node"
args = ["/home/you/.opensrcer/src/harness/server.mjs"]
env_vars = ["OPENSRCER_TOKEN"]
```

The server sends these agents the workflow itself (`skills/` has the full versions for Claude Code). Update with `git -C ~/.opensrcer/src pull`.

## Use

Ask your agent to help you contribute to a repository, or to teach you an issue. The tools:

| Tool | What it does |
|---|---|
| `repo_profile` | The project's measured norms: `{ "repo": "pandas-dev/pandas" }` |
| `check_pr` | The draft PR against those norms, before you open it |
| `lesson_start` | A lesson on an issue: `{ "repo": "earthlab/earthpy", "issue": 953, "dir": "/path/to/your/clone" }` |
| `lesson_answer`, `lesson_hint` | Your answers (graded by your agent against the step's rubric) and hints |
| `lesson_key`, `lesson_reveal` | Path A: the fix your agent writes out of sight, and its reveal |
| `lesson_submit_own` | Path B: your own change, read from your checkout |
| `lesson_show` | Where a lesson stands (and the panel, where your editor has one) |
| `record_event` | A verification result or a PR opened/merged/closed, for your stats |

## What it sends

- **Profiles and PR checks:** the repository name, and the draft's facts (title, description, changed paths, line counts). No code.
- **Lessons:** the issue's title and text, the project's README, graphify's graph of the checkout (files, functions, classes and how they connect; not their code), your answers, and the fix's diff from your agent's hidden worktree (or, on path B, your own change). They are stored with the lesson on your account.
- **Never:** prompts, secrets, or anything outside the checkout you point it at.

graphify runs on your machine, on a throwaway copy of the commit; its viewer stays there (`~/.opensrcer/graph-cache`) for the panel. Your agent grades your answers, so the grades are as strict as the rubric it's given. A token can do only what your account can, and stops working the moment you revoke it or lose access.
