/**
 * Machine types and status arithmetic — the parts safe to run anywhere.
 *
 * This module deliberately imports nothing. `lib/provisions.ts` reaches for
 * the Supabase server client, which reaches for `next/headers`, so anything a
 * *client* component needs at runtime has to live here instead. Importing a
 * type from provisions.ts is fine (types are erased); importing a value is
 * what drags the server into the browser bundle.
 */

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
 * The status to show at a given moment.
 *
 * Transitions are not scheduled by anything — no timer, no background job.
 * A row says `starting` with a timestamp, and once that timestamp is old
 * enough the machine simply reads as `running`. Nothing can get stuck
 * half-way, because there is no half-way state to get stuck in.
 *
 * The clock is a parameter so a server render and the browser's hydration
 * render can be handed the same instant and agree exactly.
 */
export function statusAt(
  p: { status: VmStatus; status_changed_at: string },
  nowMs: number
): VmStatus {
  const settled = SETTLES_TO[p.status]
  if (!settled) return p.status
  const elapsed = nowMs - new Date(p.status_changed_at).getTime()
  return elapsed >= TRANSITION_MS ? settled : p.status
}

/** `statusAt` against the current clock. Server-side use only — see statusAt. */
export function effectiveStatus(p: {
  status: VmStatus
  status_changed_at: string
}): VmStatus {
  return statusAt(p, Date.now())
}

export function isTransitioning(p: {
  status: VmStatus
  status_changed_at: string
}): boolean {
  const s = effectiveStatus(p)
  return s !== 'running' && s !== 'stopped'
}

/** What a transitional status becomes once it settles, or null if already settled. */
export function settlesTo(status: VmStatus): VmStatus | null {
  return SETTLES_TO[status] ?? null
}

/**
 * The wall-clock moment a pending machine reads as settled, or null.
 *
 * Handing this to the browser is what lets the UI flip on its own: the client
 * never needs to know TRANSITION_MS or the settle table, it just compares a
 * timestamp to its own clock.
 */
export function settlesAt(p: {
  status: VmStatus
  status_changed_at: string
}): number | null {
  if (!SETTLES_TO[p.status]) return null
  return new Date(p.status_changed_at).getTime() + TRANSITION_MS
}

export const TIER_LABELS: Record<StorageTier, string> = {
  ssd_high_perf: 'SSD High-Perf',
  standard: 'Standard',
  archive: 'Archive',
}

/**
 * A plausible size for a snapshot of a disk this large.
 *
 * There is no storage layer to measure, so the number is derived rather than
 * observed: a snapshot captures the written blocks of a volume, which for
 * these workloads lands between roughly a third and two thirds of what is
 * provisioned — never the full allocation.
 *
 * Pass a seed to make the result reproducible for a given machine and
 * capture; omit it and each call varies.
 */
export function snapshotSizeGb(storageGb: number, seed?: string): number {
  const key = seed ?? String(Math.random())
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const fraction = 0.32 + (Math.abs(h) % 2600) / 10000 // 0.32 – 0.58
  return Math.max(0.01, Math.round(storageGb * fraction * 100) / 100)
}

export function snapshotLabel(vmName: string, at: Date = new Date()): string {
  return `${vmName} — ${at.toISOString().slice(0, 16).replace('T', ' ')}Z`
}
