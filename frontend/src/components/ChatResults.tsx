import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useChat } from '../chat'
import ProductCard from './ProductCard'

// Product matches from the shop assistant, rendered on the page with the same ProductCard
// used by the Products page, so each card links to its existing /products/:id page.
export default function ChatResults() {
  const { results, clearResults } = useChat()
  const { pathname } = useLocation()
  const sectionRef = useRef<HTMLElement>(null)
  const resultsId = results?.id

  // The panel is expanded for the page where the results arrived (or where the customer
  // clicks "Show results"). After navigating away, e.g. opening a product from the results,
  // it collapses to a slim bar so the new page is visible.
  const [expanded, setExpanded] = useState<{ id?: number; path?: string }>({})
  const [lastId, setLastId] = useState<number | undefined>(undefined)
  if (resultsId !== lastId) {
    setLastId(resultsId)
    setExpanded({ id: resultsId, path: pathname })
  }
  const collapsed = expanded.id !== resultsId || expanded.path !== pathname

  // Bring each new set of results into view.
  useEffect(() => {
    if (resultsId) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [resultsId])

  if (!results) return null

  if (collapsed) {
    return (
      <div className="chat-results-bar" data-chat-results data-chat-results-bar>
        <div className="container chat-results-bar-inner">
          <span>
            Shop assistant results for <q>{results.question}</q>
            {results.products.length > 0 && ` (${results.products.length})`}
          </span>
          <span className="chat-results-bar-actions">
            <button className="text-link" onClick={() => setExpanded({ id: resultsId, path: pathname })}>
              Show results
            </button>
            <button className="chat-results-close" onClick={clearResults} aria-label="Hide these results">
              ×
            </button>
          </span>
        </div>
      </div>
    )
  }

  const { question, products, search } = results
  const total = search?.total_matches ?? products.length
  const related = Boolean(search && !search.exact_match)
  const browseLink =
    search?.query && search.total_matches > 0 ? `/products?q=${encodeURIComponent(search.query)}` : '/products'

  return (
    <section ref={sectionRef} className="chat-results" aria-label="Products from the shop assistant" data-chat-results>
      <div className="container">
        <div className="chat-results-head">
          <div>
            <p className="eyebrow">From the shop assistant</p>
            <h2>
              Results for <q>{question}</q>
            </h2>
            <p className="chat-results-meta">
              {products.length === 0
                ? 'No matching products in our catalogue.'
                : related
                  ? 'No exact matches. Showing related products from our catalogue.'
                  : total > products.length
                  ? `Showing ${products.length} of ${total} matches.`
                  : `${products.length} ${products.length === 1 ? 'product' : 'products'}.`}{' '}
              <Link to={browseLink} className="text-link">
                {products.length === 0 || browseLink === '/products' ? 'Browse all products →' : 'See all in the catalogue →'}
              </Link>
            </p>
          </div>
          <button className="chat-results-close" onClick={clearResults} aria-label="Hide these results">
            ×
          </button>
        </div>

        {products.length > 0 && (
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product.product_id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
