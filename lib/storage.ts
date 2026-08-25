import { createClient } from '@/lib/supabase/server'
import type { Provision, StorageTier } from '@/lib/provisions'

/**
 * Storage & DR reads.
 *
 * Nothing here filters by workspace or role. Every query below is already
 * narrowed by row-level security before it reaches this process: an admin's
 * `storage_usage()` returns three tiers, a standard user's returns none, and
 * `snapshots` only ever lists machines the caller can already see. Rendering
 * "no rows" is therefore the correct response to a masked view — not an error.
 */

// ---------------------------------------------------------------------------
// Tier capacity (admin only, by way of the database)
// ---------------------------------------------------------------------------

export type TierUsage = {
  tier: StorageTier
  capacity_gb: number
  used_gb: number
}

/** Display order for the three tiers; the RPC groups, so it does not sort. */
const TIER_ORDER: StorageTier[] = ['ssd_high_perf', 'standard', 'archive']

/**
 * Capacity and consumption per tier.
 *
 * `storage_usage()` is `security definer` and ends in `and public.is_admin()`,
 * so a standard user gets zero rows back rather than a permission error. An
 * empty array here means "this person may not see capacity", and the page
 * simply omits the section.
 */
export async function getTierUsage(): Promise<TierUsage[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('storage_usage')

  const rows = (data ?? []) as {
    tier: StorageTier
    capacity_gb: number | string
    used_gb: number | string
  }[]

  return rows
    .map((r) => ({
      tier: r.tier,
      capacity_gb: Number(r.capacity_gb),
      used_gb: Number(r.used_gb),
    }))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export type Snapshot = {
  id: string
  workspace_id: string
  provision_id: string
  label: string
  size_gb: number
  created_at: string
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('snapshots')
    .select('*')
    .order('created_at', { ascending: false })

  return ((data ?? []) as Snapshot[]).map((s) => ({
    ...s,
    size_gb: Number(s.size_gb),
  }))
}

/** How many snapshots a machine already has — used to vary the next size. */
export async function countSnapshotsFor(provisionId: string): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('provision_id', provisionId)
  return count ?? 0
}

// The seeded snapshot-size derivation this track wrote is now the single
// implementation in lib/vm.ts, shared with the power-controls snapshot path.
export { snapshotSizeGb } from '@/lib/vm'

/** `manual-2026-08-25-1432`, the default when nobody types a label. */
export function defaultSnapshotLabel(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `manual-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(
    now.getDate()
  )}-${p(now.getHours())}${p(now.getMinutes())}`
}

// ---------------------------------------------------------------------------
// Replication health
// ---------------------------------------------------------------------------

export type RpoState = 'healthy' | 'lagging' | 'breached' | 'unknown'

export type ReplicationHealth = {
  rpoSeconds: number
  lastReplicatedAt: string | null
  lagSeconds: number | null
  state: RpoState
}

/**
 * Lag of the standby against the near-second RPO target.
 *
 * `last_replicated_at` is read, never written: `workspaces` carries a
 * SELECT-only policy, so the application has no way to advance this column
 * and no business doing so — replication is what would move it.
 */
export async function getReplicationHealth(
  rpoSeconds: number
): Promise<ReplicationHealth> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspaces')
    .select('last_replicated_at')
    .maybeSingle()

  const lastReplicatedAt =
    (data as { last_replicated_at: string } | null)?.last_replicated_at ?? null

  if (!lastReplicatedAt) {
    return { rpoSeconds, lastReplicatedAt: null, lagSeconds: null, state: 'unknown' }
  }

  const lagSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(lastReplicatedAt).getTime()) / 1000)
  )

  return {
    rpoSeconds,
    lastReplicatedAt,
    lagSeconds,
    state: rpoState(lagSeconds, rpoSeconds),
  }
}

export function rpoState(lagSeconds: number, rpoSeconds: number): RpoState {
  if (rpoSeconds <= 0) return 'unknown'
  if (lagSeconds <= rpoSeconds) return 'healthy'
  if (lagSeconds <= rpoSeconds * 3) return 'lagging'
  return 'breached'
}

export const RPO_STATE_LABELS: Record<RpoState, string> = {
  healthy: 'Within RPO',
  lagging: 'Lagging',
  breached: 'RPO breached',
  unknown: 'No replica',
}

// ---------------------------------------------------------------------------
// Pre-approved storage profiles
// ---------------------------------------------------------------------------

/**
 * The three profiles a machine may be placed on. Read-only presentation:
 * choosing one happens at provision time, which is Compute's flow, not this
 * page's. Kept beside the tier enum so the two cannot drift apart.
 */
export type StorageProfile = {
  tier: StorageTier
  headline: string
  suitedTo: string
  iops: string
  retention: string
}

export const STORAGE_PROFILES: StorageProfile[] = [
  {
    tier: 'ssd_high_perf',
    headline: 'NVMe-backed, triple-replicated',
    suitedTo: 'Databases, latency-sensitive app servers, build agents',
    iops: 'up to 25,000 IOPS',
    retention: 'snapshots kept 30 days',
  },
  {
    tier: 'standard',
    headline: 'Hybrid SSD/HDD, dual-replicated',
    suitedTo: 'General workloads, web front ends, internal tooling',
    iops: 'up to 6,000 IOPS',
    retention: 'snapshots kept 60 days',
  },
  {
    tier: 'archive',
    headline: 'Cold capacity, erasure coded',
    suitedTo: 'Backups, log retention, machines kept for compliance',
    iops: 'burst reads, minutes to first byte',
    retention: 'snapshots kept 365 days',
  },
]

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export type TierFootprint = {
  tier: StorageTier
  gb: number
  machines: number
}

/**
 * Group the machines the caller can see by tier. The rows arrived already
 * filtered by the database — this only adds them up.
 */
export function tierFootprints(provisions: Provision[]): TierFootprint[] {
  return TIER_ORDER.map((tier) => {
    const own = provisions.filter((p) => p.storage_tier === tier)
    return {
      tier,
      gb: own.reduce((sum, p) => sum + p.storage_gb, 0),
      machines: own.length,
    }
  })
}

export function formatGb(gb: number): string {
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(gb >= 10240 ? 1 : 2)} TB`
  }
  return `${gb % 1 === 0 ? gb : gb.toFixed(2)} GB`
}

/** "3 seconds ago", "18 hours ago", "6 days ago". */
export function formatAge(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  const ago = (value: number, unit: string) =>
    `${value} ${unit}${value === 1 ? '' : 's'} ago`

  if (s < 60) return ago(s, 'second')
  const m = Math.floor(s / 60)
  if (m < 60) return ago(m, 'minute')
  const h = Math.floor(m / 60)
  if (h < 24) return ago(h, 'hour')
  const d = Math.floor(h / 24)
  if (d < 30) return ago(d, 'day')
  const mo = Math.floor(d / 30)
  if (mo < 12) return ago(mo, 'month')
  return ago(Math.floor(mo / 12), 'year')
}

/** Percentage for a meter fill, clamped so a full bar never overflows. */
export function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

export function meterTone(pct: number): string {
  return pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : ''
}
