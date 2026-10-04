import { Link } from 'react-router-dom'
import { displayDescription, formatPrice, LOW_STOCK, type Product } from '../api'

// The fields a card needs, so catalogue products and chat results can share this component.
export type CardProduct = Pick<
  Product,
  'product_id' | 'name' | 'garment_type' | 'description' | 'image_url' | 'price' | 'inventory' | 'total_stock'
>

export function StockBadge({ product }: { product: CardProduct }) {
  if (product.inventory.length === 0) return null
  if (product.total_stock === 0) return <span className="badge badge-out">Sold out</span>
  const sizesLeft = product.inventory.filter((item) => item.quantity > 0).length
  if (product.total_stock <= LOW_STOCK * 2 || sizesLeft <= 2) {
    return <span className="badge badge-low">Limited sizes</span>
  }
  return null
}

// Six small boxes, one per size, so shoppers can see availability without opening the product.
function SizeAvailability({ product, highlight }: { product: CardProduct; highlight?: string | null }) {
  if (product.inventory.length === 0) return null
  const inStock = product.inventory.filter((item) => item.quantity > 0).map((item) => item.size)
  return (
    <ul className="card-sizes" aria-label={`In stock: ${inStock.join(', ') || 'none'}`}>
      {product.inventory.map((item) => (
        <li
          key={item.size}
          className={`${item.quantity === 0 ? 'is-out' : ''} ${item.size === highlight ? 'is-highlight' : ''}`}
          aria-hidden="true"
        >
          {item.size}
        </li>
      ))}
    </ul>
  )
}

// size: the shopper's chosen size; the card then shows how many are left in it.
export default function ProductCard({ product, size }: { product: CardProduct; size?: string | null }) {
  const sizeStock = size ? product.inventory.find((item) => item.size === size) : undefined
  return (
    <Link to={`/products/${product.product_id}`} className="product-card">
      <div className="product-card-image">
        <img src={product.image_url} alt={product.name} loading="lazy" />
        <StockBadge product={product} />
        <span className="product-card-cta" aria-hidden="true">
          View details →
        </span>
      </div>
      <div className="product-card-body">
        <p className="product-card-type">{product.garment_type}</p>
        <h3 className="product-card-name">{product.name}</h3>
        <p className="product-card-desc">{displayDescription(product)}</p>
        <div className="product-card-footer">
          <p className="product-card-price">{formatPrice(product.price)}</p>
          {sizeStock && (
            <p className={`product-card-size ${sizeStock.quantity <= LOW_STOCK ? 'is-low' : ''}`}>
              {sizeStock.quantity === 0
                ? `Sold out in ${size}`
                : sizeStock.quantity <= LOW_STOCK
                  ? `Only ${sizeStock.quantity} left in ${size}`
                  : `In stock in ${size}`}
            </p>
          )}
        </div>
        <SizeAvailability product={product} highlight={size} />
      </div>
    </Link>
  )
}
