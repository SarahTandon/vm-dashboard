'use server'

import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  effectiveStatus,
  getProvision,
  snapshotLabel,
  snapshotSizeGb,
  type Provision,
  type VmStatus,
} from '@/lib/provisions'
import {
  POWER_VERBS,
  VERB_REQUIRES,
  type ActionResult,
  type PowerVerb,
} from './view-model'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * The status written when a control is pressed. There is no hypervisor to ask,
 * so the row itself is the machine: it records that a transition began, and
 * `effectiveStatus` settles it 20 seconds later on the next read.
 *
 * `snapshot` is absent on purpose — see `runPower`.
 */
const TRANSITION_TO: Record<Exclude<PowerVerb, 'snapshot'>, VmStatus> = {
  start: 'starting',
  stop: 'stopping',
  restart: 'restarting',
}

function isPowerVerb(value: unknown): value is PowerVerb {
  return typeof value === 'string' && POWER_VERBS.includes(value as PowerVerb)
}

type Outcome = { applied: boolean; reason?: string }

/**
 * Apply one control to one machine that has already been read back from the
 * database. The caller must pass a row it fetched itself, never one supplied
 * by the browser — reading it through RLS is what proves the caller may touch
 * it, and it is where `workspace_id` comes from.
 */
async function runPower(
  supabase: Supabase,
  vm: Provision,
  verb: PowerVerb,
  detail: Record<string, unknown>
): Promise<Outcome> {
  const from = effectiveStatus(vm)

  if (!VERB_REQUIRES[verb].includes(from)) {
    return { applied: false, reason: `${vm.vm_name} is ${from}` }
  }

  // A snapshot records a new row and nothing else. It cannot set a
  // `snapshotting` status because there is no such value in the `vm_status`
  // enum, and inventing one would be rejected by the database.
  if (verb === 'snapshot') {
    const label = snapshotLabel(vm.vm_name)
    const size_gb = snapshotSizeGb(vm.storage_gb)

    const { error } = await supabase.from('snapshots').insert({
      workspace_id: vm.workspace_id,
      provision_id: vm.id,
      label,
      size_gb,
    })
    if (error) return { applied: false, reason: error.message }

    await recordAudit(
      'vm.snapshot',
      { vm: vm.vm_name, label, size_gb, taken_while: from, ...detail },
      vm.id
    )
    return { applied: true }
  }

  const to = TRANSITION_TO[verb]
  const { error } = await supabase
    .from('provisions')
    .update({ status: to, status_changed_at: new Date().toISOString() })
    .eq('id', vm.id)
  if (error) return { applied: false, reason: error.message }

  await recordAudit(
    `vm.${verb}`,
    { vm: vm.vm_name, from, to, ...detail },
    vm.id
  )
  return { applied: true }
}

/**
 * Power control for a single machine.
 *
 * Expected failures — a machine mid-transition, a row the caller may not see —
 * come back as a result the button renders, rather than as a thrown error that
 * would tear the page down to the error boundary.
 */
export async function powerMachine(
  provisionId: string,
  verb: string
): Promise<ActionResult> {
  if (typeof provisionId !== 'string' || !isPowerVerb(verb)) {
    return { ok: false, message: 'Unrecognised power request.' }
  }

  const vm = await getProvision(provisionId)
  if (!vm) return { ok: false, message: 'That machine is not available to you.' }

  const supabase = await createClient()
  const outcome = await runPower(supabase, vm, verb, {})

  if (!outcome.applied) {
    return { ok: false, message: outcome.reason ?? 'Nothing to do.' }
  }

  revalidatePath('/compute')

  return {
    ok: true,
    message:
      verb === 'snapshot'
        ? `Snapshot taken of ${vm.vm_name}.`
        : `${vm.vm_name} is ${TRANSITION_TO[verb]}.`,
  }
}

/**
 * One control applied across a whole app group.
 *
 * This runs as a single action rather than one action per machine on purpose:
 * the client dispatches Server Actions strictly one at a time, so firing ten
 * of them would queue ten round trips. Looping here keeps it to one, and the
 * loop is sequential because each write is independent and cheap.
 *
 * Machines that cannot take the control — already running, mid-restart — are
 * skipped rather than failing the batch.
 */
export async function powerGroup(
  groupId: string,
  verb: string
): Promise<ActionResult> {
  if (typeof groupId !== 'string' || !isPowerVerb(verb)) {
    return { ok: false, message: 'Unrecognised power request.' }
  }

  const supabase = await createClient()

  // Read the group through its own policy, so a group the caller may not see
  // simply isn't found.
  const { data: group } = await supabase
    .from('app_groups')
    .select('id, name')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return { ok: false, message: 'That group is not available to you.' }

  const { data, error } = await supabase
    .from('provisions')
    .select('*')
    .eq('app_group_id', groupId)
    .order('vm_name')
  if (error) return { ok: false, message: `Could not read the group: ${error.message}` }

  const members = (data ?? []) as Provision[]
  if (members.length === 0) {
    return { ok: false, message: `${group.name} has no machines.` }
  }

  let applied = 0
  const skipped: string[] = []
  for (const vm of members) {
    const outcome = await runPower(supabase, vm, verb, {
      via: 'app_group',
      group: group.name,
    })
    if (outcome.applied) applied += 1
    else skipped.push(outcome.reason ?? vm.vm_name)
  }

  await recordAudit(
    'group.power',
    { group: group.name, verb, applied, skipped: skipped.length },
    group.id
  )

  revalidatePath('/compute')

  if (applied === 0) {
    return {
      ok: false,
      message: `Nothing to do — ${skipped.join(', ')}.`,
    }
  }

  const tail = skipped.length > 0 ? ` ${skipped.length} skipped.` : ''
  return {
    ok: true,
    message:
      verb === 'snapshot'
        ? `Snapshotted ${applied} of ${members.length} in ${group.name}.${tail}`
        : `${verb === 'start' ? 'Starting' : verb === 'stop' ? 'Stopping' : 'Restarting'} ${applied} of ${members.length} in ${group.name}.${tail}`,
  }
}
