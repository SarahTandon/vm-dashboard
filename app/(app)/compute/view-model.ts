import type { ProvisionView, StorageTier, VmStatus } from '@/lib/provisions'

/**
 * Display helpers shared by the server page and the browser.
 *
 * Deliberately free of any server import: `lib/provisions.ts` reaches for
 * `next/headers` through the Supabase client, so a Client Component cannot
 * import values from it. Types are erased at compile time, so importing those
 * is fine — only runtime values have to live here.
 */

export type PowerVerb = 'start' | 'stop' | 'restart' | 'snapshot'

export type ActionResult = { ok: boolean; message: string }

export const POWER_VERBS: PowerVerb[] = ['start', 'stop', 'restart', 'snapshot']

export const VERB_LABELS: Record<PowerVerb, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  snapshot: 'Snapshot',
}

export const STATUS_LABELS: Record<VmStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  starting: 'Starting',
  stopping: 'Stopping',
  restarting: 'Restarting',
}

/**
 * Which statuses each control is legal from.
 *
 * The server re-checks this against a fresh read of the row before writing —
 * a disabled button is a courtesy, not a security boundary.
 */
export const VERB_REQUIRES: Record<PowerVerb, VmStatus[]> = {
  start: ['stopped'],
  stop: ['running'],
  restart: ['running'],
  // A snapshot is a read of the disk, so it is fine either powered up or down.
  snapshot: ['running', 'stopped'],
}

export function isPending(status: VmStatus): boolean {
  return status !== 'running' && status !== 'stopped'
}

export function canRun(verb: PowerVerb, status: VmStatus): boolean {
  return VERB_REQUIRES[verb].includes(status)
}

/**
 * The status at a given moment.
 *
 * All the business logic — how long a transition lasts, what each one settles
 * into — was applied on the server and arrives as two plain fields. This is
 * only a clock comparison, which is why it is safe to run in the browser.
 */
export function statusAt(row: ProvisionView, now: number): VmStatus {
  if (row.settles_to === null || row.settles_at === null) return row.status
  return now >= row.settles_at ? row.settles_to : row.status
}

/**
 * `now` is null until the browser has mounted, in which case the status the
 * server rendered is used verbatim. That keeps hydration byte-identical
 * instead of racing two clocks against a 20-second boundary.
 */
export function displayStatus(row: ProvisionView, now: number | null): VmStatus {
  return now === null ? row.effective_status : statusAt(row, now)
}

/** Whole seconds left in a pending transition, or null if it isn't pending. */
export function secondsRemaining(
  row: ProvisionView,
  now: number | null
): number | null {
  if (now === null || row.settles_at === null) return null
  if (!isPending(statusAt(row, now))) return null
  return Math.max(0, Math.ceil((row.settles_at - now) / 1000))
}

export const TIER_OPTIONS: { value: StorageTier; label: string }[] = [
  { value: 'ssd_high_perf', label: 'SSD High-Perf' },
  { value: 'standard', label: 'Standard' },
  { value: 'archive', label: 'Archive' },
]

export const STATUS_OPTIONS: { value: VmStatus; label: string }[] = [
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'starting', label: 'Starting' },
  { value: 'stopping', label: 'Stopping' },
  { value: 'restarting', label: 'Restarting' },
]

/** The four billing models from the PRD, in ascending order of commitment. */
export const COMMITMENT_TIERS: {
  value: string
  label: string
  blurb: string
}[] = [
  {
    value: 'on_demand',
    label: 'On-Demand',
    blurb: 'Billed hourly for what runs. No reserved floor.',
  },
  {
    value: 'partial_committed',
    label: 'Partial Committed',
    blurb: 'Part of the workspace is reserved, the rest burst on demand.',
  },
  {
    value: 'dedicated_committed',
    label: 'Dedicated Committed',
    blurb: 'The full allocation is reserved and billed as a block.',
  },
  {
    value: 'granular_custom',
    label: 'Granular Custom',
    blurb: 'Per-resource rates negotiated for this workspace.',
  },
]

export function commitmentLabel(tier: string): string {
  return (
    COMMITMENT_TIERS.find((t) => t.value === tier)?.label ??
    tier.replace(/_/g, ' ')
  )
}
