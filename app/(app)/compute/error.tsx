'use client'

import { useEffect } from 'react'
import styles from './compute.module.css'

/**
 * Catches the unexpected: a database read that failed outright, rather than a
 * machine that refused a power action. Expected failures come back from the
 * Server Actions as values and render next to the button that caused them.
 *
 * Note the prop is `retry`, not `reset` — this is Next 16.
 */
export default function ComputeError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('Compute page failed to render:', error)
  }, [error])

  return (
    <>
      <header className="page-head">
        <h1>Compute</h1>
        <p className="muted">The inventory could not be loaded.</p>
      </header>
      <section className="panel">
        <p className="form-error">{error.message}</p>
        <p className="muted small">
          {error.digest
            ? `Reference ${error.digest}.`
            : 'No further detail was reported.'}
        </p>
        <button type="button" className={styles.retryBtn} onClick={() => retry()}>
          Try again
        </button>
      </section>
    </>
  )
}
