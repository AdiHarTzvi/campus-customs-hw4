import { Link } from 'react-router-dom'
import { CATEGORIES, categoryOf, formatPrice, type CategorySlug, type Product } from '../api'
import ProductCard from '../components/ProductCard'
import { useChat } from '../chat'
import { useProducts } from '../useProducts'

const HERO_IDS = ['basic-hoodie-big-yale', 'benjamin-franklin-1-4-zip', '2025-yale-vs-harvard-t-shirt']

const FEATURED_IDS = [
  'champion-full-zip-hood',
  'davenport-college-crewneck',
  'yale-law-school-1-4-zip',
  'boola-boola-t-shirt',
  'ice-hockey-left-chest-hoodie',
  'benjamin-franklin-1-4-zip',
  'basic-hoodie-big-yale',
  '2025-yale-vs-harvard-t-shirt',
]

const CATEGORY_BLURBS: Record<CategorySlug, string> = {
  hoodies: 'Heavy, cozy, and built for late nights in the library.',
  crewnecks: 'The classic sweatshirt, from big wordmarks to small crests.',
  'quarter-zips': 'Polished enough for class, relaxed enough for the weekend.',
  tees: 'Everyday tees for game days, move-in, and everything between.',
  jackets: 'Fleece and outer layers for a New England fall.',
}

const ASSISTANT_QUESTIONS = [
  'Do you have a Davenport crewneck in medium?',
  'What hoodies do you have under $70?',
  'Gift ideas for a Yale parent?',
]

const COLLEGE_TAG = /^([A-Z][a-z]+(?: [A-Z][a-z]+)*) College$/

function pick(products: Product[], ids: string[]): Product[] {
  return ids.map((id) => products.find((p) => p.product_id === id)).filter((p): p is Product => Boolean(p))
}

// Same matching as the Products page search box: every word must appear somewhere in the
// product's text, so the count on each college chip equals the results it links to.
function matchesAllWords(product: Product, query: string): boolean {
  const haystack = [product.name, product.garment_type, product.description, ...product.colors, ...product.search_tags]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

// Residential colleges named in the catalogue's tags, with how many products mention each.
function residentialColleges(products: Product[]): { name: string; count: number }[] {
  const names = new Set<string>()
  products.forEach((p) =>
    p.search_tags.forEach((tag) => {
      const match = tag.match(COLLEGE_TAG)
      if (match && !tag.startsWith('Yale')) names.add(match[1])
    }),
  )
  return [...names]
    .map((name) => ({ name, count: products.filter((p) => matchesAllWords(p, name)).length }))
    .filter((college) => college.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function categoryImage(products: Product[], slug: CategorySlug): string | undefined {
  return products.find((p) => categoryOf(p) === slug && p.total_stock > 0)?.image_url
}

export default function Home() {
  const { data: products, error, retry } = useProducts()
  const { open } = useChat()
  const heroProducts = products ? pick(products, HERO_IDS) : []
  const featured = products ? pick(products, FEATURED_IDS) : []
  const colleges = products ? residentialColleges(products) : []
  const spotlight = heroProducts[0]

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Yale apparel · 57 Broadway, New Haven</p>
            <h1>
              Bulldog blue for <em>every corner</em> of campus.
            </h1>
            <p className="hero-lede">
              Residential college crests, graduate school classics, varsity sports, and rivalry-day
              tees, picked for students, alumni, and the families who cheer them on.
            </p>
            <div className="hero-actions">
              <Link to="/products" className="btn btn-primary btn-lg">
                Shop the collection
              </Link>
              <button className="btn btn-ghost btn-lg" onClick={() => open('Can you help me find a gift?')}>
                Ask our shop assistant
              </button>
            </div>
          </div>

          <div className="hero-showcase">
            <div className="hero-pennant" aria-hidden="true" />
            {heroProducts.map((product, index) => (
              <Link
                key={product.product_id}
                to={`/products/${product.product_id}`}
                className={`hero-tile hero-tile-${index + 1}`}
              >
                <img src={product.image_url} alt={product.name} />
              </Link>
            ))}
            {spotlight && (
              <Link to={`/products/${spotlight.product_id}`} className="hero-tag">
                <span className="hero-tag-label">Campus favorite</span>
                <span className="hero-tag-name">{spotlight.name}</span>
                <span className="hero-tag-price">{formatPrice(spotlight.price)}</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="Why shop with us">
        <div className="container trust-grid">
          <div className="trust-item">
            <strong>{products ? products.length : '100+'} styles</strong>
            <span>Hoodies, crewnecks, quarter-zips, tees, and jackets</span>
          </div>
          <div className="trust-item">
            <strong>XS–XXL</strong>
            <span>Live stock for every size, on every product</span>
          </div>
          <div className="trust-item">
            <strong>{colleges.length || 'Every'} residential colleges</strong>
            <span>Plus graduate schools and varsity sports</span>
          </div>
          <div className="trust-item">
            <strong>Real answers</strong>
            <span>Our shop assistant checks stock as you ask</span>
          </div>
        </div>
      </section>

      {error && (
        <div className="container">
          <div className="notice notice-error notice-row">
            <span>We couldn't load products right now.</span>
            <button className="btn btn-ghost btn-sm" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      )}

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="eyebrow">Shop by style</p>
              <h2>Find your fit</h2>
            </div>
            <Link to="/products" className="text-link">
              View all products →
            </Link>
          </div>
          <div className="category-grid">
            {CATEGORIES.map((category) => {
              const image = products ? categoryImage(products, category.slug) : undefined
              return (
                <Link key={category.slug} to={`/products?category=${category.slug}`} className="category-card">
                  <div className="category-image">{image && <img src={image} alt="" loading="lazy" />}</div>
                  <div className="category-body">
                    <h3>{category.label}</h3>
                    <p>{CATEGORY_BLURBS[category.slug]}</p>
                    <span className="category-link" aria-hidden="true">
                      Shop {category.label.toLowerCase()} →
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {colleges.length > 0 && (
        <section className="section section-sky college-section">
          <div className="container">
            <div className="section-head">
              <div>
                <p className="eyebrow">Represent your college</p>
                <h2>Find your residential college</h2>
              </div>
            </div>
            <div className="college-grid">
              {colleges.map((college) => (
                <Link
                  key={college.name}
                  to={`/products?q=${encodeURIComponent(college.name)}`}
                  className="college-chip"
                >
                  <span className="college-initial" aria-hidden="true">
                    {college.name
                      .split(' ')
                      .map((word) => word[0])
                      .join('')}
                  </span>
                  <span className="college-name">{college.name}</span>
                  <span className="college-count">
                    {college.count} {college.count === 1 ? 'style' : 'styles'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="eyebrow">Campus favorites</p>
              <h2>What New Haven is wearing</h2>
            </div>
            <Link to="/products" className="text-link">
              Shop everything →
            </Link>
          </div>
          <div className="product-grid">
            {featured.map((product) => (
              <ProductCard key={product.product_id} product={product} />
            ))}
          </div>
        </div>
      </section>

      <section className="assistant-band">
        <div className="container assistant-inner">
          <div>
            <p className="eyebrow eyebrow-light">Shop assistant</p>
            <h2>Not sure about a size? Just ask.</h2>
            <p>
              Our assistant checks prices and stock for every size as you chat, and puts what it
              finds right on the page.
            </p>
          </div>
          <div className="assistant-questions">
            {ASSISTANT_QUESTIONS.map((question) => (
              <button key={question} onClick={() => open(question)}>
                “{question}”
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="visit-banner">
        <div className="container visit-inner">
          <div>
            <p className="eyebrow eyebrow-dark">Come say hi</p>
            <h2>Visit the shop at 57 Broadway</h2>
            <p>Try on sizes, see the fabrics, and pick up something blue on your way across campus.</p>
          </div>
          <Link to="/about" className="btn btn-primary btn-lg">
            Plan your visit
          </Link>
        </div>
      </section>
    </>
  )
}
