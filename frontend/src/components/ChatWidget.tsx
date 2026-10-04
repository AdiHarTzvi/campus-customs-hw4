import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  fetchChatHistory,
  formatPrice,
  pageContextFor,
  sendChatMessage,
  type ChatProductCard,
  type ChatTurn,
  type SavedChatMessage,
} from '../api'
import { displayName, useAuth } from '../auth'
import { useChat } from '../chat'
import { Crest } from './Brand'
import { getSavedSize } from '../sizePreference'
import { useProducts } from '../useProducts'

type Message = ChatTurn & {
  id: number
  products?: ChatProductCard[]
  isError?: boolean
}

const WELCOME_ID = 0

function welcome(firstName?: string): Message {
  return {
    id: WELCOME_ID,
    role: 'assistant',
    content: firstName
      ? `Hi ${firstName}, I'm the Campus Customs shop assistant. Ask me about sizes, colors, or finding the right Bulldog gear.`
      : "Hi, I'm the Campus Customs shop assistant. Ask me about sizes, colors, or finding the right Bulldog gear.",
  }
}

// Saved messages use negative ids so they never collide with new ones (nextId counts up).
function fromSaved(saved: SavedChatMessage): Message {
  return { id: -saved.id, role: saved.role, content: saved.content, products: saved.products }
}

const SUGGESTIONS = ['What hoodies do you have?', 'Anything for my residential college?', 'Gifts under $40']

let nextId = 1

// Up to this many products also appear as mini cards inside the chat; larger result sets
// are shown only on the page (ChatResults) to keep the chat readable.
const INLINE_CARD_LIMIT = 3

// Renders the small subset of formatting the assistant uses: **bold**, "- " bullets, line breaks.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  )
}

function FormattedText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>,
      )
      bullets = []
    }
  }
  text.split('\n').forEach((line) => {
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/)
    if (bullet) {
      bullets.push(bullet[1])
      return
    }
    flush()
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>)
  })
  flush()
  return <>{blocks}</>
}

function ChatProduct({ product }: { product: ChatProductCard }) {
  const sizesInStock = product.inventory.filter((item) => item.quantity > 0).map((item) => item.size)
  return (
    <Link to={`/products/${product.product_id}`} className="chat-product">
      <img src={product.image_url} alt="" loading="lazy" />
      <div className="chat-product-body">
        <p className="chat-product-name">{product.name}</p>
        <p className="chat-product-price">{formatPrice(product.price)}</p>
        <p className={`chat-product-stock ${sizesInStock.length ? '' : 'is-out'}`}>
          {sizesInStock.length ? `In stock: ${sizesInStock.join(', ')}` : 'Sold out'}
        </p>
      </div>
    </Link>
  )
}

// The customer message an assistant reply answered, used as the results panel heading.
function questionBefore(messages: Message[], assistantId: number): string {
  const index = messages.findIndex((m) => m.id === assistantId)
  for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content
  return 'your earlier question'
}

export default function ChatWidget() {
  const { isOpen, open, close, draft, setDraft, showResults, clearResults } = useChat()
  const { user, checking } = useAuth()
  const location = useLocation()
  const [messages, setMessages] = useState<Message[]>([welcome()])
  const [isTyping, setIsTyping] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const { data: catalogue } = useProducts()
  const listRef = useRef<HTMLDivElement>(null)

  // On a product page, show which product "this" means and offer one-tap questions about it.
  const pageContext = pageContextFor(location.pathname, location.search)
  const pageProduct = pageContext.product_id
    ? catalogue?.find((p) => p.product_id === pageContext.product_id)
    : undefined
  const preferredSize = getSavedSize()
  const productQuestions = pageProduct
    ? [
        preferredSize ? `Do you have this in ${preferredSize}?` : 'Which sizes are in stock?',
        'How many are left?',
        'Show me similar styles',
      ]
    : []
  const inputRef = useRef<HTMLInputElement>(null)

  // Whenever the signed-in account changes (log in, log out, switch user), start from a clean
  // chat so nothing from one account is ever shown to another, then restore the new account's
  // saved history. Guests start fresh on every page load.
  const accountKey = checking ? 'checking' : (user?.id ?? 'guest')
  const [loadedFor, setLoadedFor] = useState<number | string>('checking')
  if (accountKey !== loadedFor) {
    setLoadedFor(accountKey)
    setMessages([welcome(user ? displayName(user) : undefined)])
    setRestoring(typeof accountKey === 'number')
  }

  // Results on the page belong to the previous account's conversation too.
  useEffect(() => {
    clearResults()
  }, [accountKey, clearResults])

  useEffect(() => {
    if (typeof accountKey !== 'number') return
    let active = true
    fetchChatHistory()
      .then((data) => {
        if (!active || !data.logged_in) return
        setMessages((current) => [current[0], ...data.messages.map(fromSaved), ...current.slice(1)])
      })
      .catch(() => undefined) // The chat still works; only the restore failed.
      .finally(() => active && setRestoring(false))
    return () => {
      active = false
    }
  }, [accountKey])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isTyping])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  async function send(text: string) {
    const content = text.trim()
    if (!content || isTyping) return

    // Earlier turns give the agent context for follow-ups; the greeting and errors are UI-only.
    // (Only used for guests; the backend loads a logged-in customer's history itself.)
    const history: ChatTurn[] = messages
      .filter((m) => m.id !== WELCOME_ID && !m.isError)
      .map(({ role, content: c, products }) => ({
        role,
        content: c,
        product_ids: products?.map((p) => p.product_id) ?? [],
      }))

    setMessages((current) => [...current, { id: nextId++, role: 'user', content }])
    setDraft('')
    setIsTyping(true)
    try {
      const { reply, products, search } = await sendChatMessage(content, history, pageContext)
      setMessages((current) => [...current, { id: nextId++, role: 'assistant', content: reply, products }])
      // Product matches go on the page; a search with no matches shows an empty state there.
      // Skip it when the only card is the product already open on this page.
      const onlyCurrentProduct =
        products.length === 1 && products[0].product_id === pageContext.product_id && !search
      if ((products.length > 0 && !onlyCurrentProduct) || search?.total_matches === 0) {
        showResults({ question: content, products, search })
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: nextId++, role: 'assistant', content: (error as Error).message, isError: true },
      ])
    } finally {
      setIsTyping(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    send(draft)
  }

  return (
    <div className="chat">
      {isOpen && (
        <section className="chat-panel" aria-label="Campus Customs chat">
          <header className="chat-header">
            <div className="chat-avatar" aria-hidden="true">
              <Crest size={26} />
            </div>
            <div>
              <p className="chat-title">Campus Customs</p>
              <p className="chat-status">
                <span className="chat-online" aria-hidden="true" />
                Shop assistant · checks live stock
              </p>
            </div>
            <button className="chat-close" onClick={close} aria-label="Close chat">
              ×
            </button>
          </header>

          {pageProduct && (
            <div className="chat-context" data-chat-context>
              <img src={pageProduct.image_url} alt="" />
              <p>
                <span>Asking about</span>
                <strong>{pageProduct.name}</strong>
              </p>
            </div>
          )}

          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.map((message) => (
              <Fragment key={message.id}>
                <div className={`chat-bubble ${message.role} ${message.isError ? 'is-error' : ''}`}>
                  {message.role === 'assistant' ? <FormattedText text={message.content} /> : message.content}
                </div>
                {message.products && message.products.length > 0 && message.products.length <= INLINE_CARD_LIMIT && (
                  <div className="chat-products">
                    {message.products.map((product) => (
                      <ChatProduct key={product.product_id} product={product} />
                    ))}
                  </div>
                )}
                {message.products && message.products.length > INLINE_CARD_LIMIT && (
                  <button
                    className="chat-page-note"
                    onClick={() =>
                      showResults({
                        question: questionBefore(messages, message.id),
                        products: message.products ?? [],
                        search: null,
                      })
                    }
                  >
                    Show these {message.products.length} products on the page ↑
                  </button>
                )}
              </Fragment>
            ))}
            {isTyping && (
              <div className="chat-bubble assistant typing" aria-label="Assistant is typing">
                <span />
                <span />
                <span />
              </div>
            )}
            {restoring && <p className="chat-restoring">Loading your previous chat…</p>}
            {messages.length === 1 && !restoring && productQuestions.length === 0 && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          {productQuestions.length > 0 && (
            <div className="chat-quick" aria-label="Quick questions about this product">
              {productQuestions.map((question) => (
                <button key={question} onClick={() => send(question)} disabled={isTyping}>
                  {question}
                </button>
              ))}
            </div>
          )}

          <form className="chat-input" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={pageProduct ? `Ask about the ${pageProduct.name}…` : 'Ask about a product…'}
              aria-label="Message"
              maxLength={2000}
            />
            <button type="submit" disabled={!draft.trim() || isTyping}>
              Send
            </button>
          </form>
        </section>
      )}

      <button
        className={`chat-launcher ${isOpen ? 'is-open' : ''}`}
        onClick={() => (isOpen ? close() : open())}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <span className="chat-launcher-x">×</span>
        ) : (
          <>
            <span className="chat-launcher-crest" aria-hidden="true">
              <Crest size={22} />
            </span>
            <span className="chat-launcher-text">
              Ask us
              <small>Sizes, stock &amp; gifts</small>
            </span>
          </>
        )}
      </button>
    </div>
  )
}
