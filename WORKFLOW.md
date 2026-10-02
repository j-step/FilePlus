# How to work with Claude on FilePlus

Claude writes, tests and checks the code. You decide what gets built and whether it feels right.

## Ask for something new
Type `/feature` and describe it in plain words, for example:
`/feature show how many files are selected in the bottom bar`
Claude first shows you a short checklist of what "done" means. **Read it and say yes (or change it).**
Nothing gets built before you approve. At the end Claude tells you 2–4 things to click to try it.

## Report a problem
Type `/bug` and say what went wrong, and paste a screenshot if you have one, for example:
`/bug the Recent list is empty after I open a file` + screenshot
Claude reads the app's logs, proves the bug with a test, fixes it, and tells you the cause in a sentence.

## What only you can do
- Approve the checklist at the start of every `/feature`.
- The final feel check: click the things Claude lists and say if anything looks or feels wrong.
- Decide when a branch gets merged into the main version.

## Run the app yourself
Open two PowerShell windows in the `FilePlus` folder:
1. `py -3 -m backend.api` (leave it running)
2. `cd frontend` then `npm start`
Your app only ever changes files inside `FilePlusTestSandbox` until you deliberately unlock it.

## Run the tests yourself (optional)
- Everything: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` (about 2 minutes, ends in "all green")
- Quick check: `cd frontend` then `npm run test:smoke`
Pictures of every screen land in `artifacts\screenshots`. Tests use their own copy of everything — your app can stay open.

## If Claude seems stuck
If it keeps trying the same thing, or the chat has wandered:
1. Type `/clear` to start fresh.
2. Run the command again (`/feature ...` or `/bug ...`) with your description.
Claude stops by itself after 3 failed tries and explains what it tried. You can also just say "stop and explain".
