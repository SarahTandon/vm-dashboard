'use client'

import type { VmStatus } from '@/lib/provisions'
import { STATUS_LABELS, isPending } from './view-model'
import styles from './compute.module.css'

/**
 * The status a machine reads as right now, never the raw column.
 *
 * A pending machine also shows how long it has left, because the transition is
 * the one thing on this page that changes without anybody clicking.
 */
export function StatusPill({
  status,
  secondsLeft,
}: {
  status: VmStatus
  secondsLeft?: number | null
}) {
  const pending = isPending(status)
  return (
    <span className={styles.pill} data-status={status}>
      <span className={styles.dot} aria-hidden="true" />
      {STATUS_LABELS[status]}
      {pending && typeof secondsLeft === 'number' && (
        <span className={styles.countdown}>{secondsLeft}s</span>
      )}
    </span>
  )
}
