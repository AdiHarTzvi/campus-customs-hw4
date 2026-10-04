"""Customer memory: saving and loading logged-in customers' chat history.

Uses the existing `chat_messages` table (id, user_id, role, content, products_json,
created_at). Every query is filtered by the user id from the signed session cookie, so a
customer can only ever read or add to their own history.
"""

import json
import logging
import re

from auth import connect
from models import ChatHistoryMessage, MAX_HISTORY_MESSAGES, ProductCard, SavedChatMessage

logger = logging.getLogger("campus_customs")

MAX_RESTORED_MESSAGES = 100  # shown in the chat window when a customer returns


def _cards_from_json(products_json: str | None) -> list[ProductCard]:
    """Product cards saved with an assistant reply. Malformed entries are skipped."""
    if not products_json:
        return []
    try:
        raw = json.loads(products_json)
    except json.JSONDecodeError:
        return []
    cards = []
    for item in raw if isinstance(raw, list) else []:
        try:
            cards.append(ProductCard.model_validate(item))
        except ValueError:
            continue
    return cards


def load_messages(user_id: int, limit: int = MAX_RESTORED_MESSAGES) -> list[SavedChatMessage]:
    """The user's most recent messages, oldest first."""
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, role, content, products_json, created_at FROM (
                SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?
            ) ORDER BY id
            """,
            (user_id, limit),
        ).fetchall()
    return [
        SavedChatMessage(
            id=row["id"],
            role=row["role"],
            content=row["content"],
            products=_cards_from_json(row["products_json"]) if row["role"] == "assistant" else [],
            created_at=row["created_at"],
        )
        for row in rows
        if row["role"] in ("user", "assistant")
    ]


def load_agent_history(user_id: int) -> list[ChatHistoryMessage]:
    """Recent turns in the format the agent uses, including which cards were shown."""
    return [
        ChatHistoryMessage(
            role=m.role,
            content=m.content,
            product_ids=[card.product_id for card in m.products][:10],
        )
        for m in load_messages(user_id, limit=MAX_HISTORY_MESSAGES)
    ]


# Customers sometimes paste secrets into chat. Saved history keeps the message but not the
# secret: the value in "password is X" / "password: X" and card-like digit runs are replaced.
_SECRET_PATTERNS = [
    (re.compile(r"(?i)\b(pass(?:word|code|phrase)?|pwd)(\s*(?:is|:|=)\s*)\S+"), r"\1\2[redacted]"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[card number redacted]"),
]


def redact_secrets(text: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def save_exchange(user_id: int, user_message: str, reply: str, products: list[ProductCard]) -> None:
    """Store the customer's message and the assistant's reply together (one transaction)."""
    user_message = redact_secrets(user_message)
    reply = redact_secrets(reply)
    cards_json = json.dumps([card.model_dump() for card in products])
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO chat_messages (user_id, role, content, products_json) VALUES (?, 'user', ?, NULL)",
                (user_id, user_message),
            )
            conn.execute(
                "INSERT INTO chat_messages (user_id, role, content, products_json) VALUES (?, 'assistant', ?, ?)",
                (user_id, reply, cards_json),
            )
    except Exception as error:
        # The customer still gets their answer; only the saving failed.
        logger.error("Could not save chat history: %s", type(error).__name__)
