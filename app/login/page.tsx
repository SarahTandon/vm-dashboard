'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signIn,
    null
  )

  return (
    <main className="login-shell">
      <form className="login-card" action={formAction}>
        <div className="login-head">
          <h1>VMaaS Dashboard</h1>
          <p className="muted">Sign in to your workspace</p>
        </div>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue=""
          placeholder="you@example.com"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        {state?.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
