// The shopper's size, remembered in this browser so the catalogue and product pages can use it.
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

const STORAGE_KEY = 'cc_preferred_size'

export function getSavedSize(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value && (SIZES as readonly string[]).includes(value) ? value : null
  } catch {
    return null
  }
}

export function saveSize(size: string | null) {
  try {
    if (size) localStorage.setItem(STORAGE_KEY, size)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the filter still works for this visit.
  }
}
