import { requireUser } from '@/lib/auth'
import { listProvisions, TIER_LABELS, effectiveStatus } from '@/lib/provisions'
import {
  formatAge,
  formatGb,
  getReplicationHealth,
  getTierUsage,
  listSnapshots,
  meterTone,
  pctOf,
  RPO_STATE_LABELS,
  STORAGE_PROFILES,
  tierFootprints,
} from '@/lib/storage'
import DrPanel from './dr-panel'
import SnapshotForm from './snapshot-form'
import styles from './storage.module.css'

const STATE_CLASS = {
  healthy: styles.ok,
  lagging: styles.warn,
  breached: styles.hot,
  unknown: styles.neutral,
} as const

export default async function StoragePage() {
  const user = await requireUser()

  // Four independent reads, each already narrowed by row-level security.
  const [tierUsage, provisions, snapshots, replication] = await Promise.all([
    getTierUsage(),
    listProvisions(),
    listSnapshots(),
    getReplicationHealth(user.rpoSeconds),
  ])

  // `storage_usage()` ends in `and public.is_admin()`, so a standard user gets
  // zero rows rather than an error. Empty means "not yours to see", and the
  // capacity section is simply absent — no client-side role check involved.
  const hasCapacityView = tierUsage.length > 0

  const footprints = tierFootprints(provisions)
  const ownTotalGb = footprints.reduce((sum, f) => sum + f.gb, 0)
  const snapshotGb = snapshots.reduce((sum, s) => sum + s.size_gb, 0)

  const vmNameById = new Map(provisions.map((p) => [p.id, p.vm_name]))
  const snapshotCountByVm = snapshots.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s.provision_id] = (acc[s.provision_id] ?? 0) + 1
      return acc
    },
    {}
  )

  return (
    <>
      <header className="page-head">
        <h1>Storage &amp; DR</h1>
        <p className="muted">
          Tier capacity, snapshots, and replication health for{' '}
          {user.workspaceName}.
        </p>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">Provisioned disk</div>
          <div className="card-value">{formatGb(ownTotalGb)}</div>
          <div className="muted small">
            Across {provisions.length}{' '}
            {provisions.length === 1 ? 'machine' : 'machines'}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Snapshots</div>
          <div className="card-value">{snapshots.length}</div>
          <div className="muted small">{formatGb(snapshotGb)} captured</div>
        </div>

        <div className="card">
          <div className="card-label">Replication</div>
          <div className="card-value small-value">
            <span
              className={`badge ${styles.statusBadge} ${
                STATE_CLASS[replication.state]
              }`}
            >
              {RPO_STATE_LABELS[replication.state]}
            </span>
          </div>
          <div className="muted small">
            {replication.lagSeconds !== null
              ? `${replication.lagSeconds}s behind · ${user.rpoSeconds}s target`
              : `No replica reporting · ${user.rpoSeconds}s target`}
          </div>
        </div>
      </section>

      {hasCapacityView && (
        <section className="panel">
          <div className={styles.panelHead}>
            <h2>Storage tier capacity</h2>
            <span className="muted small">
              Workspace-wide · admin view
            </span>
          </div>

          {tierUsage.map((t) => {
            const pct = pctOf(t.used_gb, t.capacity_gb)
            return (
              <div className="meter" key={t.tier}>
                <div className="meter-head">
                  <span>{TIER_LABELS[t.tier]}</span>
                  <span className="muted">
                    {formatGb(t.used_gb)} / {formatGb(t.capacity_gb)}
                  </span>
                </div>
                <div className="meter-track">
                  <div
                    className={`meter-fill ${meterTone(pct)}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <div className="muted small">
                  {pct}% allocated · {formatGb(Math.max(t.capacity_gb - t.used_gb, 0))}{' '}
                  free
                </div>
              </div>
            )
          })}
        </section>
      )}

      <section className="panel">
        <div className={styles.panelHead}>
          <h2>Your disk usage</h2>
          <span className="muted small">
            {user.role === 'admin'
              ? 'Every machine in the workspace'
              : 'Machines assigned to you'}
          </span>
        </div>

        {ownTotalGb > 0 ? (
          <>
            {footprints
              .filter((f) => f.machines > 0)
              .map((f) => {
                const share = pctOf(f.gb, ownTotalGb)
                return (
                  <div className="meter" key={f.tier}>
                    <div className="meter-head">
                      <span>{TIER_LABELS[f.tier]}</span>
                      <span className="muted">{formatGb(f.gb)}</span>
                    </div>
                    <div className="meter-track">
                      <div
                        className="meter-fill"
                        style={{ width: `${Math.min(share, 100)}%` }}
                      />
                    </div>
                    <div className="muted small">
                      {share}% of your footprint · {f.machines}{' '}
                      {f.machines === 1 ? 'machine' : 'machines'}
                    </div>
                  </div>
                )
              })}

            <div className={styles.tableWrap} style={{ marginTop: 18 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th className={styles.num}>Disk</th>
                    <th className={styles.num}>Snapshots</th>
                  </tr>
                </thead>
                <tbody>
                  {provisions.map((p) => (
                    <tr key={p.id}>
                      <td className={styles.nameCell}>{p.vm_name}</td>
                      <td className="muted">{TIER_LABELS[p.storage_tier]}</td>
                      <td className="muted">{effectiveStatus(p)}</td>
                      <td className={styles.num}>{p.storage_gb} GB</td>
                      <td className={styles.num}>
                        {snapshotCountByVm[p.id] ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className={styles.empty}>No machines are visible to you yet.</p>
        )}
      </section>

      <section className="panel">
        <div className={styles.panelHead}>
          <h2>Take a snapshot</h2>
          <span className="muted small">Local, crash-consistent</span>
        </div>
        <SnapshotForm
          machines={provisions.map((p) => ({
            id: p.id,
            vmName: p.vm_name,
            storageGb: p.storage_gb,
            tierLabel: TIER_LABELS[p.storage_tier],
          }))}
        />
      </section>

      <section className="panel">
        <div className={styles.panelHead}>
          <h2>Snapshot history</h2>
          <span className="muted small">
            {snapshots.length} {snapshots.length === 1 ? 'snapshot' : 'snapshots'}
          </span>
        </div>

        {snapshots.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Machine</th>
                  <th className={styles.num}>Size</th>
                  <th className={styles.num}>Age</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id}>
                    <td className={styles.nameCell}>{s.label}</td>
                    <td className="muted">
                      {vmNameById.get(s.provision_id) ?? '—'}
                    </td>
                    <td className={styles.num}>{formatGb(s.size_gb)}</td>
                    <td className={styles.num}>{formatAge(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            Nothing captured yet. Take a snapshot above and it will appear here.
          </p>
        )}
      </section>

      <section className="panel">
        <div className={styles.panelHead}>
          <h2>Pre-approved storage profiles</h2>
          <span className="muted small">Chosen when a machine is provisioned</span>
        </div>

        <div className={styles.profiles}>
          {STORAGE_PROFILES.map((profile) => {
            const mine = footprints.find((f) => f.tier === profile.tier)
            return (
              <div className={styles.profile} key={profile.tier}>
                <div className={styles.profileName}>
                  {TIER_LABELS[profile.tier]}
                </div>
                <p className={styles.profileHeadline}>{profile.headline}</p>
                <ul className={styles.profileSpecs}>
                  <li>
                    <span className={styles.specKey}>Suited to</span>
                    {profile.suitedTo}
                  </li>
                  <li>
                    <span className={styles.specKey}>Performance</span>
                    {profile.iops}
                  </li>
                  <li>
                    <span className={styles.specKey}>Retention</span>
                    {profile.retention}
                  </li>
                  <li>
                    <span className={styles.specKey}>Your usage</span>
                    {mine && mine.machines > 0
                      ? `${formatGb(mine.gb)} on ${mine.machines} ${
                          mine.machines === 1 ? 'machine' : 'machines'
                        }`
                      : 'none'}
                  </li>
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <div className={styles.panelHead}>
          <h2>RPO health &amp; DR test</h2>
          <span
            className={`badge ${styles.statusBadge} ${
              STATE_CLASS[replication.state]
            }`}
          >
            {RPO_STATE_LABELS[replication.state]}
          </span>
        </div>

        <div className={styles.rpoGrid}>
          <div className={styles.rpoItem}>
            <div className={styles.rpoLabel}>RPO target</div>
            <div className={styles.rpoValue}>{user.rpoSeconds}s</div>
          </div>
          <div className={styles.rpoItem}>
            <div className={styles.rpoLabel}>Observed lag</div>
            <div className={styles.rpoValue}>
              {replication.lagSeconds !== null
                ? `${replication.lagSeconds}s`
                : '—'}
            </div>
          </div>
          <div className={styles.rpoItem}>
            <div className={styles.rpoLabel}>Last replicated</div>
            <div className={styles.rpoValue}>
              {replication.lastReplicatedAt
                ? formatAge(replication.lastReplicatedAt)
                : 'never'}
            </div>
          </div>
          <div className={styles.rpoItem}>
            <div className={styles.rpoLabel}>Commitment</div>
            <div
              className={styles.rpoValue}
              style={{ textTransform: 'capitalize', fontSize: 15 }}
            >
              {user.commitmentTier.replace(/_/g, ' ')}
            </div>
          </div>
        </div>

        <DrPanel rpoSeconds={user.rpoSeconds} />
      </section>
    </>
  )
}
