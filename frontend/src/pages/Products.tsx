import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CATEGORIES, categoryOf, type Product } from '../api'
import ProductCard from '../components/ProductCard'
import { getSavedSize, saveSize, SIZES } from '../sizePreference'
import { useProducts } from '../useProducts'

type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'name'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name', label: 'Name A–Z' },
]

function matchesQuery(product: Product, query: string): boolean {
  if (!query) return true
  const haystack = [product.name, product.garment_type, product.description, ...product.colors, ...product.search_tags]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

function sortProducts(products: Product[], sort: SortKey): Product[] {
  const sorted = [...products]
  switch (sort) {
    case 'price-asc':
      return sorted.sort((a, b) => a.price - b.price)
    case 'price-desc':
      return sorted.sort((a, b) => b.price - a.price)
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    default:
      // In-stock items first, otherwise keep the catalogue order.
      return sorted.sort((a, b) => Number(b.total_stock > 0) - Number(a.total_stock > 0))
  }
}

function hasSize(product: Product, size: string | null): boolean {
  return !size || product.inventory.some((item) => item.size === size && item.quantity > 0)
}

export default function Products() {
  const { data: products, error, loading, retry } = useProducts()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'all'
  const query = params.get('q') ?? ''
  const sort = (params.get('sort') as SortKey) ?? 'featured'
  const sizeParam = params.get('size')
  const size = sizeParam && (SIZES as readonly string[]).includes(sizeParam) ? sizeParam : null

  // Re-apply the shopper's remembered size once, when they arrive at the catalogue.
  const appliedSavedSize = useRef(false)
  useEffect(() => {
    if (appliedSavedSize.current) return
    appliedSavedSize.current = true
    const saved = getSavedSize()
    if (saved && !params.has('size')) {
      const next = new URLSearchParams(params)
      next.set('size', saved)
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  function chooseSize(next: string | null) {
    saveSize(next)
    update('size', next ?? '', '')
  }


  function update(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params)
    if (!value || value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const visible = useMemo(() => {
    if (!products) return []
    const filtered = products.filter(
      (p) => (category === 'all' || categoryOf(p) === category) && matchesQuery(p, query.trim()) && hasSize(p, size),
    )
    return sortProducts(filtered, sort)
  }, [products, category, query, sort, size])

  // Category counts reflect the size filter, so shoppers see how much is left in their size.
  const counts = useMemo(() => {
    const inStock = (products ?? []).filter((p) => hasSize(p, size))
    const result: Record<string, number> = { all: inStock.length }
    inStock.forEach((p) => {
      const slug = categoryOf(p)
      result[slug] = (result[slug] ?? 0) + 1
    })
    return result
  }, [products, size])

  return (
    <div className="page">
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">The collection</p>
          <h1>Shop Bulldog apparel</h1>
          <p className="page-lede">
            Residential colleges, graduate schools, varsity sports, and everyday Yale classics, with
            live stock for every size.
          </p>
        </div>
      </section>

      <div className="container">
        <section className="filter-panel" aria-label="Search and filter products">
          <div className="filter-top">
            <label className="search">
              <span className="sr-only">Search products</span>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M10 4a6 6 0 1 0 3.9 10.6l4.7 4.7 1.4-1.4-4.7-4.7A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
                />
              </svg>
              <input
                type="search"
                placeholder="Search: Davenport, hockey, gray…"
                value={query}
                onChange={(event) => update('q', event.target.value, '')}
              />
            </label>
            <label className="select">
              <span className="select-label">Sort</span>
              <select value={sort} onChange={(event) => update('sort', event.target.value, 'featured')}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="filter-row">
            <span className="filter-label">Category</span>
            <div className="chips" role="tablist" aria-label="Filter by category">
              <button
                role="tab"
                aria-selected={category === 'all'}
                className={`chip ${category === 'all' ? 'is-active' : ''}`}
                onClick={() => update('category', 'all', 'all')}
              >
                All <span>{counts.all}</span>
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.slug}
                  role="tab"
                  aria-selected={category === c.slug}
                  className={`chip ${category === c.slug ? 'is-active' : ''}`}
                  onClick={() => update('category', c.slug, 'all')}
                >
                  {c.label} <span>{counts[c.slug] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-row size-filter" role="group" aria-label="Shop by your size">
            <span className="filter-label size-filter-label">Your size</span>
            <div className="chips">
              <button
                className={`size-chip ${size === null ? 'is-active' : ''}`}
                aria-pressed={size === null}
                onClick={() => chooseSize(null)}
              >
                Any
              </button>
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={`size-chip ${size === s ? 'is-active' : ''}`}
                  aria-pressed={size === s}
                  onClick={() => chooseSize(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="size-filter-hint">
              {size ? `Showing only styles in stock in ${size}. We'll remember your size.` : 'Pick a size to hide styles that are sold out in it.'}
            </span>
          </div>
        </section>

        {(category !== 'all' || query || size) && (
          <div className="active-filters" aria-label="Active filters">
            <span>Filtered by</span>
            {category !== 'all' && (
              <button onClick={() => update('category', 'all', 'all')}>
                {CATEGORIES.find((c) => c.slug === category)?.label ?? category} <span aria-hidden="true">×</span>
                <span className="sr-only">Remove category filter</span>
              </button>
            )}
            {query && (
              <button onClick={() => update('q', '', '')}>
                “{query}” <span aria-hidden="true">×</span>
                <span className="sr-only">Clear search</span>
              </button>
            )}
            {size && (
              <button onClick={() => chooseSize(null)}>
                Size {size} <span aria-hidden="true">×</span>
                <span className="sr-only">Remove size filter</span>
              </button>
            )}
            <button
              className="active-filters-clear"
              onClick={() => {
                saveSize(null)
                setParams({}, { replace: true })
              }}
            >
              Clear all
            </button>
          </div>
        )}

        {loading && (
          <div className="product-grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="product-card skeleton" />
            ))}
          </div>
        )}

        {error && (
          <div className="notice notice-error notice-row">
            <span>
              We couldn't load the catalogue
              {error === 'timeout' ? ' (the request timed out)' : ''}. Make sure the backend is
              running on port 8000.
            </span>
            <button className="btn btn-ghost btn-sm" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {products && (
          <>
            <p className="result-count">
              {visible.length} {visible.length === 1 ? 'product' : 'products'}
              {size && ` in stock in ${size}`}
            </p>
            {visible.length > 0 ? (
              <div className="product-grid">
                {visible.map((product) => (
                  <ProductCard key={product.product_id} product={product} size={size} />
                ))}
              </div>
            ) : (
              <div className="empty">
                <p>
                  {query ? `No products match “${query}”` : 'No products match these filters'}
                  {size ? ` in size ${size}` : ''}.
                </p>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    saveSize(null)
                    setParams({}, { replace: true })
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
