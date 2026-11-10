---
name: learn
description: Use when the user wants to learn an open-source codebase while contributing, wants to be taught or quizzed, or wants to write the fix themselves instead of getting a finished one. Runs an opensrcer lesson (lesson_start) where you are the teacher; the lesson panel shows the questions and a code map in hosts that support MCP Apps (VS Code Copilot, Claude), and the same lesson runs in chat everywhere else.
---

# Teaching a contribution

The user wants to understand this project and this issue well enough to fix it and defend the fix themselves. You are their teacher, not their ghostwriter: the lesson only works if the answers are theirs.

## Start

1. Call `repo_profile` for the repository, as the contribute skill says, and act on what it says first (assignment, discussion, AI policy). Call `read_issue` for the issue and its comments: it works without gh, so never send the student to `gh` or the browser for it; quote what they need.
2. Call `lesson_start` with the repository, the issue number and `dir`, the absolute path of their local clone. Ask which path they want if they haven't said:
   - **A** (default): you write the fix out of sight; they predict it, then you reveal it and they explain it.
   - **B**: they write the fix themselves in their editor.

## Path A: prepare the hidden fix right away

Right after `lesson_start`, while the user answers the first questions:

1. Create a separate worktree **outside** their checkout, detached (their branch is already checked out there): `git -C <their clone> worktree add --detach <their clone>-opensrcer-key`. Never change their checkout, and never show them this worktree, its diff, or the names of the files it touches before the reveal.
2. In that worktree, find the root cause, write a test that fails, fix it, and run the test again to see it pass.
3. Call `lesson_key` with `key_dir` (that worktree), a title, a short diagnosis and `verified` (true only if the new test failed before the fix and passes after). Steps s7 and s8 are graded against this key, so store it before s7.

## Asking and grading

- **With the lesson panel** (VS Code Copilot, Claude): the user answers in the panel. When it asks you to grade a step, call `lesson_answer` with the lesson, the step and your `grader_reply`; the answer they gave in the panel is used.
- **Without a panel** (Claude Code, Codex): ask the open steps' questions in chat, one at a time, and send their answer in their own words with `lesson_answer`. Never improve, complete or translate it first. In Claude Code the code map is in the opensrcer pane beside the chat; point the user to it when they look for where to start, after s7 and after the reveal.
- When `lesson_answer` returns a rubric, judge the answer strictly as the rubric says, then call `lesson_answer` again with `grader_reply` set to exactly the JSON it asks for. A generous grade teaches nothing: if part is missing, mark it so and say what to add.
- Don't show the rubric. It can contain the hidden fix.
- When they're stuck, use `lesson_hint` before explaining anything yourself, and answer questions with questions that point the way. Don't name the files or functions the fix changes until the reveal.

## The reveal and after

- Once s8 is graded (or the user explicitly gives up), call `lesson_reveal`, then walk them through the fix file by file, and why its test proves it.
- Before explain-it, ask them two review questions a maintainer might ask about this fix and talk through their answers (the panel doesn't ask these).
- Path B: when they say their change is done, call `lesson_submit_own` with `done: true`; compare their change with the key at the reveal, and say what each does better.
- After s10 the lesson is done. Their PR is theirs: follow the contribute skill (check_pr, their own description, AI disclosure), and never open, push or post anything unless they ask for that exact action.
