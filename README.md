# Campus Customs: HW4

A Yale apparel storefront (React + Vite + TypeScript) with a FastAPI backend and a PydanticAI shop assistant that answers product, price, and stock questions from the store's SQLite database, puts matching products on the page, remembers logged-in customers' chats, and logs every tool call to an audit trail.

Full system reference (models, tools, safety rules, limits, data flow): [`output/harness.md`](output/harness.md).

## Project structure

```
.
├── AI_prompts.md              # every prompt used to build the project, by problem
├── requirements.txt           # backend Python dependencies
├── .env.example               # environment variable template (placeholders only)
├── backend/
│   ├── main.py                # FastAPI app and routes
│   ├── agent.py               # PydanticAI agent setup, dependencies, run loop
│   ├── models.py              # Pydantic models (API, tool results, agent output, deps)
│   ├── tools.py               # agent tools + read-only product queries
│   ├── prompts/prompt.md      # the assistant's system prompt
│   ├── auth.py                # create account / log in / sessions (users table)
│   ├── memory.py              # saved chat history for logged-in customers
│   └── audit.py               # append-only audit trail
├── frontend/                  # React + Vite + TypeScript site
├── data/                      # NOT in Git: put the assignment data here (see step 2)
└── output/
    ├── harness.md             # complete system reference
    ├── usability.md           # Problem 9 usability improvements
    ├── design.md              # Problem 10 design changes
    ├── app_check.html         # Problem 11 app check report (open from disk)
    ├── app_check_images/      # screenshots used by the report
    └── audit_trail.json       # append-only log of agent tool calls and stop reasons
```

## Setup

Requirements: **Python 3.12+**, **Node.js 20+**, and a **Portkey API key** (or an OpenAI API key) for the chat assistant.

### 1. Get the code

```bash
git clone <this repository's URL> campus-customs
cd campus-customs
```

All commands below start from this project root.

### 2. Add the assignment data (not included in Git)

The database and product images come with the assignment and are intentionally not committed. Place them so the folder looks like this:

```
data/
├── campus_customs.db
└── products/
    ├── basic-hoodie-big-yale.jpg
    └── … (102 product images)
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace `your-portkey-api-key-here` with your Portkey API key. The other variables in `.env.example` are optional (direct OpenAI key, gateway URL, a `SESSION_SECRET` to keep logins across restarts, and chat rate limits). You can also skip the file and `export PORTKEY_API_KEY=...` in your shell. `.env` is git-ignored; never commit it.

Without a key, the store and accounts still work; the chat replies "The shop assistant isn't available right now."

### 4. Install dependencies

Backend (creates a virtual environment in `.venv/`):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Frontend:

```bash
cd frontend
npm install
cd ..
```

## Run

Use two terminals.

**Backend** (run from the `backend/` folder):

```bash
cd backend
source ../.venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Frontend** (run from the `frontend/` folder):

```bash
cd frontend
npm run dev
```

Then open:

| URL | What |
|---|---|
| http://localhost:5173 | The Campus Customs website (use this one) |
| http://127.0.0.1:8000/api/health | Backend health check (`{"status": "ok"}`) |
| http://127.0.0.1:8000/docs | Interactive API documentation (FastAPI) |

The Vite dev server proxies `/api` and `/media` to the backend on port 8000, so the website only needs port 5173 open in the browser.

To try accounts, log in with the assignment's seed user (`test@campuscustoms.yale.edu`) or create a new account. Logged-in customers' chats are saved and come back after a reload.

## Production build (optional)

```bash
cd frontend
npm run build      # outputs frontend/dist/
```

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/products`, `/api/products/{id}` | Catalogue and one product (with per-size stock) |
| GET | `/media/products/<file>` | Product images |
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | Accounts (signed `HttpOnly` cookie session) |
| GET | `/api/auth/me` | Current user |
| POST | `/api/chat` | Send `{message, history, page_context}`; returns `{reply, products, search}` |
| GET | `/api/chat/history` | The logged-in customer's saved chat |

Details, limits, and safety rules: [`output/harness.md`](output/harness.md).
