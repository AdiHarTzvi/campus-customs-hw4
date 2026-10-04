"""Product data access for the API routes and the tools the chat agent can call.

The product routes in main.py and the agent tools below share the same read-only
database helpers, so the website and the chatbot always see the same data.
"""

import json
import re
import sqlite3
from pathlib import Path

from models import (
    AlternativeMatch,
    AlternativesResult,
    ProductInfoResult,
    ProductMatch,
    ProductRef,
    ProductSearchResult,
    SizeStockResult,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "campus_customs.db"

SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"]
MAX_SEARCH_RESULTS = 10


# ---------- Shared database helpers ----------

def connect() -> sqlite3.Connection:
    # Read-only: product data is never written. Account writes go through auth.py.
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def size_rank(size: str) -> int:
    return SIZE_ORDER.index(size) if size in SIZE_ORDER else len(SIZE_ORDER)


def load_inventory(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    by_product: dict[str, list[dict]] = {}
    for row in conn.execute("SELECT product_id, size, quantity FROM inventory"):
        by_product.setdefault(row["product_id"], []).append(
            {"size": row["size"], "quantity": row["quantity"]}
        )
    for sizes in by_product.values():
        sizes.sort(key=lambda item: size_rank(item["size"]))
    return by_product


def product_from_row(row: sqlite3.Row, inventory: list[dict]) -> dict:
    return {
        "product_id": row["product_id"],
        "name": row["name"],
        "garment_type": row["garment_type"],
        "description": row["description"],
        "colors": json.loads(row["colors"]),
        "search_tags": json.loads(row["search_tags"]),
        "image_file_path": row["image_file_path"],
        "image_url": "/media/" + row["image_file_path"],
        "price": row["price"],
        "inventory": inventory,
        "total_stock": sum(item["quantity"] for item in inventory),
    }


def get_all_products() -> list[dict]:
    with connect() as conn:
        inventory = load_inventory(conn)
        rows = conn.execute("SELECT * FROM catalogue ORDER BY name").fetchall()
    return [product_from_row(row, inventory.get(row["product_id"], [])) for row in rows]


def get_product(product_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM catalogue WHERE product_id = ?", (product_id,)
        ).fetchone()
        if row is None:
            return None
        sizes = conn.execute(
            "SELECT size, quantity FROM inventory WHERE product_id = ?", (product_id,)
        ).fetchall()
    inventory = sorted(
        ({"size": s["size"], "quantity": s["quantity"]} for s in sizes),
        key=lambda item: size_rank(item["size"]),
    )
    return product_from_row(row, inventory)


def get_products_by_ids(product_ids: list[str]) -> list[dict]:
    """Products in the given order; unknown ids are silently dropped."""
    by_id = {p["product_id"]: p for p in get_all_products()}
    seen: set[str] = set()
    result = []
    for product_id in product_ids:
        if product_id in by_id and product_id not in seen:
            seen.add(product_id)
            result.append(by_id[product_id])
    return result


def _in_stock_sizes(product: dict) -> list[str]:
    return [item["size"] for item in product["inventory"] if item["quantity"] > 0]


# Multi-word product terms are joined into one token so they match as a unit:
# "T-shirt", "t shirt", "tees" -> "tshirt"; "quarter-zip", "1/4 zip", "1 4 zip" -> "quarterzip";
# "hoodie"/"hooded"/"hood" -> "hood".
_PHRASES = [
    # A "crew-neck T-shirt" is a T-shirt, not a crewneck sweatshirt.
    (re.compile(r"\bcrew[\s-]?neck\s+(?=t[\s-]?shirt)"), " "),
    (re.compile(r"\bt[\s-]?shirts?\b"), " tshirt "),
    (re.compile(r"\btees?\b"), " tshirt "),
    (re.compile(r"\b(?:quarter|1/4|1 4)[\s-]?zips?\b"), " quarterzip "),
    (re.compile(r"\bfull[\s-]?zips?\b"), " fullzip "),
    (re.compile(r"\bcrew[\s-]?necks?\b"), " crewneck "),
    # "hoodie", "hoodies", "hooded", "hood" all mean the same garment.
    (re.compile(r"\bhood(?:ie|ies|ed|s)?\b"), " hood "),
]


def _words(text: str) -> list[str]:
    text = text.lower()
    for pattern, replacement in _PHRASES:
        text = pattern.sub(replacement, text)
    return re.findall(r"[a-z0-9]+", text)


def _stem(word: str) -> str:
    return word.rstrip("s") if len(word) > 3 else word  # "hoodies" -> "hoodie"


# Filler words that can appear when the model passes a whole sentence as the query.
_STOPWORDS = {
    "a", "an", "and", "any", "anything", "are", "can", "do", "does", "for", "have", "i", "in",
    "is", "it", "me", "my", "of", "on", "or", "please", "show", "some", "something", "that",
    "the", "there", "to", "under", "what", "which", "with", "you", "your", "got", "sell", "carry",
    "looking", "want", "need", "find", "get", "buy", "see", "options", "items", "products",
}


def _keywords(query: str) -> list[str]:
    """Search keywords: normalized, stemmed, filler and single letters dropped, deduplicated."""
    return list(dict.fromkeys(_stem(w) for w in _words(query) if len(w) > 1 and w not in _STOPWORDS))


def _field_words(product: dict) -> tuple[list[str], list[str], list[str]]:
    other = " ".join([product["description"], *product["colors"], *product["search_tags"]])
    return _words(product["name"]), _words(product["garment_type"]), _words(other)


def _hit(keyword: str, words: list[str]) -> bool:
    # Match at the start of a word: "hoodie" matches "hoodies", "crew" matches "crewneck",
    # but "shirt" does not match "sweatshirt".
    return any(word.startswith(keyword) for word in words)


def _matches(keyword: str, product: dict) -> bool:
    return any(_hit(keyword, words) for words in _field_words(product))


# Customers say "large" or "2XL"; the database uses XS, S, M, L, XL, XXL.
SIZE_ALIASES = {
    "xs": "XS", "x-small": "XS", "xsmall": "XS", "extra small": "XS", "extra-small": "XS",
    "s": "S", "small": "S", "sm": "S",
    "m": "M", "medium": "M", "med": "M",
    "l": "L", "large": "L", "lg": "L",
    "xl": "XL", "x-large": "XL", "xlarge": "XL", "extra large": "XL", "extra-large": "XL",
    "xxl": "XXL", "2xl": "XXL", "2x": "XXL", "xx-large": "XXL", "xxlarge": "XXL",
    "double xl": "XXL", "extra extra large": "XXL",
}


def normalize_size(size: str) -> str | None:
    """Map a customer's size wording to a database size, or None if unrecognized."""
    cleaned = " ".join(size.strip().lower().split())
    if cleaned.upper() in SIZE_ORDER:
        return cleaned.upper()
    return SIZE_ALIASES.get(cleaned)


def _suggest(text: str, limit: int = 3) -> list[ProductRef]:
    """Products whose name/description match `text`, for failed lookups by id."""
    words = _keywords(text.replace("-", " "))
    if not words:
        return []
    scored = []
    for product in get_all_products():
        hits = sum(_matches(w, product) for w in words)
        if hits:
            scored.append((hits, product))
    scored.sort(key=lambda item: (-item[0], item[1]["name"]))
    return [ProductRef(product_id=p["product_id"], name=p["name"]) for _, p in scored[:limit]]


def _not_found(product_id: str) -> tuple[str, list[ProductRef]]:
    return (
        f"No product with product_id '{product_id}'. Do not guess its details. "
        "Use one of did_you_mean (if it is clearly the product the customer meant) or call search_products.",
        _suggest(product_id),
    )


# ---------- Agent tools ----------
# Plain functions: PydanticAI reads their signatures and docstrings to build the tool
# schemas the model sees, so the docstrings are written for the model. Each returns a
# small Pydantic model (see models.py) built only from database values.

def search_products(
    query: str = "",
    max_price: float | None = None,
    min_price: float | None = None,
    size: str | None = None,
    in_stock_only: bool = False,
    limit: int = 8,
) -> ProductSearchResult:
    """Search the catalogue to find products and their product_id values.

    Use this to browse or recommend, or to find the product_id of a product the customer
    names, before calling get_product_info or check_size_stock.

    Args:
        query: Keywords matched against product name, garment type, description, colors, and
            tags, e.g. "hoodie", "navy crewneck", "Davenport", "hockey", "quarter zip".
            Leave empty to browse everything (combined with the filters).
        max_price: Only include products at or below this price in USD.
        min_price: Only include products at or above this price in USD.
        size: Only include products with this size in stock (XS, S, M, L, XL, XXL, or words like
            "large"). For browsing only; to check one product's size use check_size_stock.
        in_stock_only: Only include products with at least one size in stock.
        limit: Maximum number of results (1-10).

    Returns:
        total_matches; matched_all_keywords (False means no product matched every keyword, so
        results only partially match); keywords_with_no_matches (e.g. a color the shop doesn't
        carry); and products with product_id, name, garment_type, price, colors (the colors that
        appear on that item, not separate color options), and total_stock.
    """
    words = _keywords(query)
    wanted_size = normalize_size(size) if size else None
    limit = max(1, min(limit, MAX_SEARCH_RESULTS))

    all_products = get_all_products()
    fields = {p["product_id"]: _field_words(p) for p in all_products}
    # Product-type keywords (words that appear in some product's garment type, like "hoodie",
    # "crewneck", "jacket") must match a product's name or garment type. Other keywords
    # ("navy", "crest", "Davenport") may match anywhere: name, description, colors, or tags.
    title_words = {w for w in words if any(_hit(w, f[1]) for f in fields.values())}

    candidates = []
    for product in all_products:
        if max_price is not None and product["price"] > max_price:
            continue
        if min_price is not None and product["price"] < min_price:
            continue
        if size and wanted_size not in _in_stock_sizes(product):
            continue
        if in_stock_only and product["total_stock"] == 0:
            continue

        name, garment, other = fields[product["product_id"]]
        score, matched, strict = 0, 0, 0
        for word in words:
            in_title = _hit(word, name) or _hit(word, garment)
            if _hit(word, name):
                score, matched = score + 3, matched + 1
            elif _hit(word, garment):
                score, matched = score + 2, matched + 1
            elif _hit(word, other):
                score, matched = score + 1, matched + 1
            else:
                continue
            if in_title or word not in title_words:
                strict += 1
        candidates.append((score, matched, strict, product))

    # Tiers: 1) every keyword matched, with product-type keywords in the name/garment type
    # ("hoodies" -> actual hoodies, not T-shirts whose description mentions a hood);
    # 2) every keyword anywhere; 3) any keyword, reported as a partial match.
    n = len(words)
    scored = [(s, p) for s, m, t, p in candidates if t == n]
    if not scored:
        scored = [(s, p) for s, m, t, p in candidates if m == n]
    matched_all = bool(scored) or not words
    if not scored:
        scored = [(s, p) for s, m, t, p in candidates if m > 0]

    scored.sort(key=lambda item: (-item[0], item[1]["name"]))
    return ProductSearchResult(
        total_matches=len(scored),
        matched_all_keywords=matched_all,
        keywords_with_no_matches=[w for w in words if not any(_matches(w, p) for p in all_products)],
        products=[ProductMatch.model_validate(product) for _, product in scored[:limit]],
    )


def get_product_info(product_id: str) -> ProductInfoResult:
    """Look up one product's description, price, colors, total stock, and stock for every size.

    Call this whenever the customer asks about a specific product's description, price, how
    many are in stock, or which sizes are available.

    Args:
        product_id: The exact product_id from search_products results.

    Returns:
        found=True with name, description, price (USD), colors (the colors that appear on this
        one item, e.g. a gray body with a red crest; each product comes in one colorway, not a
        choice of colors), total_stock (units across all sizes), and stock_by_size (quantity per
        size; 0 means sold out). found=False with a
        message and did_you_mean suggestions if the id doesn't exist.
    """
    product = get_product(product_id)
    if product is None:
        message, suggestions = _not_found(product_id)
        return ProductInfoResult(found=False, product_id=product_id, message=message, did_you_mean=suggestions)
    return ProductInfoResult(
        found=True,
        product_id=product["product_id"],
        name=product["name"],
        description=product["description"],
        price=product["price"],
        colors=product["colors"],
        total_stock=product["total_stock"],
        stock_by_size=product["inventory"],
    )


def check_size_stock(product_id: str, size: str) -> SizeStockResult:
    """Check whether one size of one product is in stock, and how many units there are.

    Call this whenever the customer asks about a specific size of a specific product.

    Args:
        product_id: The exact product_id from search_products results.
        size: The size asked about: XS, S, M, L, XL, XXL, or words like "large" or "2XL".

    Returns:
        found=True with size (normalized), quantity, in_stock (False means sold out in that
        size), and other_sizes_in_stock. found=False with a message if the product or size
        doesn't exist (plus did_you_mean suggestions for an unknown product).
    """
    product = get_product(product_id)
    if product is None:
        message, suggestions = _not_found(product_id)
        return SizeStockResult(found=False, product_id=product_id, message=message, did_you_mean=suggestions)

    normalized = normalize_size(size)
    stock = {item["size"]: item["quantity"] for item in product["inventory"]}
    if normalized is None or normalized not in stock:
        return SizeStockResult(
            found=False,
            product_id=product["product_id"],
            name=product["name"],
            size=size,
            other_sizes_in_stock=_in_stock_sizes(product),
            message=f"'{size}' is not a size offered for this product. Offered sizes: {', '.join(stock) or 'none'}.",
        )
    quantity = stock[normalized]
    return SizeStockResult(
        found=True,
        product_id=product["product_id"],
        name=product["name"],
        size=normalized,
        quantity=quantity,
        in_stock=quantity > 0,
        other_sizes_in_stock=[s for s in _in_stock_sizes(product) if s != normalized],
    )


# Same groups the website uses for its category filters (frontend/src/api.ts categoryOf).
def _category(product: dict) -> str:
    garment = product["garment_type"].lower()
    if "quarter-zip" in garment:
        return "quarter-zip"
    if "jacket" in garment or "fleece" in garment:
        return "jacket"
    if "hood" in garment:
        return "hoodie"
    if "t-shirt" in garment or re.search(r"\bshirt\b", garment):
        return "T-shirt"
    return "crewneck"


# Words that appear on many products and say nothing about a product's theme.
_GENERIC_WORDS = {
    "yale", "campus", "custom", "customs", "college", "school", "university", "the", "of", "and",
    "logo", "left", "chest", "tshirt", "hood", "crewneck", "quarterzip", "fullzip", "sweatshirt",
    "pullover", "long", "sleeve", "short", "shirt", "merch", "gear", "apparel", "collegiate",
    "graphic", "classic", "sports", "sport", "tri", "blend", "vintage", "zip", "jacket", "fleece",
    "crest", "shield", "navy", "gray", "grey", "heather", "white", "blue", "black", "big", "basic",
}


def _theme_words(product: dict) -> set[str]:
    """Distinctive words (college, school, sport, event) from the name and tags."""
    words = _words(" ".join([product["name"], *product["search_tags"]]))
    return {w for w in words if len(w) > 2 and not w.isdigit() and w not in _GENERIC_WORDS}


_RESIDENTIAL_COLLEGE_TAG = re.compile(r"^[A-Z][a-z]+(?: [A-Z][a-z]+)* College$")


def _is_residential_college(product: dict) -> bool:
    """Tagged with a Yale residential college, e.g. "Davenport College" or "Grace Hopper College"."""
    return any(_RESIDENTIAL_COLLEGE_TAG.match(tag) for tag in product["search_tags"])


def find_alternatives(product_id: str, size: str | None = None, limit: int = 4) -> AlternativesResult:
    """Find similar products that are in stock, in a given size if one is provided.

    Call this when check_size_stock says a size is sold out (pass that size), or when a
    product is sold out entirely, so you can offer real alternatives instead of guessing.

    Args:
        product_id: The exact product_id of the product the customer wanted.
        size: The size they need (XS, S, M, L, XL, XXL, or words like "large"). Optional.
        limit: Maximum number of alternatives (1-6).

    Returns:
        found=True with alternatives: products that have stock (in that size, if given), most
        similar first, each with price, colors, total_stock, quantity_in_size, and shared (why
        it's similar). An empty list means nothing similar is in stock; say so. found=False if
        the product id doesn't exist.
    """
    original = get_product(product_id)
    if original is None:
        message, suggestions = _not_found(product_id)
        return AlternativesResult(found=False, product_id=product_id, message=message, did_you_mean=suggestions)

    wanted = normalize_size(size) if size else None
    if size and wanted is None:
        return AlternativesResult(
            found=False,
            product_id=original["product_id"],
            name=original["name"],
            size=size,
            message=f"'{size}' is not a recognized size. Sizes are XS, S, M, L, XL, XXL.",
        )

    category = _category(original)
    residential = _is_residential_college(original)
    themes = _theme_words(original)
    colors = {c.lower() for c in original["colors"]}
    limit = max(1, min(limit, 6))

    ranked = []
    for product in get_all_products():
        if product["product_id"] == original["product_id"]:
            continue
        stock = {item["size"]: item["quantity"] for item in product["inventory"]}
        if (stock.get(wanted, 0) if wanted else product["total_stock"]) <= 0:
            continue
        shared, score = [], 0
        if _category(product) == category:
            shared.append(f"same type: {category}")
            score += 3
        common_themes = sorted(themes & _theme_words(product))
        if common_themes:
            shared.append("same theme: " + ", ".join(common_themes))
            score += 2 * len(common_themes)
        if residential and _is_residential_college(product):
            shared.append("also a residential college design")
            score += 2
        common_colors = sorted(colors & {c.lower() for c in product["colors"]})
        if common_colors:
            shared.append("same color: " + ", ".join(common_colors))
            score += 1
        if score >= 3:  # at least the same type, or a shared theme plus a color
            ranked.append((score, product, shared, stock.get(wanted) if wanted else None))

    ranked.sort(key=lambda item: (-item[0], item[1]["name"]))
    return AlternativesResult(
        found=True,
        product_id=original["product_id"],
        name=original["name"],
        size=wanted,
        alternatives=[
            AlternativeMatch(**ProductMatch.model_validate(p).model_dump(), quantity_in_size=qty, shared=shared)
            for _, p, shared, qty in ranked[:limit]
        ],
    )


AGENT_TOOLS = [search_products, get_product_info, check_size_stock, find_alternatives]
