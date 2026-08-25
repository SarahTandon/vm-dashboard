'use client'

import { useState, useTransition } from 'react'
import type { VmStatus } from '@/lib/provisions'
import { powerGroup, powerMachine } from './actions'
import {
  POWER_VERBS,
  VERB_LABELS,
  canRun,
  isPending,
  type ActionResult,
  type PowerVerb,
} from './view-model'
import styles from './compute.module.css'

function Message({ result }: { result: ActionResult | null }) {
  if (!result) return null
  return (
    <p
      aria-live="polite"
      className={`${styles.actionMsg} ${result.ok ? styles.actionOk : styles.actionBad}`}
    >
      {result.message}
    </p>
  )
}

/**
 * The four controls for one machine.
 *
 * A control is disabled when the machine's current status cannot take it — a
 * stopped machine cannot be stopped, and a machine mid-transition cannot take
 * anything until it settles. The server checks the same rule against a fresh
 * read before it writes, so a stale button cannot force an illegal write.
 */
export function PowerButtons({
  provisionId,
  status,
}: {
  provisionId: string
  status: VmStatus
}) {
  const [busy, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)
  const pending = isPending(status)

  function run(verb: PowerVerb) {
    setResult(null)
    startTransition(async () => {
      setResult(await powerMachine(provisionId, verb))
    })
  }

  return (
    <div className={styles.actions}>
      <div className={styles.buttonRow}>
        {POWER_VERBS.map((verb) => (
          <button
            key={verb}
            type="button"
            className={styles.powerBtn}
            data-verb={verb}
            disabled={busy || !canRun(verb, status)}
            title={
              pending
                ? 'Waiting for the current transition to finish'
                : `${VERB_LABELS[verb]} this machine`
            }
            onClick={() => run(verb)}
          >
            {VERB_LABELS[verb]}
          </button>
        ))}
      </div>
      <Message result={result} />
    </div>
  )
}

/**
 * One control applied to every machine in a group.
 *
 * A button is live when at least one member could take it; the server skips
 * the members that cannot and reports how many it actually touched. Sequential
 * boot delays are deferred to v1.1, so this fires them all at once.
 */
export function BulkPowerButtons({
  groupId,
  memberStatuses,
}: {
  groupId: string
  memberStatuses: VmStatus[]
}) {
  const [busy, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)

  function run(verb: PowerVerb) {
    setResult(null)
    startTransition(async () => {
      setResult(await powerGroup(groupId, verb))
    })
  }

  return (
    <div className={styles.actions}>
      <div className={styles.buttonRow}>
        {POWER_VERBS.map((verb) => {
          const eligible = memberStatuses.filter((s) => canRun(verb, s)).length
          return (
            <button
              key={verb}
              type="button"
              className={styles.powerBtn}
              data-verb={verb}
              disabled={busy || eligible === 0}
              title={
                eligible === 0
                  ? `No machine in this group can be ${verb === 'snapshot' ? 'snapshotted' : verb + 'ed'} right now`
                  : `${VERB_LABELS[verb]} ${eligible} machine${eligible === 1 ? '' : 's'}`
              }
              onClick={() => run(verb)}
            >
              {VERB_LABELS[verb]} all
              {eligible > 0 && (
                <span className={styles.btnCount}>{eligible}</span>
              )}
            </button>
          )
        })}
      </div>
      <Message result={result} />
    </div>
  )
}
