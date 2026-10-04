"""Append-only audit trail of agent-loop activity: output/audit_trail.json.

The file is a JSON array that only ever grows. New entries are written just before the
closing "]" under an exclusive file lock; earlier bytes are never rewritten or truncated,
so restarts and new runs never clear history. If the file doesn't end the way we expect,
nothing is written (it is never reset).

What is logged: tool names, short summaries of tool arguments and results, and why each
step or run stopped. What is never logged: customer message text, names, emails, user ids,
passwords or hashes, session cookies, API keys, or model output text.
"""

import fcntl
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel

from models import AlternativesResult, ProductInfoResult, ProductSearchResult, SizeStockResult

logger = logging.getLogger("campus_customs")

AUDIT_PATH = Path(__file__).resolve().parent.parent / "output" / "audit_trail.json"
MAX_TEXT = 80  # characters kept from any single argument value
MAX_IDS = 5  # product ids listed in a result summary

_REDACTIONS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"\b(?:sk|pk|key|token)[-_][A-Za-z0-9_-]{8,}\b", re.I), "[secret]"),
    (re.compile(r"pbkdf2_sha256\$\S+"), "[hash]"),
    (re.compile(r"\b[A-Za-z0-9+/_-]{32,}\b"), "[redacted]"),  # long tokens, hashes, keys
    (re.compile(r"\b\d[\d -]{9,}\d\b"), "[number]"),  # card / phone-like numbers
]


def new_run_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _stamp(part) -> str:
    """When a tool result was produced (falls back to now)."""
    ts = getattr(part, "timestamp", None)
    return ts.astimezone(timezone.utc).isoformat(timespec="seconds") if ts else _now()


def safe_text(value: object, limit: int = MAX_TEXT) -> str:
    text = str(value)
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def summarize_args(args: dict | str | None) -> dict:
    """Tool arguments with every value shortened and redacted."""
    if args is None:
        return {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            return {"raw": safe_text(args)}
    return {str(k): (v if isinstance(v, (int, float, bool)) or v is None else safe_text(v)) for k, v in args.items()}


def _ids(items) -> str:
    ids = [item.product_id for item in items][:MAX_IDS]
    more = len(items) - len(ids)
    return ", ".join(ids) + (f" (+{more} more)" if more > 0 else "")


def summarize_result(content: object) -> str:
    """One short line describing what a tool returned (facts and ids only)."""
    if isinstance(content, ProductSearchResult):
        line = f"{content.total_matches} matches; showing {len(content.products)}"
        if not content.matched_all_keywords:
            line += "; partial match"
        if content.keywords_with_no_matches:
            line += f"; no match for {safe_text(', '.join(content.keywords_with_no_matches), 40)}"
        if content.products:
            line += f": {_ids(content.products)}"
        return line
    if isinstance(content, ProductInfoResult):
        if not content.found:
            return f"not found: {safe_text(content.product_id, 60)}"
        return f"{content.product_id}: price ${content.price:.2f}, total_stock {content.total_stock}"
    if isinstance(content, SizeStockResult):
        if not content.found:
            return f"not found: {safe_text(content.product_id, 60)} size {safe_text(content.size, 10)}"
        state = "in stock" if content.in_stock else "SOLD OUT"
        return f"{content.product_id} {content.size}: quantity {content.quantity} ({state})"
    if isinstance(content, AlternativesResult):
        if not content.found:
            return f"not found: {safe_text(content.product_id, 60)}"
        return f"{len(content.alternatives)} in-stock alternatives in {content.size or 'any size'}" + (
            f": {_ids(content.alternatives)}" if content.alternatives else ""
        )
    if isinstance(content, BaseModel):
        return safe_text(content.model_dump_json(), 120)
    return safe_text(content, 120)


def append_entries(entries: list[dict]) -> None:
    """Append entries to the JSON array without touching anything already written."""
    if not entries:
        return
    try:
        AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(AUDIT_PATH, "a+b") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                body = ",\n".join(json.dumps(e, ensure_ascii=False) for e in entries)
                if size == 0:
                    f.write(("[\n" + body + "\n]\n").encode())
                else:
                    # Find the closing bracket at the end of the file (ignoring whitespace).
                    tail_start = max(0, size - 64)
                    f.seek(tail_start)
                    tail = f.read()
                    stripped = tail.rstrip()
                    if not stripped.endswith(b"]"):
                        logger.error("Audit trail does not end with ']'; not writing so nothing is lost.")
                        return
                    close_at = tail_start + len(stripped) - 1
                    f.seek(close_at)
                    f.truncate()  # removes only the final "]" (and trailing newline)
                    separator = b"\n" if stripped[:-1].rstrip().endswith(b"[") else b",\n"
                    f.write(separator + body.encode() + b"\n]\n")
                f.flush()
                os.fsync(f.fileno())
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
    except OSError as error:
        logger.error("Could not write audit trail: %s", type(error).__name__)


def run_entries(
    run_id: str,
    messages: list,
    *,
    customer: str,
    page_type: str,
    product_id: str | None,
    stop_reason: str,
    cards_shown: int | None = None,
    duration_ms: int | None = None,
    model: str | None = None,
) -> list[dict]:
    """Build audit entries for one agent run from its new messages.

    One entry per tool call (with the summarized result and whether the loop continued),
    then one completion entry with the run's stop reason.
    """
    from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart, ToolReturnPart

    calls: dict[str, ToolCallPart] = {}
    entries: list[dict] = []
    step = 0
    finish_reasons: list[str] = []
    base = {"run_id": run_id, "customer": customer, "page": page_type}
    if product_id:
        base["page_product"] = safe_text(product_id, 60)

    for message in messages:
        if isinstance(message, ModelResponse) and message.finish_reason:
            finish_reasons.append(str(message.finish_reason))
        for part in getattr(message, "parts", []):
            if isinstance(part, ToolCallPart) and part.tool_name != "final_result":
                calls[part.tool_call_id] = part
            elif isinstance(part, ToolReturnPart) and part.tool_name != "final_result":
                step += 1
                call = calls.get(part.tool_call_id)
                entries.append(
                    {
                        "timestamp": _stamp(part),
                        **base,
                        "step": step,
                        "tool": part.tool_name,
                        "args": summarize_args(call.args if call else None),
                        "result": summarize_result(part.content),
                        "stop_reason": "tool_returned; loop continued",
                    }
                )
            elif isinstance(part, RetryPromptPart) and part.tool_name and part.tool_name != "final_result":
                step += 1
                call = calls.get(part.tool_call_id)
                entries.append(
                    {
                        "timestamp": _stamp(part),
                        **base,
                        "step": step,
                        "tool": part.tool_name,
                        "args": summarize_args(call.args if call else None),
                        "result": "invalid tool arguments; model asked to retry",
                        "stop_reason": "tool_retry; loop continued",
                    }
                )

    completion = {
        "timestamp": _now(),
        **base,
        "step": step + 1,
        "tool": None,
        "args": {},
        "result": f"{step} tool call(s)" + (f"; {cards_shown} product card(s) returned" if cards_shown is not None else ""),
        "stop_reason": stop_reason,
    }
    if finish_reasons:
        # The structured AgentReply is returned through PydanticAI's output tool, so a normal
        # final answer reports "tool_call" here; "length" or "content_filter" would be problems.
        completion["model_finish_reason"] = finish_reasons[-1]
    if model:
        completion["model"] = model
    if duration_ms is not None:
        completion["duration_ms"] = duration_ms
    entries.append(completion)
    return entries


def record_event(*, customer: str, page_type: str, stop_reason: str, result: str) -> None:
    """A request that ended before the agent ran (for example, rate limited)."""
    append_entries(
        [
            {
                "timestamp": _now(),
                "run_id": new_run_id(),
                "customer": customer,
                "page": page_type,
                "step": 0,
                "tool": None,
                "args": {},
                "result": safe_text(result, 120),
                "stop_reason": stop_reason,
            }
        ]
    )
