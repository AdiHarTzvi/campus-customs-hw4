import { useState } from 'react'
import { Link } from 'react-router-dom'
import { categoryLabel, categoryOf, displayDescription, formatPrice, LOW_STOCK, type SizeStock } from '../api'
import { Swatch } from '../components/Brand'
import ProductCard from '../components/ProductCard'
import { getSavedSize, saveSize } from '../sizePreference'
import { useChat } from '../chat'
import { useProduct, useProducts } from '../useProducts'

function stockMessage(item: SizeStock | undefined): { text: string; tone: 'ok' | 'low' | 'out' } | null {
  if (!item) return null
  if (item.quantity === 0) return { text: `Size ${item.size} is sold out`, tone: 'out' }
  if (item.quantity <= LOW_STOCK) return { text: `Only ${item.quantity} left in ${item.size}`, tone: 'low' }
  return { text: `${item.quantity} in stock in ${item.size}`, tone: 'ok' }
}

export default function ProductDetail({ productId }: { productId: string }) {
  const { data: product, error, loading } = useProduct(productId)
  const { data: allProducts } = useProducts()
  const { open: openChat } = useChat()
  // Start with the shopper's remembered size (set on the Products page); it's ignored below
  // if that size is sold out for this product.
  const [selectedSize, setSelectedSize] = useState<string | null>(() => getSavedSize())

  if (loading) {
    return (
      <div className="container page detail-grid" aria-busy="true">
        <div className="detail-image skeleton" />
        <div className="detail-info">
          <div className="skeleton skeleton-line wide" />
          <div className="skeleton skeleton-line" />
        </div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="container page empty">
        <h1>{error === 'not-found' ? 'Product not found' : "We couldn't load this product"}</h1>
        <p>It may have been removed, or the backend isn't running.</p>
        <Link to="/products" className="btn btn-primary">
          Back to all products
        </Link>
      </div>
    )
  }

  const category = categoryOf(product)
  const selected = product.inventory.find((item) => item.size === selectedSize && item.quantity > 0)
  const message = stockMessage(selected)
  const soldOut = product.inventory.length > 0 && product.total_stock === 0
  const sizesInStock = product.inventory.filter((item) => item.quantity > 0).length
  const related = (allProducts ?? [])
    .filter((p) => p.product_id !== product.product_id && categoryOf(p) === category)
    .slice(0, 4)

  return (
    <div className="page">
      <div className="container">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/products">Products</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/products?category=${category}`}>{categoryLabel(category)}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{product.name}</span>
        </nav>

        <div className="detail-grid">
          <div className="detail-media">
            <div className="detail-image">
              <img src={product.image_url} alt={product.name} />
            </div>
          </div>

          <div className="detail-info">
            <p className="eyebrow">{product.garment_type}</p>
            <h1>{product.name}</h1>
            <div className="detail-price-row">
              <p className="detail-price">{formatPrice(product.price)}</p>
              {product.inventory.length > 0 && (
                <span className={`stock-pill ${soldOut ? 'is-out' : sizesInStock <= 2 ? 'is-low' : ''}`}>
                  {soldOut
                    ? 'Sold out'
                    : sizesInStock <= 2
                      ? `Limited: ${sizesInStock} ${sizesInStock === 1 ? 'size' : 'sizes'} left`
                      : `In stock in ${sizesInStock} of ${product.inventory.length} sizes`}
                </span>
              )}
            </div>
            <p className="detail-desc">{displayDescription(product)}</p>

            <div className="detail-block">
              <p className="detail-label">Colorway</p>
              <ul className="color-list">
                {product.colors.map((color) => (
                  <li key={color}>
                    <Swatch color={color} />
                    {color}
                  </li>
                ))}
              </ul>
            </div>

            <div className="detail-block">
              <div className="detail-label-row">
                <p className="detail-label">Size</p>
                <p className="detail-total">
                  {product.inventory.length === 0
                    ? 'Size information unavailable'
                    : soldOut
                      ? 'Sold out in all sizes'
                      : `${product.total_stock} units available`}
                </p>
              </div>
              {product.inventory.length > 0 && (
                <div className="size-grid" role="radiogroup" aria-label="Choose a size">
                  {product.inventory.map((item) => (
                    <button
                      key={item.size}
                      role="radio"
                      aria-checked={selected?.size === item.size}
                      disabled={item.quantity === 0}
                      className={`size-option ${selected?.size === item.size ? 'is-selected' : ''} ${
                        item.quantity > 0 && item.quantity <= LOW_STOCK ? 'is-low' : ''
                      }`}
                      onClick={() => {
                        setSelectedSize(item.size)
                        saveSize(item.size)
                      }}
                    >
                      <span className="size-name">{item.size}</span>
                      <span className="size-qty">
                        {item.quantity === 0 ? 'Sold out' : `${item.quantity} left`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {message && <p className={`stock-msg stock-${message.tone}`}>{message.text}</p>}
            </div>

            <div className="detail-actions">
              <button
                className="btn btn-primary btn-block"
                disabled={soldOut || !selected || selected.quantity === 0}
                title="Checkout is coming in a later version"
              >
                {soldOut ? 'Sold out' : selected ? 'Add to bag (coming soon)' : 'Select a size'}
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => openChat(`Do you have the ${product.name} in my size?`)}
              >
                Ask about this item
              </button>
            </div>

            <ul className="detail-assurances">
              <li>Stock shown live from our shop, size by size</li>
              <li>Questions about fit or sizes? Our shop assistant can help</li>
              <li>Try it on in person at 57 Broadway, New Haven</li>
            </ul>

            {product.search_tags.length > 0 && (
              <ul className="tag-list" aria-label="Tags">
                {product.search_tags.map((tag) => (
                  <li key={tag}>
                    <Link to={`/products?q=${encodeURIComponent(tag)}`}>#{tag}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="section related">
            <div className="section-head">
              <h2>More {categoryLabel(category).toLowerCase()}</h2>
              <Link to={`/products?category=${category}`} className="text-link">
                See all →
              </Link>
            </div>
            <div className="product-grid">
              {related.map((p) => (
                <ProductCard key={p.product_id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
