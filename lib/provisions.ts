import { createClient } from '@/lib/supabase/server'

export type VmStatus =
  | 'running'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'restarting'

export type StorageTier = 'ssd_high_perf' | 'standard' | 'archive'

export type Provision = {
  id: string
  workspace_id: string
  user_id: string
  app_group_id: string | null
  subnet_id: string | null
  vm_name: string
  cpu_cores: number
  ram_gb: number
  storage_gb: number
  storage_tier: StorageTier
  ip_address: string | null
  status: VmStatus
  status_changed_at: string
  created_at: string
}

/** How long a simulated power transition takes to settle. */
export const TRANSITION_MS = 20_000

const SETTLES_TO: Partial<Record<VmStatus, VmStatus>> = {
  starting: 'running',
  restarting: 'running',
  stopping: 'stopped',
}

/**
 * The status to show right now.
 *
 * Transitions are not scheduled by anything — no timer, no background job.
 * A row says `starting` with a timestamp, and once that timestamp is old
 * enough the machine simply reads as `running`. Nothing can get stuck
 * half-way, because there is no half-way state to get stuck in.
 */
export function effectiveStatus(p: {
  status: VmStatus
  status_changed_at: string
}): VmStatus {
  const settled = SETTLES_TO[p.status]
  if (!settled) return p.status
  const elapsed = Date.now() - new Date(p.status_changed_at).getTime()
  return elapsed >= TRANSITION_MS ? settled : p.status
}

export function isTransitioning(p: {
  status: VmStatus
  status_changed_at: string
}): boolean {
  return effectiveStatus(p) !== 'running' && effectiveStatus(p) !== 'stopped'
}

export const TIER_LABELS: Record<StorageTier, string> = {
  ssd_high_perf: 'SSD High-Perf',
  standard: 'Standard',
  archive: 'Archive',
}

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

export async function getProvision(id: string): Promise<Provision | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('provisions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return (data as Provision) ?? null
}
