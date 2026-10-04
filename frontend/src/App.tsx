import { useEffect } from 'react'
import { Link, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AuthProvider } from './auth'
import { ChatProvider } from './chat'
import ChatResults from './components/ChatResults'
import ChatWidget from './components/ChatWidget'
import Footer from './components/Footer'
import Navbar from './components/Navbar'
import About from './pages/About'
import Auth from './pages/Auth'
import Home from './pages/Home'
import ProductDetail from './pages/ProductDetail'
import Products from './pages/Products'

function NotFound() {
  return (
    <div className="container page empty">
      <h1>Page not found</h1>
      <p>That page wandered off campus.</p>
      <Link to="/" className="btn btn-primary">
        Back home
      </Link>
    </div>
  )
}

// Start each new page at the top (e.g. after logging in or opening a product).
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// Keyed by id so moving between products resets size selection and loading state.
function ProductRoute() {
  const { productId = '' } = useParams()
  return <ProductDetail key={productId} productId={productId} />
}

export default function App() {
  return (
    <AuthProvider>
      <ChatProvider>
        <ScrollToTop />
        <Navbar />
        <main>
          <ChatResults />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:productId" element={<ProductRoute />} />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Auth mode="login" />} />
            <Route path="/signup" element={<Auth mode="signup" />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        <ChatWidget />
      </ChatProvider>
    </AuthProvider>
  )
}
