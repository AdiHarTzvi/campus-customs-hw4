import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  signupRequest,
  type SignupInput,
  type User,
} from './api'

type AuthContextValue = {
  user: User | null
  checking: boolean
  login: (email: string, password: string) => Promise<User>
  signup: (input: SignupInput) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// The session lives in an HttpOnly cookie set by the backend, so the frontend only keeps
// the public user profile in memory and asks /api/auth/me on load.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetchCurrentUser()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { user: loggedIn } = await loginRequest(email, password)
    setUser(loggedIn)
    return loggedIn as User
  }, [])

  const signup = useCallback(async (input: SignupInput) => {
    const { user: created } = await signupRequest(input)
    setUser(created)
    return created as User
  }, [])

  const logout = useCallback(async () => {
    await logoutRequest().catch(() => undefined)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, checking, login, signup, logout }),
    [user, checking, login, signup, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

export function displayName(user: User): string {
  return user.first_name || user.name.split(' ')[0] || user.email
}
