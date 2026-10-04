import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { displayName, useAuth } from '../auth'
import { Crest } from './Brand'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/products', label: 'Products' },
  { to: '/about', label: 'About Us' },
]

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { user, checking, logout } = useAuth()

  // A soft shadow once the page scrolls, so the sticky header separates from content.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="announcement">
        <span>Yale apparel · 57 Broadway, New Haven</span>
        <span className="announcement-sep" aria-hidden="true">·</span>
        <span className="announcement-extra">Live stock in every size</span>
      </div>
      <nav className="navbar container" aria-label="Main">
        <Link to="/" className="brand" aria-label="Campus Customs home">
          <Crest size={34} />
          <span className="brand-text">
            Campus Customs
            <small>New Haven, Connecticut</small>
          </span>
        </Link>

        <button
          className={`menu-toggle ${menuOpen ? 'is-open' : ''}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="nav-links"
        >
          <span className="sr-only">Menu</span>
          <span className="menu-bar" />
          <span className="menu-bar" />
          <span className="menu-bar" />
        </button>

        <div
          id="nav-links"
          className={`nav-links ${menuOpen ? 'is-open' : ''}`}
          // Close the mobile menu after a link or button is chosen.
          onClick={(event) => (event.target as HTMLElement).closest('a, button') && setMenuOpen(false)}
        >
          <div className="nav-primary">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
                {link.label}
              </NavLink>
            ))}
          </div>
          <div className="nav-account">
            {user ? (
              <>
                <span className="nav-user" title={user.email}>
                  <span className="nav-avatar" aria-hidden="true">
                    {displayName(user).charAt(0).toUpperCase()}
                  </span>
                  Hi, {displayName(user)}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => logout()}>
                  Log out
                </button>
              </>
            ) : (
              <span className={`nav-auth ${checking ? 'is-checking' : ''}`}>
                <NavLink to="/login" className="nav-link">
                  Log in
                </NavLink>
                <NavLink to="/signup" className="btn btn-primary btn-sm">
                  Create account
                </NavLink>
              </span>
            )}
          </div>
        </div>
      </nav>
      <div className="varsity-stripe" aria-hidden="true" />
    </header>
  )
}
