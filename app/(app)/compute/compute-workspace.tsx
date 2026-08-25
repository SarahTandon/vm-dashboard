'use client'

import { useCallback } from 'react'
import type { AppGroup, ProvisionView, VmStatus } from '@/lib/provisions'
import { GroupContainers } from './group-containers'
import { VmInventory } from './vm-inventory'
import { useSettleClock } from './use-settle-clock'
import { displayStatus } from './view-model'

/**
 * The interactive half of the compute page.
 *
 * Its only real job is to own a single clock. The group containers and the
 * inventory both display live status, and running one timer for the page keeps
 * them in step — two independent timers would tick apart and could each fire
 * their own refresh at the moment a transition settles.
 */
export function ComputeWorkspace({
  rows,
  groups,
}: {
  rows: ProvisionView[]
  groups: AppGroup[]
}) {
  const now = useSettleClock(rows)

  const statusOf = useCallback(
    (row: ProvisionView): VmStatus => displayStatus(row, now),
    [now]
  )

  return (
    <>
      <GroupContainers
        groups={groups}
        rows={rows}
        statusOf={statusOf}
        now={now}
      />
      <VmInventory rows={rows} statusOf={statusOf} now={now} />
    </>
  )
}
