---
name: bug
description: Fix a FilePlus bug JJ reported — read the logs, reproduce it with a failing test before touching code, fix, review, commit, explain the cause in plain English. Only when JJ types /bug.
argument-hint: <what went wrong, plus a screenshot if he has one>
disable-model-invocation: true
---

JJ reported this bug: **$ARGUMENTS**

JJ is not a programmer. If he attached a screenshot, look at it first.

## 1. Read the logs before anything else

- Dev runs log to `logs/` at the repo root: `backend.log` (every request,
  every error with traceback, every file operation), `main.log` (Electron main
  process) and `renderer.log` (the window's console, uncaught errors).
  Test runs log to `artifacts/logs/`. Find the lines around the time of the
  bug. Do not guess at a cause the logs can answer.

## 2. Reproduce with a failing test — before changing any app code

- Branch: `fix/<short-slug>` from `master`.
- Write the smallest test that shows the bug: pytest in `tests/` for backend
  behaviour (use `sandbox`/`fixture_tree`, never real folders), Playwright in
  `frontend/test/` with `frontend/test/harness/app.js` for anything on screen
  (take a named screenshot of the broken state).
- Run it and confirm it fails **because of the bug**. If you cannot make it
  fail, you have not found the bug yet — keep reading logs and code, or ask
  JJ one specific question.

## 3. Fix

- Change the real cause, not the symptom. Never weaken a test, add a skip, or
  special-case the test to make it pass.
- Run the new test until it passes, then the full gate:
  `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` — all green,
  nothing else broken.

## 4. Review

- Run the `reviewer` subagent and fix every MUST FIX item.

## 5. Finish

- Commit (test and fix together) with a message that names the cause.
- Tell JJ in one or two plain sentences what caused it, and what he can click
  to see it fixed.

## Rule: three strikes

If the same approach fails 3 times, stop. `git reset --hard` to the last
commit on the fix branch, write JJ a short diagnosis (what you tried, why it
failed, what the logs show), propose a different approach, and wait for his
go-ahead before continuing.
