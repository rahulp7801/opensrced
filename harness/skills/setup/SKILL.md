---
name: setup
description: Use when the user is setting up opensrcer, asks whether it works or what's wrong with it, or when an opensrcer tool failed with a token, access or install error. Runs opensrcer's setup_check and walks the user through each fix.
---

# Check the opensrcer setup

1. Call `setup_check` (pass `dir` when the user is in a project checkout). Show the user its result exactly as it is: every line, OK and FIX alike.
2. For each FIX, help the user do it, one at a time, in their own terminal or browser. Never paste or ask them to paste a token into this chat: a token goes into `/plugin configure opensrcer@opensrced` (Claude Code) or the editor's own prompt.
3. When they say it's done, call `setup_check` again. Repeat until it says "All set".
4. Then suggest a first step: "Teach me issue 429 in pallets/itsdangerous" for a lesson, or their instructor's assigned issue.

If the result says the account doesn't have access, the fix is the class link from their instructor (open it, sign in with GitHub, press Join). Don't suggest workarounds.
