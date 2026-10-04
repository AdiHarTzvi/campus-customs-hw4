import { Link } from 'react-router-dom'

export default function About() {
  return (
    <div className="page">
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">About us</p>
          <h1>A neighborhood shop with Bulldog spirit</h1>
          <p className="page-lede">
            Campus Customs is the shop on Broadway where New Haven comes to gear up
            for class, game day, and every reunion in between.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container about-grid">
          <div className="about-copy">
            <h2>Our story</h2>
            <p>
              We started with a simple idea: the best Yale apparel should feel personal. A first-year
              wants their residential college on their chest. A grad student wants their school. A
              parent wants something that says "my kid goes here" without saying a word.
            </p>
            <p>
              So we built a collection that goes beyond the big wordmark: crests for every
              residential college, designs for the professional schools, varsity sports from sailing
              to fencing, and plenty of vintage Bulldogs for good measure.
            </p>
            <p>
              Today we serve students, alumni, faculty, and visiting families from our shop near the
              heart of campus, and anyone who wants to show up in blue from wherever they are.
            </p>
          </div>
          <aside className="about-card">
            <p className="eyebrow eyebrow-dark">Visit us</p>
            <p className="about-address">
              57 Broadway
              <br />
              New Haven, CT 06511
            </p>
            <p>
              A short walk from Old Campus. Stop by to try on sizes, browse new arrivals, or ask our
              team for gift ideas.
            </p>
            <Link to="/products" className="btn btn-primary">
              Browse online
            </Link>
          </aside>
        </div>
      </section>

      <section className="section section-sky">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="eyebrow">What we care about</p>
              <h2>How we do things</h2>
            </div>
          </div>
          <div className="value-grid">
            <div className="value">
              <span className="value-icon" aria-hidden="true">🧵</span>
              <h3>Comfort first</h3>
              <p>Soft fleece, sturdy knits, and fits you'll reach for long after graduation.</p>
            </div>
            <div className="value">
              <span className="value-icon" aria-hidden="true">🎓</span>
              <h3>Every corner of campus</h3>
              <p>If you belong to a college, school, or team at Yale, we want to have something for you.</p>
            </div>
            <div className="value">
              <span className="value-icon" aria-hidden="true">🤝</span>
              <h3>Real, local help</h3>
              <p>Questions about sizing or stock? Ask in the shop, or use the chat in the corner of any page.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
