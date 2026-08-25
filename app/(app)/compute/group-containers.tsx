'use client'

import type { AppGroup, ProvisionView, VmStatus } from '@/lib/provisions'
import { BulkPowerButtons } from './power-controls'
import { StatusPill } from './status-pill'
import { isPending, secondsRemaining } from './view-model'
import styles from './compute.module.css'

/**
 * Application group containers.
 *
 * A group is owned by one person and so is everything in it, which is what
 * makes "power the whole group" unambiguous — there is never a machine in the
 * container that belongs to somebody else.
 */
export function GroupContainers({
  groups,
  rows,
  statusOf,
  now,
}: {
  groups: AppGroup[]
  rows: ProvisionView[]
  statusOf: (row: ProvisionView) => VmStatus
  now: number | null
}) {
  const ungrouped = rows.filter((r) => !r.group_id).length

  if (groups.length === 0) {
    return (
      <section className="panel">
        <div className={styles.panelHead}>
          <h2>Application groups</h2>
        </div>
        <p className="muted">
          No application groups are visible to you. Machines outside a group are
          powered individually from the inventory below.
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className={styles.panelHead}>
        <h2>Application groups</h2>
        <span className="muted small">
          One-click bulk power across every machine in a container
        </span>
      </div>

      <div className={styles.groupGrid}>
        {groups.map((group) => {
          const members = rows.filter((r) => r.group_id === group.id)
          const statuses = members.map(statusOf)
          const running = statuses.filter((s) => s === 'running').length
          const stopped = statuses.filter((s) => s === 'stopped').length
          const busy = statuses.filter(isPending).length

          return (
            <article key={group.id} className={styles.groupCard}>
              <header className={styles.groupHead}>
                <h3 className={styles.groupName}>{group.name}</h3>
                <span className="muted small">
                  {members.length} machine{members.length === 1 ? '' : 's'} ·{' '}
                  {group.owner_name}
                </span>
              </header>

              <div className={styles.tally}>
                <span className={styles.tallyItem} data-status="running">
                  {running} running
                </span>
                <span className={styles.tallyItem} data-status="stopped">
                  {stopped} stopped
                </span>
                {busy > 0 && (
                  <span className={styles.tallyItem} data-status="starting">
                    {busy} pending
                  </span>
                )}
              </div>

              {members.length === 0 ? (
                <p className="muted small">
                  Nothing is provisioned into this group yet.
                </p>
              ) : (
                <ul className={styles.memberList}>
                  {members.map((m) => (
                    <li key={m.id} className={styles.member}>
                      <span className={styles.memberName}>{m.vm_name}</span>
                      <StatusPill
                        status={statusOf(m)}
                        secondsLeft={secondsRemaining(m, now)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {members.length > 0 && (
                <BulkPowerButtons
                  groupId={group.id}
                  memberStatuses={statuses}
                />
              )}
            </article>
          )
        })}
      </div>

      {ungrouped > 0 && (
        <p className={`muted small ${styles.ungroupedNote}`}>
          {ungrouped} machine{ungrouped === 1 ? '' : 's'} sit outside any group
          and {ungrouped === 1 ? 'is' : 'are'} powered individually below.
        </p>
      )}
    </section>
  )
}
