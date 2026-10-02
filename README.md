# FilePlus

AI-powered Windows file explorer replacement with local-first organisation, tagging, smart folders, and a complete undo system.

## Stack

| Layer      | Technology                                |
|------------|-------------------------------------------|
| Frontend   | Electron (HTML/CSS/JS)                    |
| Backend    | Python 3.11 + FastAPI (localhost:9876)    |
| Database   | SQLite via aiosqlite (WAL mode)           |
| AI local   | Ollama llama3.1:8b                        |
| AI cloud   | Claude API (Anthropic) — fallback only    |

## Quick start (development)

### Prerequisites
- Python 3.11+
- Node.js 20+
- Ollama (optional for AI features)

### Setup

```bash
# 1. Clone and enter the repo
git clone https://github.com/j-step/FilePlus.git
cd FilePlus

# 2. Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\activate   # Windows

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Copy and fill in .env
copy .env.example .env

# 5. Install Electron
cd frontend
npm install
cd ..
```

### Run

```bash
# Start the backend (from repo root)
python -m backend.api

# Start the frontend (in a second terminal)
cd frontend
npm start
```

### Test

```bash
py -3 -m pytest -q                       # backend
cd frontend && npm run test:smoke        # fast Electron launch check
cd frontend && npm run test:e2e          # every Electron test
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1   # the full gate
```

The Electron tests start their own backend on port 9877 against a fresh temp copy of the
fixtures (`frontend/test/harness/`); logs land in `artifacts/logs/`. See `WORKFLOW.md` and
the "Development workflow" section of `CLAUDE.md`.

### Fixtures

```bash
py -3 scripts/gen_sandbox.py
```

Builds `FilePlusTestSandbox/_gen`.

## Development status

Restarted 2026-09-10. The roadmap and every decision live in
[docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md](docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md).
Session rules are in [CLAUDE.md](CLAUDE.md).

Run everything with one command from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```
