"""Campus Customs API: product data, product images, accounts, the shop chatbot, and chat memory.

Run from the backend folder:
    uvicorn main:app --reload --port 8000
"""

import logging
import math
import os
import sys
import time
from collections import deque
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent

# Configuration comes from environment variables. For local development they can also be
# put in hw4/.env (git-ignored; copy hw4/.env.example). Variables already set in the shell
# take precedence. Loaded before the local imports so auth.py and agent.py see them.
load_dotenv(BACKEND_DIR.parent / ".env")

# Local imports (auth, agent, tools, models) resolve from this folder, also when the app
# is started from hw4/ as `uvicorn backend.main:app`.
sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import audit  # noqa: E402
import memory  # noqa: E402
from agent import ChatNotConfigured, build_deps, run_chat  # noqa: E402
from auth import current_user, router as auth_router  # noqa: E402
from models import ChatHistoryResponse, ChatRequest, ChatResponse  # noqa: E402
from tools import DATA_DIR, get_all_products, get_product  # noqa: E402

logger = logging.getLogger("campus_customs")

app = FastAPI(title="Campus Customs API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_credentials=True,
    allow_headers=["*"],
)

app.include_router(auth_router)

# Product images live in data/products/; image_file_path values are relative to data/.
# Only data/products is exposed, never the database file itself.
app.mount("/media/products", StaticFiles(directory=DATA_DIR / "products"), name="media")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/products")
def list_products() -> list[dict]:
    return get_all_products()


@app.get("/api/products/{product_id}")
def product_detail(product_id: str) -> dict:
    product = get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


class ChatRateLimiter:
    """Sliding-window limits on chat messages per shopper, since every message is a paid model call.

    Shoppers are identified by account when logged in, otherwise by IP address. Limits come
    from CHAT_RATE_LIMIT_PER_MINUTE / CHAT_RATE_LIMIT_PER_HOUR (defaults 10 and 60).
    """

    def __init__(self, per_minute: int, per_hour: int):
        self.windows = [(60.0, per_minute), (3600.0, per_hour)]
        self.history: dict[str, deque[float]] = {}

    def check(self, key: str) -> int | None:
        """Record a message and return None, or return seconds to wait if over a limit."""
        now = time.monotonic()
        stamps = self.history.setdefault(key, deque())
        while stamps and now - stamps[0] > self.windows[-1][0]:
            stamps.popleft()
        for window, limit in self.windows:
            recent = [t for t in stamps if now - t < window]
            if len(recent) >= limit:
                return max(1, math.ceil(window - (now - recent[0])))
        stamps.append(now)
        return None


chat_limiter = ChatRateLimiter(
    per_minute=int(os.getenv("CHAT_RATE_LIMIT_PER_MINUTE", "10")),
    per_hour=int(os.getenv("CHAT_RATE_LIMIT_PER_HOUR", "60")),
)


def shopper_key(request: Request, user) -> str:
    if user:
        return f"user:{user['id']}"
    host = request.client.host if request.client else "unknown"
    # The Vite dev proxy forwards the browser's address in X-Forwarded-For; only trust it
    # when the request itself comes from the local proxy.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and host in ("127.0.0.1", "::1"):
        host = forwarded.split(",")[0].strip()
    return f"ip:{host}"


@app.get("/api/chat/history", response_model=ChatHistoryResponse)
def chat_history(request: Request) -> ChatHistoryResponse:
    # The user comes from the signed session cookie, never from the request body or URL,
    # so a customer can only load their own messages.
    user = current_user(request)
    if user is None:
        return ChatHistoryResponse(logged_in=False)
    return ChatHistoryResponse(logged_in=True, messages=memory.load_messages(user["id"]))


@app.post("/api/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request) -> ChatResponse | JSONResponse:
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    user = current_user(request)
    wait = chat_limiter.check(shopper_key(request, user))
    if wait is not None:
        audit.record_event(
            customer="logged_in" if user else "guest",
            page_type=body.page_context.page_type,
            stop_reason="rate_limited: agent not called",
            result=f"retry after {wait}s",
        )
        minutes = math.ceil(wait / 60)
        when = f"{wait} seconds" if wait < 90 else f"about {minutes} minutes"
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(wait)},
            content={"detail": f"You're sending messages faster than we can answer. Please wait {when} and try again."},
        )
    # Logged-in customers: history comes from the database (the browser's copy is ignored).
    # Guests: the browser sends the current conversation, which is never stored.
    history = memory.load_agent_history(user["id"]) if user else body.history
    deps = build_deps(user, body.page_context)
    try:
        response = await run_chat(message, history, deps)
    except ChatNotConfigured:
        logger.error("Chat is not configured: no model API key in the environment.")
        raise HTTPException(status_code=503, detail="The shop assistant isn't available right now.")
    except Exception as error:
        # Log only the error type: provider errors can echo request details.
        logger.error("Chat request failed: %s", type(error).__name__)
        raise HTTPException(
            status_code=502, detail="The shop assistant ran into a problem. Please try again."
        )
    if user:
        memory.save_exchange(user["id"], message, response.reply, response.products)
    return response
