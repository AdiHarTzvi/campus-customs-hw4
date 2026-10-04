import { useCallback, useEffect, useState } from 'react'
import { fetchProduct, fetchProducts, type Product } from './api'

type State<T> = { data: T | null; error: string | null; loading: boolean }

// The catalogue is small (102 items), so it is fetched once and shared across pages.
let catalogueRequest: Promise<Product[]> | null = null

export function useProducts(): State<Product[]> & { retry: () => void } {
  const [state, setState] = useState<State<Product[]>>({ data: null, error: null, loading: true })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    catalogueRequest ??= fetchProducts()
    catalogueRequest
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((error: Error) => {
        catalogueRequest = null
        if (active) setState({ data: null, error: error.message, loading: false })
      })
    return () => {
      active = false
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ data: null, error: null, loading: true })
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry }
}

// Callers remount per product (see ProductRoute in App.tsx), so state starts fresh for each id.
export function useProduct(productId: string | undefined): State<Product> {
  const [state, setState] = useState<State<Product>>({ data: null, error: null, loading: true })

  useEffect(() => {
    if (!productId) return
    let active = true
    // Fetch fresh so size/stock numbers are current on the product page.
    fetchProduct(productId)
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((error: Error) => active && setState({ data: null, error: error.message, loading: false }))
    return () => {
      active = false
    }
  }, [productId])

  return state
}
