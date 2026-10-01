---
name: feature
description: Build a FilePlus feature end to end — acceptance criteria approved by JJ, tests first, implementation, QA and review subagents, commit, plain-English report. Only when JJ types /feature.
argument-hint: <what the feature should do, in plain words>
disable-model-invocation: true
---

JJ asked for this feature: **$ARGUMENTS**

JJ is not a programmer. Talk to him in plain English, no code in messages to him.

## 1. Criteria first — then STOP and wait

- Find the governing spec: `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md`
  (canonical plan) and the stage spec in `docs/superpowers/specs/` the feature
  belongs to. Read the relevant section, `CLAUDE.md`, and the code it touches.
- Write the acceptance criteria as a short checkbox list, each one something a
  test can check and JJ can see ("Selecting two files shows '2 selected' in the
  Inspector"), plus anything the spec says is out of scope.
- If the feature contradicts the spec or CLAUDE.md's safety rules, say so in one
  sentence and propose the closest version that fits.
- Show JJ the checklist and **wait for his approval**. Do not write code
  before he says yes (or changes the list).

## 2. Tests first

- Branch: `feature/<short-slug>` from `master`.
- Write tests for every criterion before the implementation:
  backend behaviour → pytest in `tests/` (use the `sandbox`/`fixture_tree`
  fixtures, never real folders); UI behaviour → Playwright in `frontend/test/`
  using `frontend/test/harness/app.js` (`launchApp`, `shot`, `rowByName`), with a
  named screenshot (`shot(page, 'feature-<slug>-<step>')`) at each step JJ will
  care about.
- Run them and confirm they FAIL for the right reason (the missing feature, not
  a typo). Paste nothing to JJ yet.

## 3. Implement in thin slices

- One small, testable behaviour at a time; run its tests; commit when green.
- Every file operation goes through `backend/mover.py` (guard → operations log
  → act → mark; undoable). No hardcoded paths. Design tokens only.
- When something fails, read `artifacts/logs/` (backend.log, main.log,
  renderer.log) before guessing.

## 4. QA

- Run the `qa` subagent. Fix every functional, visual and log problem it
  reports, rerun until it says clean. Open the new screenshots yourself and
  look at them.

## 5. Review

- Run the `reviewer` subagent. Fix every MUST FIX item; fix SHOULD FIX items
  unless there is a clear reason not to (say the reason in the commit).

## 6. Finish

- Full gate: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` —
  must be all green.
- Commit with a clear message.
- Report to JJ in plain English, in a few short sentences: what was built,
  then the **2 to 4 things he should click to feel-check it** (where to go,
  what to click, what he should see).

## Rule: three strikes

If the same approach fails 3 times, stop. `git reset --hard` to the last
commit on the feature branch, write JJ a short diagnosis (what you tried, why it
failed, what you learned), propose a different approach, and wait for his
go-ahead before continuing.
