'use client'

import { useEffect } from 'react'
import styles from './insights.module.css'

/**
 * Segment-level error boundary for Insights.
 *
 * Everything on this page is read-only, so a failure here is worth showing and
 * retrying rather than taking the whole shell down. In this version of Next the
 * recovery prop is `retry`, not `reset`.
 */
export default function InsightsError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <>
      <header className="page-head">
        <h1>Insights</h1>
        <p className="muted">Something went wrong loading this page.</p>
      </header>
      <section className="panel">
        <p className="muted">
          The telemetry, chargeback, and catalog data could not be read.
          {error.digest ? ` Reference ${error.digest}.` : ''}
        </p>
        <button
          type="button"
          className={styles.download}
          onClick={() => retry()}
        >
          Try again
        </button>
      </section>
    </>
  )
}
