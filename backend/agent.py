"""PydanticAI agent setup: model, system prompt, tools, and the chat entry point."""

import os
import time
from pathlib import Path

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # keep server logs clean

from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import UsageLimits
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from models import (
    AgentReply,
    AlternativesResult,
    ChatDeps,
    ChatHistoryMessage,
    CurrentProduct,
    CustomerInfo,
    PageContext,
    ChatResponse,
    ProductCard,
    ProductInfoResult,
    ProductSearchResult,
    SearchSummary,
    SizeStockResult,
)
import audit
from tools import AGENT_TOOLS, get_product, get_products_by_ids

BACKEND_DIR = Path(__file__).resolve().parent

PROMPT_PATH = BACKEND_DIR / "prompts" / "prompt.md"
SYSTEM_PROMPT = PROMPT_PATH.read_text(encoding="utf-8")

MODEL_NAME = "gpt-5.6-luna"  # project-standard OpenAI model

# Agent-loop limits per customer message: model requests (each tool round trip is one) and
# total tool calls. Normal questions use 2-4 requests and 1-3 tool calls.
RUN_LIMITS = UsageLimits(request_limit=8, tool_calls_limit=12)
OUTPUT_RETRIES = 2  # times the model may fix an answer that doesn't match AgentReply

LIMIT_REPLY = (
    "Sorry, I couldn't finish looking that up. Could you ask about one product or "
    "category at a time?"
)


class ChatNotConfigured(RuntimeError):
    pass


def _build_model() -> OpenAIChatModel:
    # The key comes from environment variables only (main.py loads the optional hw4/.env).
    # Portkey is an OpenAI-compatible gateway; fall back to OpenAI directly if only
    # OPENAI_API_KEY is set. The key is never logged or returned.
    portkey_key = os.getenv("PORTKEY_API_KEY")
    api_key = portkey_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ChatNotConfigured("Set PORTKEY_API_KEY (or OPENAI_API_KEY) in the environment or hw4/.env.")
    base_url = os.getenv("PORTKEY_BASE_URL") or os.getenv("OPENAI_BASE_URL") or (
        "https://api.portkey.ai/v1" if portkey_key else "https://api.openai.com/v1"
    )
    return OpenAIChatModel(MODEL_NAME, provider=OpenAIProvider(base_url=base_url, api_key=api_key))


def context_instructions(ctx: RunContext[ChatDeps]) -> str:
    """Per-request instructions built from the run's dependencies: who is chatting and
    what page they are on. Added after the static system prompt on every model call."""
    deps = ctx.deps
    lines = ["## This conversation"]

    if deps.customer:
        first = deps.customer.first_name or deps.customer.name.split(" ")[0]
        lines.append(
            f"- Customer: logged in as {deps.customer.name} (first name: {first}, email: {deps.customer.email})."
        )
    else:
        lines.append("- Customer: a guest (not logged in). You don't know their name or email.")

    page = deps.page
    if deps.current_product:
        lines.append(
            f"- Page: the shopper is viewing the product page for **{deps.current_product.name}** "
            f"(product_id `{deps.current_product.product_id}`)."
        )
        lines.append(
            "- Words like \"this\", \"it\", \"this one\", or a question with no product named "
            "(\"in XL?\", \"in pink?\") refer to this product. Use this product_id directly with "
            "get_product_info or check_size_stock; no search is needed. If they clearly name a "
            "different product, answer about that one instead."
        )
    elif page.page_type == "product":
        lines.append(
            f"- Page: a product page for product_id `{page.product_id}`, which is not in the catalogue. "
            "If they ask about \"this\", say you couldn't identify the product."
        )
    else:
        descriptions = {
            "home": "the home page",
            "products": "the Products (catalogue) page",
            "about": "the About Us page",
            "login": "the log-in page",
            "signup": "the create-account page",
        }
        where = descriptions.get(page.page_type, f"the page {page.path}")
        extra = []
        if page.category:
            extra.append(f"category filter '{page.category}'")
        if page.search_query:
            extra.append(f"search '{page.search_query}'")
        lines.append(f"- Page: the shopper is on {where}" + (f" ({', '.join(extra)})." if extra else "."))
        lines.append("- No single product is open, so if they say \"this\" without context, ask which product they mean.")
    return "\n".join(lines)


_agent: Agent[ChatDeps, AgentReply] | None = None


def get_agent() -> Agent[ChatDeps, AgentReply]:
    """Create the agent on first use so the API still starts if the key is missing."""
    global _agent
    if _agent is None:
        _agent = Agent(
            _build_model(),
            deps_type=ChatDeps,
            output_type=AgentReply,
            instructions=[SYSTEM_PROMPT, context_instructions],
            tools=AGENT_TOOLS,
            retries=OUTPUT_RETRIES,
        )
    return _agent


def build_deps(user: dict | None, page: PageContext) -> ChatDeps:
    """Copy only the customer fields the agent may see, and resolve the page's product."""
    customer = (
        CustomerInfo(first_name=user["first_name"], name=user["name"], email=user["email"])
        if user
        else None
    )
    current_product = None
    if page.page_type == "product" and page.product_id:
        product = get_product(page.product_id)
        if product:
            current_product = CurrentProduct(product_id=product["product_id"], name=product["name"])
    return ChatDeps(customer=customer, page=page, current_product=current_product)


def _to_message_history(history: list[ChatHistoryMessage]) -> list[ModelMessage]:
    messages: list[ModelMessage] = []
    for item in history:
        if item.role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=item.content)]))
        else:
            content = item.content
            if item.product_ids:
                shown = ", ".join(f"{i}. {pid}" for i, pid in enumerate(item.product_ids, 1))
                content += f"\n\n[Product cards shown to the customer, in order: {shown}]"
            messages.append(ModelResponse(parts=[TextPart(content=content)]))
    return messages


def _tool_results(messages: list[ModelMessage]) -> tuple[set[str], SearchSummary | None]:
    """Product ids returned by this turn's tool calls, and a summary of the catalogue search.

    The summary describes the first search, which is the customer's actual request. If the
    agent then searched again for alternatives (e.g. "umbrella" found nothing, so it searched
    "jacket"), the request is still reported as not matched exactly.
    """
    queries: dict[str, str] = {}
    for message in messages:
        for part in getattr(message, "parts", []):
            if isinstance(part, ToolCallPart) and part.tool_name == "search_products":
                queries[part.tool_call_id] = str(part.args_as_dict().get("query", ""))

    seen_ids: set[str] = set()
    search: SearchSummary | None = None
    for message in messages:
        for part in getattr(message, "parts", []):
            if not isinstance(part, ToolReturnPart):
                continue
            content = part.content
            if isinstance(content, ProductSearchResult):
                seen_ids.update(p.product_id for p in content.products)
                if search is None:
                    search = SearchSummary(
                        query=queries.get(part.tool_call_id, ""),
                        total_matches=content.total_matches,
                        exact_match=content.total_matches > 0
                        and content.matched_all_keywords
                        and not content.keywords_with_no_matches,
                    )
            elif isinstance(content, (ProductInfoResult, SizeStockResult)) and content.found:
                seen_ids.add(content.product_id)
            elif isinstance(content, AlternativesResult) and content.found:
                seen_ids.add(content.product_id)
                seen_ids.update(alt.product_id for alt in content.alternatives)
    return seen_ids, search


async def run_chat(message: str, history: list[ChatHistoryMessage], deps: ChatDeps) -> ChatResponse:
    run_id = audit.new_run_id()
    started = time.monotonic()
    context = {
        "customer": "logged_in" if deps.customer else "guest",
        "page_type": deps.page.page_type,
        "product_id": deps.current_product.product_id if deps.current_product else None,
    }

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        result = await get_agent().run(
            message, message_history=_to_message_history(history), deps=deps, usage_limits=RUN_LIMITS
        )
    except UsageLimitExceeded as error:
        audit.append_entries(
            audit.run_entries(run_id, [], **context, stop_reason=f"usage_limit_exceeded: {audit.safe_text(error, 100)}", duration_ms=elapsed(), model=MODEL_NAME)
        )
        return ChatResponse(reply=LIMIT_REPLY)
    except Exception as error:
        audit.append_entries(
            audit.run_entries(run_id, [], **context, stop_reason=f"error: {type(error).__name__}", duration_ms=elapsed(), model=MODEL_NAME)
        )
        raise

    output = result.output
    new_messages = result.new_messages()
    seen_ids, search = _tool_results(new_messages)
    # Cards are built from the database, not from the model. Only ids that a tool actually
    # returned this turn are kept, so the model can't add products it didn't look up.
    card_ids = [pid for pid in output.product_ids if pid in seen_ids]
    dropped = len(output.product_ids) - len(card_ids)
    products = [ProductCard.model_validate(p) for p in get_products_by_ids(card_ids)]

    stop = "completed: final structured reply"
    if dropped:
        stop += f" ({dropped} product id(s) not returned by a tool were dropped)"
    audit.append_entries(
        audit.run_entries(run_id, new_messages, **context, stop_reason=stop, cards_shown=len(products), duration_ms=elapsed(), model=MODEL_NAME)
    )
    return ChatResponse(reply=output.reply, products=products, search=search)
