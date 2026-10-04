# Usability improvements (Problem 9)

Four improvements, chosen because of what the data and earlier testing showed:

- About **a quarter of products are sold out in any given size** (22–27 products per size). Shoppers were opening product pages only to find their size gone, and when the chatbot said "sold out" it had no reliable way to suggest something that *was* available.
- The chat already understood which product a shopper was viewing (Problem 8), but **nothing on screen said so**, so shoppers had no reason to trust "Do you have this in XL?".
- Every chat message is a **paid model call**, and nothing limited how many a single visitor could send.

| # | Improvement | Type | Where to find it |
|---|---|---|---|
| 1 | Shop by your size | Front-end | Products page, "Your size" bar under the search box |
| 2 | Product-aware chat | Front-end | Any product page → open the chat |
| 3 | In-stock alternatives tool | Agent/backend | Ask the chat about a sold-out size |
| 4 | Chat rate limiting | Agent/backend | Send many chat messages quickly |

---

## 1. Shop by your size

**Type:** Front-end

**What I added**

- A **"Your size"** bar on the Products page (`frontend/src/pages/Products.tsx`) with chips for Any, XS, S, M, L, XL, XXL.
- Choosing a size shows only products **in stock in that size**, using the per-size inventory the API already returns. The result count ("77 products in stock in XL") and the category chip counts ("Hoodies 21") update to match.
- Each card shows availability in that size: "In stock in XL" or "Only 2 left in XL" (`ProductCard.tsx`).
- The size is **remembered in the browser** (`frontend/src/sizePreference.ts`, `localStorage`): it is re-applied the next time the shopper opens the catalogue (the URL becomes `/products?size=XL`, so it can also be shared), and product pages **pre-select it** when it's in stock. Picking a size on a product page updates the remembered size. Choosing **Any** clears it.

**Why it helps**

Apparel shopping starts with "what's in my size?". With roughly 25 products sold out in each size, browsing without this means repeatedly opening products that can't be bought. The filter removes those dead ends, the low-stock line creates honest urgency, and remembering the size saves a step on every product page. For the business, fewer dead-end clicks mean fewer abandoned visits.

**How to verify**

1. Open **Products** and click **XL** in the "Your size" bar → "77 products in stock in XL", category counts drop (Hoodies 21, Crewnecks 23, Quarter-zips 9, Tees & tops 17, Jackets & fleece 7), and every card says "In stock in XL" or "Only N left in XL". Trumbull 1 4 Zip (sold out in XL) disappears.
   - Check: `SELECT COUNT(*) FROM inventory WHERE size='XL' AND quantity>0;` → 77.
2. Reload `/products` → the XL filter comes back on its own (`?size=XL`).
3. Open **Morse 1 4 Zip** → XL is already selected ("25 in stock in XL"). Open **Trumbull 1 4 Zip** → nothing is pre-selected, because XL is sold out there.
4. Click **Any** to clear the remembered size.

---

## 2. Product-aware chat

**Type:** Front-end

**What I added** (`frontend/src/components/ChatWidget.tsx`)

- On any product page, the chat shows an **"Asking about: <product name>"** strip with the product's thumbnail, directly under the chat header.
- The input placeholder becomes "Ask about the Trumbull 1 4 Zip…".
- **One-tap questions** about that product appear above the input: "Do you have this in XL?" (using the remembered size from improvement 1, or "Which sizes are in stock?" if none), "How many are left?", and "Show me similar styles".
- These use the existing structured page context (`page_type: "product"`, `product_id`) from Problem 8, so the agent resolves "this" to the product shown in the strip.

**Why it helps**

Shoppers can see that the assistant knows which product they mean, so they can type naturally ("is this in pink?") instead of copying product names. The quick questions turn the most common product-page questions (size, stock, alternatives) into a single tap, which matters on phones. Paired with improvement 1, "Do you have this in XL?" is personalized to the shopper's size.

**How to verify**

1. Open any product page (e.g. **Trumbull 1 4 Zip**) and click **Ask us**. Under the header: "ASKING ABOUT · Trumbull 1 4 Zip" with its image; placeholder "Ask about the Trumbull 1 4 Zip…".
2. Tap **Do you have this in XL?** (with XL chosen in improvement 1). The reply is about the Trumbull specifically ("sold out in XL; in stock in XS, M, L").
3. Go to the Home or Products page: the strip and quick questions disappear, because no single product is open.

---

## 3. In-stock alternatives tool

**Type:** Agent/backend

**What I added**

- A new agent tool, **`find_alternatives(product_id, size=None, limit=4)`** in `backend/tools.py`, returning a new structured model **`AlternativesResult`** (`backend/models.py`).
  - It returns only products **with stock in the requested size** (or any stock if no size is given), excluding the original.
  - They're ranked by similarity: same garment type (+3), shared theme words from the name/tags such as a college, school, or sport (+2 each), also a residential-college design (+2), shared colors (+1).
  - Each alternative includes `quantity_in_size` and a `shared` list explaining why it's similar ("same type: quarter-zip", "same theme: hockey", "also a residential college design").
  - Unknown products and sizes return `found: false` with a message, like the other tools.
- The system prompt now tells the agent: after saying a size is sold out, call `find_alternatives`, suggest up to 3 with a short reason, and put the sold-out product first in the product cards, followed by the alternatives.
- `agent.py` counts ids returned by this tool as "looked up this turn", so alternative cards pass the Problem 7 check against invented cards.

**Why it helps**

"Sold out in XL" is a dead end; "sold out in XL, but the Branford and Morse 1/4 zips have XL" keeps the sale. Before this tool, the agent could only guess at alternatives with a keyword search, which could easily suggest products that were *also* sold out in that size. Now every suggestion is confirmed in stock in the size the customer needs, making the agent both more helpful and more accurate.

**How to verify**

1. On the **Trumbull 1 4 Zip** page, ask "Do you have this in XL?" (or tap the quick question). The reply says XL is sold out and suggests Branford, Morse, and Berkeley 1/4 Zips. Cards for the Trumbull plus the alternatives appear on the page.
   - Check: `SELECT product_id, quantity FROM inventory WHERE size='XL' AND product_id IN ('branford-1-4-zip','morse-1-4-zip','berkeley-1-4-zip');` → 5, 25, 8 (all in stock).
2. Ask "I need a large Saybrook Logo T-Shirt" → sold out in L, with T-shirt alternatives that have L in stock.
3. Ask about a size that **is** in stock (e.g. Trumbull in L) → no alternatives offered; the tool isn't needed.

---

## 4. Chat rate limiting

**Type:** Agent/backend

**What I added** (`backend/main.py`)

- A sliding-window **`ChatRateLimiter`** on `POST /api/chat`: by default **10 messages per minute and 60 per hour** per shopper. Shoppers are identified by account when logged in (`user:<id>`), otherwise by browser address (`ip:<address>`). The Vite proxy now sends `X-Forwarded-For` (`xfwd: true` in `vite.config.ts`) so guests aren't all counted as one.
- Over the limit, the endpoint answers immediately with **HTTP 429**, a `Retry-After` header, and a friendly message ("You're sending messages faster than we can answer. Please wait 39 seconds and try again."), which the chat shows as an error bubble. **No model call is made.**
- Limits are configurable with `CHAT_RATE_LIMIT_PER_MINUTE` and `CHAT_RATE_LIMIT_PER_HOUR` (documented in `.env.example`).

**Why it helps**

Each message costs money and takes 3–8 seconds of model time. Without a limit, a stuck script, a bored visitor, or a deliberate abuser could run up the bill and slow the assistant for everyone. The limit is generous for real shoppers (a human rarely sends 10 questions a minute) and fails gracefully with a clear wait time instead of a broken chat.

**How to verify**

The default is 10 per minute. To see it quickly, restart the backend with a low limit from `backend/`:

```bash
CHAT_RATE_LIMIT_PER_MINUTE=3 uvicorn main:app --reload --port 8000
```

Then send 4 chat messages within a minute on the website. Messages 1–3 get normal replies; message 4 immediately shows "You're sending messages faster than we can answer. Please wait N seconds and try again." The backend log shows `429 Too Many Requests` for it. Restart without the variable afterwards.

---

## Verification summary (run in the real app)

| Check | Result |
|---|---|
| 1. Size filter | XL → 77 products (database: 77), counts per category updated, no sold-out items, low-stock lines shown; reload keeps XL; Morse page pre-selects XL ("25 in stock"); Trumbull (XL sold out) doesn't |
| 2. Product-aware chat | "Asking about Trumbull 1 4 Zip" strip with thumbnail, placeholder, three quick questions; the quick question answered about the Trumbull |
| 3. Alternatives | "XL is sold out… Alternatives available in XL: Branford, Morse, Berkeley" (XL stock 5, 25, 8); the agent called `check_size_stock` then `find_alternatives`; cards rendered on the page |
| 4. Rate limiting | With a limit of 3/min: messages 1–3 answered, message 4 → 429 in 0.2 s with a friendly wait message in the chat; unit test confirms separate buckets per user and the hourly limit |
| Problems 3–8 regression | Products (102), product detail, 404; login, wrong password (401), duplicate signup (409); guest chat search ("hoodies", 27 matches, 10 cards); logged-in chat with page context saved 2 rows and restored history (12 messages); guest has no history; Problem 6 fact test 9/9 |
