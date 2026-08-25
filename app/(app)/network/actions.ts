'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'

/**
 * Perimeter mutations.
 *
 * A Server Action is a public POST endpoint, so each one re-checks who is
 * asking rather than trusting that the form was only rendered for admins.
 * The real boundary is still the database: `firewall_rules` and `nat_rules`
 * carry admin-only policies, so a non-admin's write matches zero rows even if
 * the check here were wrong. Every successful change is written to the audit log.
 */

export type RuleFormState = { error: string | null } | null

const OK: RuleFormState = { error: null }

function fail(message: string): RuleFormState {
  return { error: message }
}

type PgError = { code?: string; message?: string } | null

/** Turn a Postgres/PostgREST failure into something a person can act on. */
function describe(error: PgError, context: 'firewall' | 'nat'): string {
  const code = error?.code
  if (code === '23505') {
    return context === 'firewall'
      ? 'Another rule already uses that priority. Priorities are unique within a workspace — pick a different number.'
      : 'That rule already exists.'
  }
  if (code === '22P02' || code === '22007') {
    return 'One of the values is not in a form the database accepts — check the IP addresses.'
  }
  if (code === '42501' || code === 'PGRST301') {
    return 'You do not have permission to change perimeter rules.'
  }
  if (code === '23514') {
    return 'One of the values is outside the range the database allows.'
  }
  return error?.message ?? 'The change could not be saved.'
}

async function requireAdmin(): Promise<
  { ok: true; workspaceId: string } | { ok: false; state: RuleFormState }
> {
  const user = await requireUser()
  if (user.role !== 'admin') {
    return {
      ok: false,
      state: fail('Perimeter rules are managed by workspace admins.'),
    }
  }
  return { ok: true, workspaceId: user.workspaceId }
}

function done(): RuleFormState {
  revalidatePath('/network')
  return OK
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

function text(formData: FormData, name: string, fallback = 'any'): string {
  const value = String(formData.get(name) ?? '').trim()
  return value === '' ? fallback : value
}

function id(formData: FormData): string {
  return String(formData.get('id') ?? '').trim()
}

function oneOf<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[]
): T | null {
  const value = String(formData.get(name) ?? '').trim()
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function parsePriority(formData: FormData): number | null {
  const raw = String(formData.get('priority') ?? '').trim()
  if (!/^\d{1,6}$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1 && value <= 65535 ? value : null
}

/** An optional port: blank means "no port", which the column stores as null. */
function parseOptionalPort(
  formData: FormData,
  name: string
): { ok: true; value: number | null } | { ok: false } {
  const raw = String(formData.get(name) ?? '').trim()
  if (raw === '') return { ok: true, value: null }
  if (!/^\d{1,5}$/.test(raw)) return { ok: false }
  const value = Number(raw)
  if (value < 1 || value > 65535) return { ok: false }
  return { ok: true, value }
}

/**
 * A light shape check on an address. The column type is `inet`, so Postgres is
 * the real validator — this only catches the obvious typo before the round trip
 * and keeps the error next to the field the person was editing.
 */
function looksLikeAddress(value: string): boolean {
  if (value.includes(':')) return /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(value)
  return /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)
}

function checkbox(formData: FormData, name: string): boolean {
  const value = formData.get(name)
  return value === 'on' || value === 'true' || value === '1'
}

// ---------------------------------------------------------------------------
// Firewall rules — North-South edge
// ---------------------------------------------------------------------------

const ACTIONS = ['allow', 'deny'] as const
const DIRECTIONS = ['inbound', 'outbound'] as const

type FirewallFields = {
  priority: number
  action: 'allow' | 'deny'
  direction: 'inbound' | 'outbound'
  protocol: string
  source: string
  destination: string
  port_range: string
  enabled: boolean
}

function readFirewallFields(
  formData: FormData
): { ok: true; fields: FirewallFields } | { ok: false; state: RuleFormState } {
  const priority = parsePriority(formData)
  if (priority === null) {
    return {
      ok: false,
      state: fail('Priority must be a whole number between 1 and 65535.'),
    }
  }

  const action = oneOf(formData, 'action', ACTIONS)
  const direction = oneOf(formData, 'direction', DIRECTIONS)
  if (!action || !direction) {
    return { ok: false, state: fail('Pick an action and a direction.') }
  }

  return {
    ok: true,
    fields: {
      priority,
      action,
      direction,
      protocol: text(formData, 'protocol'),
      source: text(formData, 'source'),
      destination: text(formData, 'destination'),
      port_range: text(formData, 'port_range'),
      enabled: checkbox(formData, 'enabled'),
    },
  }
}

export async function createFirewallRule(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const parsed = readFirewallFields(formData)
  if (!parsed.ok) return parsed.state

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('firewall_rules')
    .insert({ workspace_id: auth.workspaceId, ...parsed.fields })
    .select('id')
    .maybeSingle()

  if (error) return fail(describe(error, 'firewall'))
  if (!data) return fail('The rule could not be created.')

  await recordAudit('firewall_rule.created', { ...parsed.fields }, data.id)
  return done()
}

export async function updateFirewallRule(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const ruleId = id(formData)
  if (!ruleId) return fail('Which rule? The form did not carry a rule id.')

  const parsed = readFirewallFields(formData)
  if (!parsed.ok) return parsed.state

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('firewall_rules')
    .update(parsed.fields)
    .eq('id', ruleId)
    .select('id')
    .maybeSingle()

  if (error) return fail(describe(error, 'firewall'))
  // Zero rows means the policy did not match it — treat as not found.
  if (!data) return fail('That rule is no longer available to edit.')

  await recordAudit('firewall_rule.updated', { ...parsed.fields }, ruleId)
  return done()
}

export async function setFirewallRuleEnabled(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const ruleId = id(formData)
  if (!ruleId) return fail('Which rule? The form did not carry a rule id.')
  const enabled = checkbox(formData, 'enabled')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('firewall_rules')
    .update({ enabled })
    .eq('id', ruleId)
    .select('id')
    .maybeSingle()

  if (error) return fail(describe(error, 'firewall'))
  if (!data) return fail('That rule is no longer available to change.')

  await recordAudit('firewall_rule.toggled', { enabled }, ruleId)
  return done()
}

export async function deleteFirewallRule(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const ruleId = id(formData)
  if (!ruleId) return fail('Which rule? The form did not carry a rule id.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('firewall_rules')
    .delete()
    .eq('id', ruleId)
    .select('id, priority')
    .maybeSingle()

  if (error) return fail(describe(error, 'firewall'))
  if (!data) return fail('That rule has already been removed.')

  await recordAudit('firewall_rule.deleted', { priority: data.priority }, ruleId)
  return done()
}

// ---------------------------------------------------------------------------
// NAT rules — SNAT / DNAT public address mapping
// ---------------------------------------------------------------------------

const NAT_KINDS = ['snat', 'dnat'] as const

type NatFields = {
  kind: 'snat' | 'dnat'
  internal_ip: string
  external_ip: string
  internal_port: number | null
  external_port: number | null
  enabled: boolean
}

function readNatFields(
  formData: FormData
): { ok: true; fields: NatFields } | { ok: false; state: RuleFormState } {
  const kind = oneOf(formData, 'kind', NAT_KINDS)
  if (!kind) return { ok: false, state: fail('Pick SNAT or DNAT.') }

  const internalIp = String(formData.get('internal_ip') ?? '').trim()
  const externalIp = String(formData.get('external_ip') ?? '').trim()
  if (!looksLikeAddress(internalIp)) {
    return { ok: false, state: fail('Internal IP is not a valid address.') }
  }
  if (!looksLikeAddress(externalIp)) {
    return { ok: false, state: fail('External IP is not a valid address.') }
  }

  const internalPort = parseOptionalPort(formData, 'internal_port')
  const externalPort = parseOptionalPort(formData, 'external_port')
  if (!internalPort.ok || !externalPort.ok) {
    return {
      ok: false,
      state: fail('Ports must be whole numbers between 1 and 65535, or blank.'),
    }
  }

  return {
    ok: true,
    fields: {
      kind,
      internal_ip: internalIp,
      external_ip: externalIp,
      internal_port: internalPort.value,
      external_port: externalPort.value,
      enabled: checkbox(formData, 'enabled'),
    },
  }
}

export async function createNatRule(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const parsed = readNatFields(formData)
  if (!parsed.ok) return parsed.state

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('nat_rules')
    .insert({ workspace_id: auth.workspaceId, ...parsed.fields })
    .select('id')
    .maybeSingle()

  if (error) return fail(describe(error, 'nat'))
  if (!data) return fail('The mapping could not be created.')

  await recordAudit('nat_rule.created', { ...parsed.fields }, data.id)
  return done()
}

export async function updateNatRule(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const ruleId = id(formData)
  if (!ruleId) return fail('Which mapping? The form did not carry a rule id.')

  const parsed = readNatFields(formData)
  if (!parsed.ok) return parsed.state

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('nat_rules')
    .update(parsed.fields)
    .eq('id', ruleId)
    .select('id')
    .maybeSingle()

  if (error) return fail(describe(error, 'nat'))
  if (!data) return fail('That mapping is no longer available to edit.')

  await recordAudit('nat_rule.updated', { ...parsed.fields }, ruleId)
  return done()
}

export async function setNatRuleEnabled(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const ruleId = id(formData)
  if (!ruleId) return fail('Which mapping? The form did not carry a rule id.')
  const enabled = checkbox(formData, 'enabled')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('nat_rules')
    .update({ enabled })
    .eq('id', ruleId)
    .select('id')
    .maybeSingle()

  if (error) return fail(describe(error, 'nat'))
  if (!data) return fail('That mapping is no longer available to change.')

  await recordAudit('nat_rule.toggled', { enabled }, ruleId)
  return done()
}

export async function deleteNatRule(
  _prev: RuleFormState,
  formData: FormData
): Promise<RuleFormState> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.state

  const ruleId = id(formData)
  if (!ruleId) return fail('Which mapping? The form did not carry a rule id.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('nat_rules')
    .delete()
    .eq('id', ruleId)
    .select('id, kind, external_ip')
    .maybeSingle()

  if (error) return fail(describe(error, 'nat'))
  if (!data) return fail('That mapping has already been removed.')

  await recordAudit(
    'nat_rule.deleted',
    { kind: data.kind, external_ip: data.external_ip },
    ruleId
  )
  return done()
}
