import { createClient } from '@/lib/supabase/server'
import { listProvisions, type Provision } from '@/lib/provisions'

/**
 * Chargeback and showback.
 *
 * The masking is done by the database, not here. `workspace_settings` carries
 * the prices and its policy is admin-only, so a standard user's query returns
 * zero rows and `monthly_spend()` returns 0. `loadFinancials()` returns null
 * when there are no rates to price with, which is exactly the case for a
 * standard user — the caller then renders nothing at all.
 */

export type Rates = {
  vcpu_hour: number
  ram_gb_hour: number
  storage_gb_month: number
}

export type ShowbackRow = {
  key: string
  label: string
  machines: number
  vcpu: number
  ramGb: number
  storageGb: number
  cost: number
}

export type Financials = {
  /** Month-to-date spend, straight from `monthly_spend()`. */
  spend: number
  rates: Rates
  byProject: ShowbackRow[]
  byOwner: ShowbackRow[]
  /** Sum of the priced rows. Should track `spend` closely; shown as a check. */
  attributed: number
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Start of the current month in UTC, in milliseconds.
 * Mirrors `date_trunc('month', now())` in `monthly_spend()`, which runs in the
 * database session's timezone — UTC on Supabase.
 */
export function monthStartMs(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/**
 * What one machine has cost so far this month.
 *
 * Deliberately the same arithmetic as the `monthly_spend()` SQL function:
 * hours since the later of "created" and "start of month", priced on compute,
 * plus a flat monthly charge for its disk. Per-row here so the total can be
 * broken down by project and by owner; the database still owns the headline
 * number.
 */
export function costOf(p: Provision, rates: Rates, nowMs: number): number {
  const start = Math.max(new Date(p.created_at).getTime(), monthStartMs(nowMs))
  const hours = Math.max(0, (nowMs - start) / 3_600_000)
  return (
    hours * (p.cpu_cores * rates.vcpu_hour + p.ram_gb * rates.ram_gb_hour) +
    p.storage_gb * rates.storage_gb_month
  )
}

function summarise(
  provisions: Provision[],
  rates: Rates,
  nowMs: number,
  bucket: (p: Provision) => { key: string; label: string }
): ShowbackRow[] {
  const rows = new Map<string, ShowbackRow>()

  for (const p of provisions) {
    const { key, label } = bucket(p)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        label,
        machines: 0,
        vcpu: 0,
        ramGb: 0,
        storageGb: 0,
        cost: 0,
      }
      rows.set(key, row)
    }
    row.machines += 1
    row.vcpu += p.cpu_cores
    row.ramGb += p.ram_gb
    row.storageGb += p.storage_gb
    row.cost += costOf(p, rates, nowMs)
  }

  return [...rows.values()].sort((a, b) => b.cost - a.cost)
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Everything the financial section needs, or null when the caller may not see
 * it. `nowMs` is the page's single server timestamp, so every figure on the
 * page is priced to the same instant.
 */
export async function loadFinancials(nowMs: number): Promise<Financials | null> {
  const supabase = await createClient()

  // Zero rows for a standard user — the policy on this table is the masking.
  const { data: settings } = await supabase
    .from('workspace_settings')
    .select('vcpu_hour, ram_gb_hour, storage_gb_month')
    .maybeSingle()

  if (!settings) return null

  const rates: Rates = {
    vcpu_hour: Number(settings.vcpu_hour),
    ram_gb_hour: Number(settings.ram_gb_hour),
    storage_gb_month: Number(settings.storage_gb_month),
  }

  const [{ data: spendRaw }, { data: groups }, { data: people }, provisions] =
    await Promise.all([
      supabase.rpc('monthly_spend'),
      supabase.from('app_groups').select('id, name'),
      supabase.from('users').select('id, full_name'),
      listProvisions(),
    ])

  const groupName = new Map(
    ((groups ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name])
  )
  const personName = new Map(
    ((people ?? []) as { id: string; full_name: string }[]).map((u) => [
      u.id,
      u.full_name,
    ])
  )

  const byProject = summarise(provisions, rates, nowMs, (p) => ({
    key: p.app_group_id ?? 'ungrouped',
    label: p.app_group_id
      ? (groupName.get(p.app_group_id) ?? 'Unknown project')
      : 'Ungrouped',
  }))

  const byOwner = summarise(provisions, rates, nowMs, (p) => ({
    key: p.user_id,
    label: personName.get(p.user_id) ?? 'Unknown owner',
  }))

  return {
    spend: Number(spendRaw ?? 0),
    rates,
    byProject,
    byOwner,
    attributed: byProject.reduce((sum, r) => sum + r.cost, 0),
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Currency without `toLocaleString`, whose output depends on the runtime's
 *  locale — a server render and a client render could disagree. */
export function money(v: number): string {
  const sign = v < 0 ? '-' : ''
  const [whole, cents] = Math.abs(v).toFixed(2).split('.')
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}

/** Rates are quoted per hour but read better per month at a glance. */
export const HOURS_PER_MONTH = 730
