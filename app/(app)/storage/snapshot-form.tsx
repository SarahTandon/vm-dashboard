'use client'

import { useActionState } from 'react'
import { createSnapshot, type SnapshotState } from './actions'
import styles from './storage.module.css'

export type SnapshotTarget = {
  id: string
  vmName: string
  storageGb: number
  tierLabel: string
}

const initialState: SnapshotState = null

export default function SnapshotForm({
  machines,
}: {
  machines: SnapshotTarget[]
}) {
  const [state, formAction, pending] = useActionState(
    createSnapshot,
    initialState
  )

  if (machines.length === 0) {
    return (
      <p className={styles.empty}>
        No machines are visible to you, so there is nothing to snapshot.
      </p>
    )
  }

  return (
    <>
      <form action={formAction} className={styles.formRow}>
        <div className={styles.field}>
          <label htmlFor="snapshot-machine">Machine</label>
          <select id="snapshot-machine" name="provisionId" defaultValue={machines[0].id}>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.vmName} · {m.storageGb} GB · {m.tierLabel}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="snapshot-label">Label</label>
          <input
            id="snapshot-label"
            name="label"
            type="text"
            maxLength={60}
            placeholder="pre-deploy-v2.4 (optional)"
          />
        </div>

        <button type="submit" className={styles.action} disabled={pending}>
          {pending ? 'Capturing…' : 'Take snapshot'}
        </button>
      </form>

      <p className="muted small" style={{ margin: '10px 0 0' }}>
        Snapshots are crash-consistent and taken in place — the machine keeps
        running. Size reflects written blocks, not the provisioned volume.
      </p>

      {state && (
        <p
          aria-live="polite"
          className={`${styles.notice} ${
            state.ok ? styles.noticeOk : styles.noticeBad
          }`}
        >
          {state.message}
        </p>
      )}
    </>
  )
}
