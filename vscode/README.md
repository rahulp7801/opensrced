# opensrcer for VS Code

Learn open source by fixing real issues. GitHub Copilot becomes your teacher: it walks you through a real issue in a real project, asks you questions instead of handing you answers, and shows a map of the project's code beside your editor.

Nothing else to install: no Node, no config files, no Python.

## Get started

1. Install this extension, and GitHub Copilot Chat if you haven't.
2. Click **opensrcer** in the status bar, then **Sign in**. Your Account page opens: under **Harness**, create a token, copy it, and paste it into VS Code.
   - No access yet? Open the class link your teacher shared, or join the waitlist at https://opensrced.vercel.app/join.
3. Click **opensrcer**, then **Learn an issue**, and paste a GitHub issue's link. Copilot Chat opens in Agent mode and starts the lesson.

The first time Copilot uses opensrcer, VS Code asks whether to trust the opensrcer server: allow it.

## What you get

- **Lessons.** What the project does, the task, where to look, what to change and how to prove it, then the fix (revealed after you predict it, or written by you), and explaining it in your own words.
- **The code map.** The *opensrcer map* tab opens beside your editor and updates as you go: blue where you chose to start, yellow where the fix changed the code. Reopen it with *opensrcer: Show the code map*.
- **Each project's unwritten rules.** Before Copilot touches a project, it reads that project's measured norms: what gets PRs merged or closed, what reviewers ask for.

## Commands

| Command | What it does |
|---|---|
| opensrcer: Sign in / Sign out | Store or remove your token (kept in VS Code's secret storage) |
| opensrcer: Learn an issue | Start a lesson in Copilot Chat |
| opensrcer: Check my setup | Copilot runs opensrcer's setup check: sign-in, git, code map, GitHub |
| opensrcer: Show the code map | Open the map tab |

## Settings

- `opensrcer.url`: the opensrcer site (default https://opensrced.vercel.app).
- `opensrcer.graphPython`: optional, a Python with [graphify](https://pypi.org/project/graphifyy/) to draw maps on your machine. Empty: opensrcer draws them for you.

## What it sends

The issue, the project's README, graphify's map of the code (file, function and class names and how they connect, not the code itself), your answers, and the fix's diff. Never your prompts, secrets, or anything outside the project folder you're working in.
