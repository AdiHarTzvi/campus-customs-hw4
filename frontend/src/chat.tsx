import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ChatProductCard, ChatSearchSummary } from './api'

// Products the assistant found, shown as cards on the page (see ChatResults).
export type ChatResultsState = {
  id: number
  question: string
  products: ChatProductCard[]
  search: ChatSearchSummary | null
}

type ChatContextValue = {
  isOpen: boolean
  draft: string
  setDraft: (text: string) => void
  open: (draft?: string) => void
  close: () => void
  results: ChatResultsState | null
  showResults: (results: Omit<ChatResultsState, 'id'>) => void
  clearResults: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

let nextResultsId = 1

// Shares the floating chat's state with the rest of the site: any page can open the chat
// with a prefilled question, and the chat can put product results on the page.
export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [results, setResults] = useState<ChatResultsState | null>(null)

  const open = useCallback((text?: string) => {
    if (text !== undefined) setDraft(text)
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])
  const showResults = useCallback(
    (next: Omit<ChatResultsState, 'id'>) => setResults({ ...next, id: nextResultsId++ }),
    [],
  )
  const clearResults = useCallback(() => setResults(null), [])

  const value = useMemo(
    () => ({ isOpen, draft, setDraft, open, close, results, showResults, clearResults }),
    [isOpen, draft, open, close, results, showResults, clearResults],
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChat must be used inside ChatProvider')
  return context
}
