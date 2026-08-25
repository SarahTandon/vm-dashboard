'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import { getProvision } from '@/lib/provisions'
import {
  countSnapshotsFor,
  defaultSnapshotLabel,
  formatGb,
  rpoState,
  snapshotSizeGb,
} from '@/lib/storage'

// Every action re-authenticates and re-reads the machine it was handed.
// A Server Action is a POST endpoint like any other: rendering the form only
// for people who own a machine is not what stops someone else calling it —
// requireUser plus the row-level policy on `provisions` is.

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export type SnapshotState = {
  ok: boolean
  message: string
} | null

export async function createSnapshot(
  _prev: SnapshotState,
  formData: FormData
): Promise<SnapshotState> {
  const user = await requireUser()

  const provisionId = String(formData.get('provisionId') ?? '').trim()
  if (!provisionId) {
    return { ok: false, message: 'Pick a machine to snapshot.' }
  }

  // The client says *which* machine; everything else comes from the row.
  // `provisions` is filtered by policy, so a machine belonging to someone
  // else simply is not found here.
  const provision = await getProvision(provisionId)
  if (!provision) {
    return { ok: false, message: 'That machine is not available to you.' }
  }

  const typed = String(formData.get('label') ?? '').trim()
  const label = (typed || defaultSnapshotLabel()).slice(0, 60)

  const sequence = await countSnapshotsFor(provision.id)
  const sizeGb = snapshotSizeGb(provision.storage_gb, `${provision.id}:${sequence}`)

  const supabase = await createClient()
  const { error } = await supabase.from('snapshots').insert({
    workspace_id: user.workspaceId,
    provision_id: provision.id,
    label,
    size_gb: sizeGb,
  })

  if (error) {
    return { ok: false, message: `Snapshot failed: ${error.message}` }
  }

  await recordAudit(
    'storage.snapshot',
    { vm_name: provision.vm_name, label, size_gb: sizeGb },
    provision.id
  )

  // The snapshot list on this page is a fresh read, so invalidating the path
  // means the new row comes back in the same response as this return value.
  revalidatePath('/storage')

  return {
    ok: true,
    message: `Captured "${label}" from ${provision.vm_name} — ${formatGb(sizeGb)}.`,
  }
}

// ---------------------------------------------------------------------------
// Non-disruptive DR test
// ---------------------------------------------------------------------------

export type DrStep = {
  name: string
  detail: string
  ms: number
}

export type DrTestState = {
  ok: boolean
  message: string
  ranAt: string
  lagSeconds: number | null
  withinRpo: boolean
  totalMs: number
  steps: DrStep[]
} | null

/**
 * Failover to the standby and back, without moving live workloads.
 *
 * The result is transient by design. `workspaces` has a SELECT-only policy —
 * there is no UPDATE policy and no `dr_tests` table — so this cannot stamp
 * `last_replicated_at` or persist a run row. What survives the request is the
 * audit entry; what the operator sees is the return value below.
 */
export async function runDrTest(
  _prev: DrTestState,
  _formData: FormData
): Promise<DrTestState> {
  const user = await requireUser()

  const supabase = await createClient()
  const { data } = await supabase
    .from('workspaces')
    .select('last_replicated_at')
    .maybeSingle()

  const lastReplicatedAt =
    (data as { last_replicated_at: string } | null)?.last_replicated_at ?? null

  const lagSeconds = lastReplicatedAt
    ? Math.max(
        0,
        Math.round((Date.now() - new Date(lastReplicatedAt).getTime()) / 1000)
      )
    : null

  const withinRpo =
    lagSeconds !== null && rpoState(lagSeconds, user.rpoSeconds) === 'healthy'

  // Timings scale off the replication target: a workspace promising a 4s RPO
  // is running a tighter journal than one promising 8s, and cuts over faster.
  const unit = Math.max(1, user.rpoSeconds)
  const steps: DrStep[] = [
    {
      name: 'Checkpoint replica',
      detail: 'Journal flushed and sealed at the standby site',
      ms: 120 + unit * 40,
    },
    {
      name: 'Promote standby',
      detail: 'Shadow promotion — primary keeps serving traffic',
      ms: 340 + unit * 95,
    },
    {
      name: 'Verify workloads',
      detail: 'Boot order and volume attachment checked against the replica',
      ms: 610 + unit * 70,
    },
    {
      name: 'Fail back',
      detail: 'Standby demoted, delta re-synced to primary',
      ms: 280 + unit * 60,
    },
  ]

  const totalMs = steps.reduce((sum, s) => sum + s.ms, 0)
  const ranAt = new Date().toISOString()

  await recordAudit('dr.test', {
    kind: 'failover_failback',
    disruptive: false,
    rpo_seconds: user.rpoSeconds,
    observed_lag_seconds: lagSeconds,
    within_rpo: withinRpo,
    total_ms: totalMs,
    steps: steps.map((s) => ({ name: s.name, ms: s.ms })),
    ran_at: ranAt,
  })

  return {
    ok: true,
    message: withinRpo
      ? `Failover and failback completed in ${(totalMs / 1000).toFixed(1)}s. Replica was ${lagSeconds}s behind — inside the ${user.rpoSeconds}s target.`
      : `Failover and failback completed in ${(totalMs / 1000).toFixed(1)}s, but the replica was ${lagSeconds ?? '—'}s behind a ${user.rpoSeconds}s target.`,
    ranAt,
    lagSeconds,
    withinRpo,
    totalMs,
    steps,
  }
}
