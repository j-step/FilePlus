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
pytest tests/
```

## Development status

See [PLAN.md](PLAN.md) for the phase-by-phase build plan and [CLAUDE.md](CLAUDE.md) for session context.
