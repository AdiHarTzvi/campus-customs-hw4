export type SizeStock = {
  size: string
  quantity: number
}

export type Product = {
  product_id: string
  name: string
  garment_type: string
  description: string
  colors: string[]
  search_tags: string[]
  image_file_path: string
  image_url: string
  price: number
  inventory: SizeStock[]
  total_stock: number
}

const REQUEST_TIMEOUT_MS = 8000

async function getJson<T>(url: string): Promise<T> {
  // Fail instead of spinning forever if the backend or proxy never answers.
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(
    (error: Error) => {
      throw new Error(error.name === 'TimeoutError' ? 'timeout' : 'network')
    },
  )
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'not-found' : `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const fetchProducts = () => getJson<Product[]>('/api/products')

export const fetchProduct = (productId: string) =>
  getJson<Product>(`/api/products/${encodeURIComponent(productId)}`)

export const formatPrice = (price: number) =>
  price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const LOW_STOCK = 5

// garment_type values in the database are inconsistent ("hoodie", "pullover hoodie",
// "short-sleeve T-shirt", ...), so the shop groups them into a few clean categories.
export const CATEGORIES = [
  { slug: 'hoodies', label: 'Hoodies' },
  { slug: 'crewnecks', label: 'Crewnecks' },
  { slug: 'quarter-zips', label: 'Quarter-zips' },
  { slug: 'tees', label: 'Tees & tops' },
  { slug: 'jackets', label: 'Jackets & fleece' },
] as const

export type CategorySlug = (typeof CATEGORIES)[number]['slug']

export function categoryOf(product: Product): CategorySlug {
  const type = product.garment_type.toLowerCase()
  if (type.includes('quarter-zip')) return 'quarter-zips'
  if (type.includes('jacket') || type.includes('fleece')) return 'jackets'
  if (type.includes('hood')) return 'hoodies'
  if (type.includes('t-shirt') || /\bshirt\b/.test(type)) return 'tees'
  return 'crewnecks'
}

export function categoryLabel(slug: CategorySlug): string {
  return CATEGORIES.find((category) => category.slug === slug)?.label ?? slug
}

// ---------- Accounts ----------

// Never includes the password hash: the backend strips it before responding.
export type User = {
  id: number
  first_name: string | null
  last_name: string | null
  name: string
  email: string
  created_at: string
}

export type FieldErrors = Partial<Record<string, string>>

export class ApiError extends Error {
  status: number
  fields: FieldErrors

  constructor(message: string, status: number, fields: FieldErrors = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

async function authRequest(path: string, body?: unknown): Promise<{ user: User | null }> {
  let response: Response
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new ApiError("We couldn't reach the server. Please try again.", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data?.detail
    throw new ApiError(detail?.message ?? 'Something went wrong. Please try again.', response.status, detail?.fields)
  }
  return data
}

export type SignupInput = {
  first_name: string
  last_name: string
  email: string
  password: string
  confirm_password: string
}

export const fetchCurrentUser = () => authRequest('me')
export const signupRequest = (input: SignupInput) => authRequest('signup', input)
export const loginRequest = (email: string, password: string) => authRequest('login', { email, password })
export const logoutRequest = () => authRequest('logout', {})

// ---------- Shop assistant chat ----------

// Product cards are built by the backend from the database (not written by the model).
export type ChatProductCard = Pick<
  Product,
  'product_id' | 'name' | 'garment_type' | 'description' | 'price' | 'image_url' | 'colors' | 'inventory' | 'total_stock'
>

// The customer's catalogue search this turn (the agent's first search_products result).
// exact_match is false when only related products matched (e.g. "caps" -> baseball apparel).
export type ChatSearchSummary = { query: string; total_matches: number; exact_match: boolean }

// product_ids: cards shown with an assistant turn, so follow-ups like "the last one" have context.
export type ChatTurn = { role: 'user' | 'assistant'; content: string; product_ids?: string[] }

// reply: text for the chat bubble. products: structured matches rendered as cards on the page.
export type ChatReply = { reply: string; products: ChatProductCard[]; search: ChatSearchSummary | null }

const CHAT_TIMEOUT_MS = 60000
export const MAX_CHAT_HISTORY = 20

// What the shopper is looking at, so the agent can resolve "this" on a product page.
export type PageContext = {
  page_type: 'home' | 'products' | 'product' | 'about' | 'login' | 'signup' | 'other'
  path: string
  product_id: string | null
  search_query: string | null
  category: string | null
}

export function pageContextFor(pathname: string, search: string): PageContext {
  const params = new URLSearchParams(search)
  const productMatch = pathname.match(/^\/products\/([^/]+)\/?$/)
  const base = { path: pathname, product_id: null, search_query: null, category: null }
  if (productMatch) return { ...base, page_type: 'product', product_id: decodeURIComponent(productMatch[1]) }
  if (pathname === '/products') {
    return { ...base, page_type: 'products', search_query: params.get('q'), category: params.get('category') }
  }
  const simple: Record<string, PageContext['page_type']> = { '/': 'home', '/about': 'about', '/login': 'login', '/signup': 'signup' }
  return { ...base, page_type: simple[pathname] ?? 'other' }
}

export async function sendChatMessage(
  message: string,
  history: ChatTurn[],
  pageContext: PageContext,
): Promise<ChatReply> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // history is only used for guests; logged-in history is loaded on the server.
      body: JSON.stringify({ message, history: history.slice(-MAX_CHAT_HISTORY), page_context: pageContext }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(
      (error as Error).name === 'TimeoutError'
        ? 'The assistant took too long to answer. Please try again.'
        : "We couldn't reach the shop assistant. Please check your connection and try again.",
    )
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : null
    throw new Error(detail ?? 'The shop assistant ran into a problem. Please try again.')
  }
  return data as ChatReply
}

export type SavedChatMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  products: ChatProductCard[]
  created_at: string
}

// The logged-in customer's saved chat (from the session cookie); guests get logged_in: false.
export async function fetchChatHistory(): Promise<{ logged_in: boolean; messages: SavedChatMessage[] }> {
  const response = await fetch('/api/chat/history', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Could not load chat history (${response.status})`)
  return response.json()
}

// A few catalogue rows have a placeholder description from the data import
// ("Campus Customs product photo (...). Vision blocked; filename-based stub.").
// Show an honest fallback instead of that text.
export function isPlaceholderDescription(description: string): boolean {
  return /vision blocked|filename-based stub/i.test(description)
}

export function displayDescription(product: Pick<Product, 'description' | 'garment_type'>): string {
  return isPlaceholderDescription(product.description)
    ? `${product.garment_type.charAt(0).toUpperCase()}${product.garment_type.slice(1)}. A full description is coming soon; ask our shop assistant for details.`
    : product.description
}
