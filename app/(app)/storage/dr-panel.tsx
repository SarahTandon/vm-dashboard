'use client'

import { useActionState } from 'react'
import { runDrTest, type DrTestState } from './actions'
import styles from './storage.module.css'

const initialState: DrTestState = null

/**
 * The DR test button and its result.
 *
 * The result lives in this component's state and nowhere else. There is no
 * `dr_tests` table and `workspaces` is read-only to the application, so the
 * durable record of a run is the audit entry the action writes; this panel is
 * the transient view of it.
 */
export default function DrPanel({ rpoSeconds }: { rpoSeconds: number }) {
  const [state, formAction, pending] = useActionState(runDrTest, initialState)

  return (
    <>
      <form action={formAction}>
        <button type="submit" className={styles.action} disabled={pending}>
          {pending ? 'Running failover test…' : 'Run non-disruptive DR test'}
        </button>
      </form>

      <p className="muted small" style={{ margin: '10px 0 0' }}>
        Promotes the standby, verifies the workloads against it, and fails back.
        Live machines keep serving traffic throughout; the {rpoSeconds}s
        replication target is not paused.
      </p>

      {state && (
        <div className={styles.runResult} aria-live="polite">
          <div className={styles.runHead}>
            <strong>Test complete</strong>
            <span
              className={`badge ${styles.statusBadge} ${
                state.withinRpo ? styles.ok : styles.warn
              }`}
            >
              {state.withinRpo ? 'Within RPO' : 'Lag over target'}
            </span>
          </div>

          <p className="small" style={{ margin: '0 0 12px' }}>
            {state.message}
          </p>

          <ol className={styles.steps}>
            {state.steps.map((step) => (
              <li key={step.name} className={styles.step}>
                <span className={styles.tick} aria-hidden="true">
                  ✓
                </span>
                <span>
                  <span className={styles.stepName}>{step.name}</span>
                  <span className={styles.stepDetail}>{step.detail}</span>
                </span>
                <span className={styles.stepMs}>{step.ms} ms</span>
              </li>
            ))}
          </ol>

          <p className={styles.transient}>
            Recorded to the audit log as <code>dr.test</code>. This summary is
            not stored — replication state is written by the replica, not by
            the dashboard, so nothing here changes the workspace record.
          </p>
        </div>
      )}
    </>
  )
}
