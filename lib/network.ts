import { createClient } from '@/lib/supabase/server'

/**
 * Networking data access.
 *
 * The database is the source of truth and row-level security is the filter.
 * Nothing here narrows rows by workspace or role — `subnets` is readable by
 * every member of a workspace, while `firewall_rules` and `nat_rules` are
 * admin-only for both read and write. A standard user's query against those
 * two tables returns zero rows, which is the intended behaviour rather than
 * an error to handle.
 */

export type SubnetKind = 'routed' | 'isolated' | 'app_group'

export type Subnet = {
  id: string
  workspace_id: string
  name: string
  kind: SubnetKind
  cidr: string
  app_group_id: string | null
}

export type AppGroup = {
  id: string
  name: string
}

export type FirewallAction = 'allow' | 'deny'
export type FirewallDirection = 'inbound' | 'outbound'

export type FirewallRule = {
  id: string
  workspace_id: string
  priority: number
  action: FirewallAction
  direction: FirewallDirection
  protocol: string
  source: string
  destination: string
  port_range: string
  enabled: boolean
}

export type NatKind = 'snat' | 'dnat'

export type NatRule = {
  id: string
  workspace_id: string
  kind: NatKind
  internal_ip: string
  external_ip: string
  internal_port: number | null
  external_port: number | null
  enabled: boolean
}

export const SUBNET_KIND_LABELS: Record<SubnetKind, string> = {
  routed: 'Routed',
  isolated: 'Isolated',
  app_group: 'Application Group Network',
}

export const SUBNET_KIND_BLURBS: Record<SubnetKind, string> = {
  routed: 'Reachable through the edge, subject to the firewall and NAT rules.',
  isolated: 'No path to or from the edge — east-west traffic only.',
  app_group: 'Private network belonging to a single application group.',
}

/** Sort order for the topology list: routed, then isolated, then group nets. */
const KIND_ORDER: Record<SubnetKind, number> = {
  routed: 0,
  isolated: 1,
  app_group: 2,
}

export async function listSubnets(): Promise<Subnet[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subnets')
    .select('id, workspace_id, name, kind, cidr, app_group_id')
    .order('name')

  const rows = (data ?? []) as Subnet[]
  return rows
    .slice()
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)
    )
}

/**
 * App group names, for labelling application-group networks.
 *
 * The policy on `app_groups` lets an admin see every group in the workspace
 * but a standard user only the groups they own. A missing name therefore means
 * "not yours to see", not "missing data" — callers fall back to a neutral label.
 */
export async function listAppGroups(): Promise<AppGroup[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('app_groups').select('id, name')
  return (data ?? []) as AppGroup[]
}

export async function listFirewallRules(): Promise<FirewallRule[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('firewall_rules')
    .select(
      'id, workspace_id, priority, action, direction, protocol, source, destination, port_range, enabled'
    )
    .order('priority')
  return (data ?? []) as FirewallRule[]
}

export async function listNatRules(): Promise<NatRule[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('nat_rules')
    .select(
      'id, workspace_id, kind, internal_ip, external_ip, internal_port, external_port, enabled'
    )
    .order('kind')
    .order('external_ip')
  return (data ?? []) as NatRule[]
}

/**
 * True for the RFC 1918 ranges the PRD calls out as overlapping between
 * tenants. Used only to decide whether to flag a row in the UI.
 */
export function isPrivateRange(cidr: string): boolean {
  const address = cidr.split('/')[0] ?? ''
  const [a, b] = address.split('.').map((n) => Number(n))
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}
