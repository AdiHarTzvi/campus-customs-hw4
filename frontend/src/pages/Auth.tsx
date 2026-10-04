import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, type FieldErrors } from '../api'
import { displayName, useAuth } from '../auth'
import { Crest } from '../components/Brand'

type Mode = 'login' | 'signup'

const MIN_PASSWORD_LENGTH = 8

// Mirrors the backend checks so most mistakes are caught before a request is sent.
// The backend re-validates everything; these are just faster feedback.
function validate(mode: Mode, values: Record<string, string>): FieldErrors {
  const errors: FieldErrors = {}
  if (mode === 'signup') {
    if (!values.first_name.trim()) errors.first_name = 'First name is required.'
    if (!values.last_name.trim()) errors.last_name = 'Last name is required.'
  }
  if (!values.email.trim()) errors.email = 'Email is required.'
  else if (mode === 'signup' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!values.password) errors.password = 'Password is required.'
  else if (mode === 'signup' && values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (mode === 'signup') {
    if (!values.confirm_password) errors.confirm_password = 'Please confirm your password.'
    else if (values.password && values.confirm_password !== values.password) {
      errors.confirm_password = 'Passwords do not match.'
    }
  }
  return errors
}

function Field({
  name,
  label,
  error,
  ...input
}: {
  name: string
  label: string
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span>{label}</span>
      <input
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        {...input}
      />
      {error && (
        <small id={`${name}-error`} className="field-error">
          {error}
        </small>
      )}
    </label>
  )
}

// Brand panel beside the form, so account pages feel like part of the storefront.
function AuthShell({ mode, children }: { mode: Mode; children: ReactNode }) {
  return (
    <div className="page auth-page">
      <div className="auth-shell">
        <aside className="auth-aside">
          <Crest size={52} />
          <h2>{mode === 'signup' ? 'Join the Campus Customs community' : 'Good to see you again'}</h2>
          <ul>
            <li>Your chats with our shop assistant are saved, so you can pick up where you left off</li>
            <li>The assistant greets you by name and knows your account</li>
            <li>Browse every residential college, school, and team in one place</li>
          </ul>
          <p className="auth-aside-note">57 Broadway · New Haven, CT</p>
        </aside>
        {children}
      </div>
    </div>
  )
}

export default function Auth({ mode }: { mode: Mode }) {
  const isSignup = mode === 'signup'
  const { user, login, signup, logout } = useAuth()
  const navigate = useNavigate()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(
      ['first_name', 'last_name', 'email', 'password', 'confirm_password'].map((key) => [
        key,
        String(form.get(key) ?? ''),
      ]),
    )

    const errors = validate(mode, values)
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      if (isSignup) {
        await signup({
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email: values.email.trim(),
          password: values.password,
          confirm_password: values.confirm_password,
        })
      } else {
        await login(values.email.trim(), values.password)
      }
      navigate('/', { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message)
        setFieldErrors(error.fields)
      } else {
        setFormError('Something went wrong. Please try again.')
      }
      // Never keep a rejected password in the form.
      const formElement = event.target as HTMLFormElement
      for (const name of ['password', 'confirm_password']) {
        const input = formElement.elements.namedItem(name) as HTMLInputElement | null
        if (input) input.value = ''
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (user) {
    return (
      <AuthShell mode={mode}>
        <div className="auth-card">
          <div className="auth-head">
            <h1>You're logged in</h1>
            <p>
              Signed in as <strong>{displayName(user)}</strong> ({user.email}).
            </p>
          </div>
          <div className="auth-form">
            <Link to="/products" className="btn btn-primary btn-block">
              Continue shopping
            </Link>
            <button className="btn btn-ghost btn-block" onClick={() => logout()}>
              Log out
            </button>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell mode={mode}>
      <div className="auth-card">
        <div className="auth-head">
          <p className="eyebrow">{isSignup ? 'New here?' : 'Members'}</p>
          <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p>
            {isSignup
              ? 'Save your details and pick up your chat with our shop assistant where you left off.'
              : 'Log in to pick up your saved conversation with our shop assistant.'}
          </p>
        </div>

        {formError && (
          <div className="notice notice-error" role="alert">
            {formError}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate key={mode}>
          {isSignup && (
            <div className="field-row">
              <Field name="first_name" label="First name" autoComplete="given-name" error={fieldErrors.first_name} />
              <Field name="last_name" label="Last name" autoComplete="family-name" error={fieldErrors.last_name} />
            </div>
          )}
          <Field
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@yale.edu"
            error={fieldErrors.email}
          />
          <Field
            name="password"
            label="Password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder={isSignup ? `At least ${MIN_PASSWORD_LENGTH} characters` : undefined}
            error={fieldErrors.password}
          />
          {isSignup && (
            <Field
              name="confirm_password"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              error={fieldErrors.confirm_password}
            />
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          ) : (
            <>
              New to Campus Customs? <Link to="/signup">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </AuthShell>
  )
}
