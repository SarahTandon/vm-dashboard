import { requireUser } from '@/lib/auth'
import {
  listAppGroups,
  listFirewallRules,
  listNatRules,
  listSubnets,
} from '@/lib/network'
import { listProvisions } from '@/lib/provisions'
import { FirewallPanel } from './firewall-panel'
import { NatPanel } from './nat-panel'
import { SubnetTopology } from './subnet-topology'
import styles from './network.module.css'

/**
 * Networking & Edge Controls (PRD §3.3).
 *
 * There is no network hardware behind any of this. A firewall rule is a row;
 * changing one changes a row and nothing else.
 *
 * Two audiences share the page. Everyone sees the subnet topology. The
 * perimeter panels are admin-only, and the policies on `firewall_rules` and
 * `nat_rules` are what make that true — a standard user's query returns zero
 * rows. The role check below only decides whether to render an explanation in
 * place of two empty tables; it is not the security boundary.
 */
export default async function NetworkPage() {
  const user = await requireUser()
  const isAdmin = user.role === 'admin'

  const [subnets, appGroups, provisions, firewallRules, natRules] =
    await Promise.all([
      listSubnets(),
      listAppGroups(),
      listProvisions(),
      isAdmin ? listFirewallRules() : Promise.resolve([]),
      isAdmin ? listNatRules() : Promise.resolve([]),
    ])

  return (
    <div className={styles.net}>
      <header className="page-head">
        <h1>Networking &amp; edge controls</h1>
        <p className="muted">
          Subnets, North-South firewall rules, and public address mapping for{' '}
          {user.workspaceName}.
        </p>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">Subnets</div>
          <div className="card-value">{subnets.length}</div>
          <div className="muted small">Visible to everyone in the workspace</div>
        </div>

        {isAdmin ? (
          <>
            <div className="card">
              <div className="card-label">Firewall rules</div>
              <div className="card-value">{firewallRules.length}</div>
              <div className="muted small">
                {firewallRules.filter((r) => r.enabled).length} enabled
              </div>
            </div>

            <div className="card">
              <div className="card-label">NAT mappings</div>
              <div className="card-value">{natRules.length}</div>
              <div className="muted small">
                {natRules.filter((r) => r.enabled).length} enabled
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="card-label">Perimeter</div>
            <div className="card-value small-value">Admin managed</div>
            <div className="muted small">Firewall and NAT are not shown</div>
          </div>
        )}
      </section>

      <SubnetTopology
        subnets={subnets}
        appGroups={appGroups}
        provisions={provisions}
        isAdmin={isAdmin}
      />

      {isAdmin ? (
        <>
          <FirewallPanel rules={firewallRules} />
          <NatPanel rules={natRules} />
        </>
      ) : (
        <section className="panel">
          <h2>Perimeter security</h2>
          <div className={`${styles.restricted} muted small`}>
            <p>
              Edge firewall rules and SNAT/DNAT mappings are managed by your
              workspace admins. They are not hidden from this page by the page —
              the database returns no rows for a standard account, so there is
              nothing here to reveal.
            </p>
            <p>
              The topology above still shows every subnet in the workspace,
              along with the machines on them that belong to you.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
