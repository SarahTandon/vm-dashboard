import { createClient } from '@/lib/supabase/server'
import {
  effectiveStatus,
  settlesAt,
  settlesTo,
  TIER_LABELS,
  type Provision,
  type VmStatus,
} from '@/lib/vm'

// The types and status arithmetic live in lib/vm.ts, which imports nothing —
// this module pulls in the Supabase server client, and a client component that
// imported a *value* from here would drag `next/headers` into the browser
// bundle. Re-exported so existing imports keep working; new client-side code
// should import from '@/lib/vm' directly.
export * from '@/lib/vm'

/**
 * Every machine the signed-in person is allowed to see.
 * The filtering is done by the database, not here — an admin gets the whole
 * workspace and a standard user gets their own, from the same query.
 */
export async function listProvisions(): Promise<Provision[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('provisions')
    .select('*')
    .order('vm_name')
  return (data ?? []) as Provision[]
}

/**
 * A machine with everything the table renders already resolved.
 *
 * The owner's name and the group's name come from the database in the same
 * round trip, and the status is pre-computed so the first paint on the server
 * and the first paint in the browser agree exactly. After that the browser
 * takes over using `settles_at`.
 */
export type ProvisionView = Provision & {
  owner_name: string
  group_id: string | null
  group_name: string | null
  tier_label: string
  effective_status: VmStatus
  settles_to: VmStatus | null
  settles_at: number | null
}

export type AppGroup = {
  id: string
  workspace_id: string
  owner_user_id: string
  name: string
  created_at: string
  owner_name: string
}

/**
 * An embedded to-one row comes back as an object, but PostgREST will hand back
 * an array if it reads the relationship the other way round. Tolerating both
 * costs three lines and removes a whole class of "why is every owner Unknown".
 */
type Embedded<T> = T | T[] | null

function one<T>(value: Embedded<T>): T | null {
  if (value === null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type JoinedProvision = Provision & {
  owner: Embedded<{ full_name: string }>
  group: Embedded<{ name: string }>
}

function toView(row: JoinedProvision): ProvisionView {
  const { owner, group, ...p } = row
  return {
    ...p,
    owner_name: one(owner)?.full_name ?? 'Unknown owner',
    group_id: p.app_group_id,
    // Null when the machine is in a group but the group row itself is not
    // readable — a standard user only sees groups they own.
    group_name: one(group)?.name ?? null,
    tier_label: TIER_LABELS[p.storage_tier] ?? p.storage_tier,
    effective_status: effectiveStatus(p),
    settles_to: settlesTo(p.status),
    settles_at: settlesAt(p),
  }
}

/**
 * The inventory, with owner and group names joined in.
 *
 * Same rule as `listProvisions` — no workspace or user filter here, because
 * the policy on `provisions` has already applied it. The embedded `users` and
 * `app_groups` rows are filtered by their own policies in turn.
 */
export async function listProvisionViews(): Promise<ProvisionView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('provisions')
    .select('*, owner:users(full_name), group:app_groups(name)')
    .order('vm_name')

  if (error) throw new Error(`Could not load machines: ${error.message}`)
  return ((data ?? []) as JoinedProvision[]).map(toView)
}

/** Every app group the caller may see. Admins get the workspace, users get their own. */
export async function listAppGroups(): Promise<AppGroup[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('app_groups')
    .select('*, owner:users(full_name)')
    .order('name')

  if (error) throw new Error(`Could not load app groups: ${error.message}`)

  type JoinedGroup = Omit<AppGroup, 'owner_name'> & {
    owner: Embedded<{ full_name: string }>
  }
  return ((data ?? []) as JoinedGroup[]).map(({ owner, ...g }) => ({
    ...g,
    owner_name: one(owner)?.full_name ?? 'Unknown owner',
  }))
}

// snapshotSizeGb and snapshotLabel now live in lib/vm.ts and reach this
// module's consumers through the `export *` above — one implementation
// instead of the two the parallel tracks each wrote.

export async function getProvision(id: string): Promise<Provision | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('provisions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return (data as Provision) ?? null
}
