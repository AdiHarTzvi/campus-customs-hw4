import { Link } from 'react-router-dom'
import { CATEGORIES } from '../api'
import { useChat } from '../chat'
import { Crest } from './Brand'

const YEAR = new Date().getFullYear()

export default function Footer() {
  const { open } = useChat()

  return (
    <footer className="site-footer">
      <div className="varsity-stripe" aria-hidden="true" />
      <div className="container footer-grid">
        <div className="footer-intro">
          <div className="footer-brand">
            <Crest size={36} />
            <span>Campus Customs</span>
          </div>
          <p className="footer-note">
            Bulldog apparel for students, alumni, families, and everyone who calls New Haven home.
          </p>
          <button className="footer-chat" onClick={() => open()}>
            Questions about sizes or stock? Ask our shop assistant →
          </button>
        </div>
        <div>
          <p className="footer-heading">Shop</p>
          <ul>
            {CATEGORIES.map((category) => (
              <li key={category.slug}>
                <Link to={`/products?category=${category.slug}`}>{category.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="footer-heading">Company</p>
          <ul>
            <li><Link to="/about">About Us</Link></li>
            <li><Link to="/login">Log in</Link></li>
            <li><Link to="/signup">Create account</Link></li>
          </ul>
        </div>
        <div>
          <p className="footer-heading">Visit</p>
          <address className="footer-note">
            57 Broadway
            <br />
            New Haven, CT 06511
          </address>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {YEAR} Campus Customs</span>
        <span>Class project site for HW4</span>
      </div>
    </footer>
  )
}
