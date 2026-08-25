import {
  SUBNET_KIND_BLURBS,
  SUBNET_KIND_LABELS,
  isPrivateRange,
  type AppGroup,
  type Subnet,
  type SubnetKind,
} from '@/lib/network'
import { effectiveStatus, type Provision } from '@/lib/provisions'
import styles from './network.module.css'

const KIND_CLASS: Record<SubnetKind, string> = {
  routed: styles.kindRouted,
  isolated: styles.kindIsolated,
  app_group: styles.kindGroup,
}

function statusDot(p: Provision) {
  const status = effectiveStatus(p)
  if (status === 'running') return styles.dotRunning
  if (status === 'stopped') return styles.dotStopped
  return styles.dotBusy
}

function Machines({
  machines,
  isAdmin,
}: {
  machines: Provision[]
  isAdmin: boolean
}) {
  if (machines.length === 0) {
    return (
      <p className={styles.empty}>
        {isAdmin
          ? 'No machines on this subnet.'
          : 'None of your machines are on this subnet.'}
      </p>
    )
  }

  return (
    <>
      <div className="muted small">
        {machines.length} {machines.length === 1 ? 'machine' : 'machines'}
        {isAdmin ? '' : ' of yours'}
      </div>
      <div className={styles.memberList}>
        {machines.map((m) => (
          <span key={m.id} className={styles.member}>
            <span className={`${styles.dot} ${statusDot(m)}`} aria-hidden />
            {m.vm_name}
            {m.ip_address && (
              <span className={`${styles.mono} muted`}>{m.ip_address}</span>
            )}
          </span>
        ))}
      </div>
    </>
  )
}

/**
 * The subnet topology, visible to everyone in the workspace.
 *
 * The machine lists come from `listProvisions()`, which is filtered by the
 * database: an admin sees every machine on a subnet, a standard user sees only
 * their own. A subnet showing no machines for a standard user is therefore the
 * correct answer, not a gap in the data — the copy says so rather than
 * pretending the subnet is empty.
 */
export function SubnetTopology({
  subnets,
  appGroups,
  provisions,
  isAdmin,
}: {
  subnets: Subnet[]
  appGroups: AppGroup[]
  provisions: Provision[]
  isAdmin: boolean
}) {
  const groupName = new Map(appGroups.map((g) => [g.id, g.name]))

  const bySubnet = new Map<string, Provision[]>()
  const unassigned: Provision[] = []
  for (const p of provisions) {
    if (!p.subnet_id) {
      unassigned.push(p)
      continue
    }
    const list = bySubnet.get(p.subnet_id)
    if (list) list.push(p)
    else bySubnet.set(p.subnet_id, [p])
  }

  return (
    <section className="panel">
      <div className={styles.panelHead}>
        <div>
          <h2>Subnet topology</h2>
          <p className="muted small">
            {subnets.length} active{' '}
            {subnets.length === 1 ? 'subnet' : 'subnets'} in this workspace.
          </p>
        </div>
      </div>

      <div className={styles.note}>
        <div>
          <p>
            <strong>Addresses are unique per workspace, not globally.</strong>{' '}
            Another tenant on this platform may be running the exact same
            private range — <span className={styles.mono}>192.168.1.0/24</span>{' '}
            and <span className={styles.mono}>10.0.5.0/24</span> are both in use
            by more than one company.
          </p>
          <p className="muted">
            Overlap is safe because a subnet only ever means something inside
            the workspace that owns it; the database enforces uniqueness on
            (workspace, CIDR). It is the NAT mappings below that give a machine
            an address the outside world can reach.
          </p>
        </div>
      </div>

      {subnets.length === 0 ? (
        <p className={styles.empty}>No subnets defined for this workspace.</p>
      ) : (
        <div className={styles.subnets}>
          {subnets.map((s) => {
            const machines = bySubnet.get(s.id) ?? []
            const group = s.app_group_id
              ? groupName.get(s.app_group_id)
              : undefined

            return (
              <article key={s.id} className={styles.subnet}>
                <div className={styles.subnetHead}>
                  <span className={styles.subnetName}>{s.name}</span>
                  <span
                    className={`badge ${styles.kind} ${KIND_CLASS[s.kind]}`}
                  >
                    {SUBNET_KIND_LABELS[s.kind]}
                  </span>
                  <span className={`${styles.mono} ${styles.cidr}`}>
                    {s.cidr}
                  </span>
                  {isPrivateRange(s.cidr) && (
                    <span
                      className={`badge ${styles.overlapFlag}`}
                      title="A private range — other tenants may use the same one."
                    >
                      private range
                    </span>
                  )}
                </div>

                <div className={`${styles.subnetMeta} muted small`}>
                  <span>{SUBNET_KIND_BLURBS[s.kind]}</span>
                  {s.kind === 'app_group' && (
                    <span>
                      Application group:{' '}
                      <strong>
                        {group ??
                          (isAdmin
                            ? 'unassigned'
                            : 'a group you are not a member of')}
                      </strong>
                    </span>
                  )}
                </div>

                <div className={styles.members}>
                  <Machines machines={machines} isAdmin={isAdmin} />
                </div>
              </article>
            )
          })}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className={styles.members}>
          <div className="muted small">
            {unassigned.length}{' '}
            {unassigned.length === 1 ? 'machine is' : 'machines are'} not
            attached to any subnet.
          </div>
          <div className={styles.memberList}>
            {unassigned.map((m) => (
              <span key={m.id} className={styles.member}>
                <span className={`${styles.dot} ${statusDot(m)}`} aria-hidden />
                {m.vm_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
