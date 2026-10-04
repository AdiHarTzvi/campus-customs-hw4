"""Structured models shared by the chat endpoint, the agent, and the frontend."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

MAX_MESSAGE_LENGTH = 2000
MAX_HISTORY_MESSAGES = 20
MAX_PRODUCT_CARDS = 10  # matches the search_products result limit


# ---------- What the model must return (PydanticAI output_type) ----------

class AgentReply(BaseModel):
    """The agent's structured answer.

    The model only chooses *which* products to show (by id). The backend then builds the
    product cards from the database, so card prices, sizes, and stock are never model-written.
    """

    reply: str = Field(
        description="Friendly, concise answer for the customer. Plain text; **bold** and '- ' bullet lists are allowed."
    )
    product_ids: list[str] = Field(
        default_factory=list,
        max_length=MAX_PRODUCT_CARDS,
        description=(
            "product_id values, copied exactly from this turn's tool results, for the products to "
            "show as cards on the page. For a search, all returned matches in the tool's order. "
            "Empty when no product cards are relevant or nothing matched."
        ),
    )


# ---------- Shared ----------

class SizeStock(BaseModel):
    size: str
    quantity: int


# ---------- Tool results (what the agent's tools return to the model) ----------
# Kept deliberately small: only the fields needed to answer product, price, and stock
# questions reliably. Everything comes straight from the database.

class ProductRef(BaseModel):
    """Enough to name a product and look it up again."""

    product_id: str
    name: str


class ProductMatch(ProductRef):
    """One search result: enough to choose between products and answer price questions."""

    garment_type: str
    price: float
    colors: list[str] = Field(
        description="Colors that appear on this one item (garment and print), not color options to choose from."
    )
    total_stock: int


class ProductSearchResult(BaseModel):
    total_matches: int
    matched_all_keywords: bool
    keywords_with_no_matches: list[str]
    products: list[ProductMatch]


class ProductInfoResult(BaseModel):
    """Description, price, and stock for one product. found=False means the lookup failed."""

    found: bool
    product_id: str
    name: str | None = None
    description: str | None = None
    price: float | None = None
    colors: list[str] = Field(
        default_factory=list,
        description="Colors that appear on this one item (garment and print), not color options to choose from.",
    )
    total_stock: int | None = None
    stock_by_size: list[SizeStock] = Field(default_factory=list)
    message: str | None = None
    did_you_mean: list[ProductRef] = Field(default_factory=list)


class SizeStockResult(BaseModel):
    """Stock for one size of one product. found=False means the product or size wasn't found."""

    found: bool
    product_id: str
    name: str | None = None
    size: str | None = None
    quantity: int | None = None
    in_stock: bool | None = None
    other_sizes_in_stock: list[str] = Field(default_factory=list)
    message: str | None = None
    did_you_mean: list[ProductRef] = Field(default_factory=list)


class AlternativeMatch(ProductMatch):
    """A similar product that is in stock (in the requested size, if one was given)."""

    quantity_in_size: int | None = None  # units in the requested size; None if no size given
    shared: list[str] = Field(
        default_factory=list,
        description="Why it's similar, e.g. 'same type: quarter-zip', 'same theme: trumbull', 'same color: heather gray'.",
    )


class AlternativesResult(BaseModel):
    """In-stock alternatives to one product. found=False means the product wasn't found."""

    found: bool
    product_id: str
    name: str | None = None
    size: str | None = None
    alternatives: list[AlternativeMatch] = Field(default_factory=list)
    message: str | None = None
    did_you_mean: list[ProductRef] = Field(default_factory=list)


# ---------- Product card sent to the frontend ----------


class ProductCard(BaseModel):
    """Everything a product card on the page needs, read from the database."""

    product_id: str
    name: str
    garment_type: str
    description: str  # short product information (the card shows the first lines)
    price: float
    image_url: str
    colors: list[str]
    inventory: list[SizeStock]
    total_stock: int


class SearchSummary(BaseModel):
    """The customer's catalogue search this turn: the agent's first search_products result."""

    query: str
    total_matches: int
    # False when nothing matched the request exactly (zero matches, or e.g. "baseball caps"
    # only matching baseball apparel), so the page labels any cards as related products.
    exact_match: bool


# ---------- /api/chat request and response ----------

class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_LENGTH * 4)
    # For assistant turns: the product cards that were shown, in display order, so
    # follow-ups like "the last one" or "the second hoodie" resolve correctly.
    product_ids: list[str] = Field(default_factory=list, max_length=MAX_PRODUCT_CARDS)


PageType = Literal["home", "products", "product", "about", "login", "signup", "other"]


class PageContext(BaseModel):
    """What the shopper is looking at when they send a message (sent by the frontend)."""

    page_type: PageType = "other"
    path: str = Field(default="/", max_length=300)
    # Set on a product detail page (/products/<product_id>), so "this" can be resolved.
    product_id: str | None = Field(default=None, max_length=200)
    # Products page filters, if any (?q=... and ?category=...).
    search_query: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=50)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    # Earlier turns of this conversation, oldest first, so follow-ups ("in pink?") have context.
    # Used for guests only; for logged-in customers the backend loads history from the database.
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=MAX_HISTORY_MESSAGES)
    page_context: PageContext = Field(default_factory=PageContext)


class ChatResponse(BaseModel):
    # The assistant's text, shown in the chat bubble.
    reply: str
    # Structured product matches, rendered as product cards on the page. Built from the
    # database, never from model-written text.
    products: list[ProductCard] = Field(default_factory=list)
    # Present when the agent searched the catalogue this turn (even with zero matches).
    search: SearchSummary | None = None


# ---------- Saved chat history (GET /api/chat/history) ----------

class SavedChatMessage(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    products: list[ProductCard] = Field(default_factory=list)
    created_at: str


class ChatHistoryResponse(BaseModel):
    # False for guests: there is no saved history, and the chat starts empty on each visit.
    logged_in: bool
    messages: list[SavedChatMessage] = Field(default_factory=list)


# ---------- Agent dependencies (PydanticAI deps) ----------

@dataclass(frozen=True)
class CustomerInfo:
    """The only customer fields the agent receives. No password hash, session, or user id."""

    first_name: str | None
    name: str
    email: str


@dataclass(frozen=True)
class CurrentProduct:
    """The product on the page the shopper is viewing, read from the database."""

    product_id: str
    name: str


@dataclass(frozen=True)
class ChatDeps:
    customer: CustomerInfo | None  # None for guests
    page: PageContext
    current_product: CurrentProduct | None  # set when page.product_id is a real product
