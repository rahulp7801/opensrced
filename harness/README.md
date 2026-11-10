# opensrcer harness

A plugin for contributing to open source, for Claude Code, VS Code with GitHub Copilot, Codex and any agent that speaks MCP. Two ways to work:

- **Contribute.** Before your agent touches a project it reads that project's **profile**: measured from the project's own recent pull requests, it says what share of outside contributors' PRs get merged, why PRs get closed (opened without being assigned, discuss first, duplicate, stale…), what reviewers keep asking for, how fast maintainers respond, and the house conventions. The `contribute` skill then works so the PR fits, and `check_pr` checks the draft before you open it.
- **Learn.** `lesson_start` turns an issue into a lesson where your agent is the teacher: what the project does, the task, where to look, what to change and how to prove it, then the fix (revealed after you predict it, or written by you), and explaining it. In VS Code with Copilot and in Claude, the lesson opens as a panel in the chat with the questions, hints and a map of the code. In Claude Code (terminal, VS Code, desktop) the lesson runs in the chat and the code map opens in a pane beside it, coloured as you go: your starting points, then what the fix changed (`/opensrcer-map` reopens it).

The website is only needed once, to sign in and make a token; your lessons and contributions are counted on your account there.

## Install

Lessons draw their code map with [graphify](https://pypi.org/project/graphifyy/), the same graph the site uses. Nothing to install: without graphify on your machine, the map of the project's upstream commit comes from opensrcer (a big project's first map takes a few minutes; after that it's shared). To map your own checkout locally instead, install it (Python 3.10+):

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

### VS Code with GitHub Copilot

Run this once in any terminal (Node 20 or newer):

```sh
npx -y opensrcer-mcp install
```

It adds opensrcer to VS Code's MCP settings (keeping anything already there, with a backup). Open Copilot Chat in Agent mode: the first time opensrcer starts, VS Code asks for your token (from **Account → Harness**) and stores it securely. Then ask Copilot to "check my opensrcer setup".

### Codex, Copilot CLI, other agents

The harness is a dependency-free MCP server (Node 20+): `npx -y opensrcer-mcp`. Set `OPENSRCER_TOKEN` in your environment (a token from Account → Harness). Without npm, clone it instead (`git clone --depth 1 https://github.com/rahulp7801/opensrced ~/.opensrcer/src`) and run `node ~/.opensrcer/src/harness/server.mjs`.

**GitHub Copilot CLI**: in `~/.copilot/mcp-config.json`:

```json
{ "mcpServers": { "opensrcer": { "type": "local", "command": "npx", "args": ["-y", "opensrcer-mcp@latest"], "env": { "OPENSRCER_TOKEN": "${OPENSRCER_TOKEN}" }, "tools": ["*"] } } }
```

**Codex CLI**: in `~/.codex/config.toml`:

```toml
[mcp_servers.opensrcer]
command = "npx"
args = ["-y", "opensrcer-mcp@latest"]
env_vars = ["OPENSRCER_TOKEN"]
```

The server sends these agents the workflow itself (`skills/` has the full versions for Claude Code). These two setups haven't been tested yet; Claude Code and VS Code are the tested ones. If yours doesn't start, check your agent's MCP docs for its config format.

## Use

Ask your agent to help you contribute to a repository, or to teach you an issue. The tools:

| Tool | What it does |
|---|---|
| `setup_check` | Whether it all works here (token, access, git, code map, GitHub), with the fix for each problem. In Claude Code: `/opensrcer:setup` |
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

graphify runs on your machine, on a throwaway copy of the commit; its output stays there (`~/.opensrcer/graph-cache`) for the panel and the pane. Your agent grades your answers, so the grades are as strict as the rubric it's given. A token can do only what your account can, and stops working the moment you revoke it or lose access.
