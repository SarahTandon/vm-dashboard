import { requireUser } from '@/lib/auth'
import { listAppGroups, listProvisionViews } from '@/lib/provisions'
import { ComputeWorkspace } from './compute-workspace'
import { COMMITMENT_TIERS, isPending } from './view-model'
import styles from './compute.module.css'

export default async function ComputePage() {
  const user = await requireUser()

  // Neither query filters by workspace or user. The policies on `provisions`
  // and `app_groups` have already done that: an admin's query returns the whole
  // workspace and a standard user's returns their own machines, from the same
  // SQL. Filtering again here would only be a second, weaker copy of the rule.
  const [rows, groups] = await Promise.all([
    listProvisionViews(),
    listAppGroups(),
  ])

  const running = rows.filter((r) => r.effective_status === 'running').length
  const pending = rows.filter((r) => isPending(r.effective_status)).length
  const vcpu = rows.reduce((sum, r) => sum + r.cpu_cores, 0)

  return (
    <>
      <header className="page-head">
        <h1>Compute</h1>
        <p className="muted">
          {user.role === 'admin'
            ? `Every machine in ${user.workspaceName}.`
            : 'The machines provisioned to you.'}{' '}
          Power actions settle after about 20 seconds.
        </p>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">Machines</div>
          <div className="card-value">{rows.length}</div>
          <div className="muted small">
            {groups.length} application group{groups.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Running</div>
          <div className="card-value">{running}</div>
          <div className="muted small">
            {rows.length - running - pending} stopped
          </div>
        </div>

        <div className="card">
          <div className="card-label">In transition</div>
          <div className="card-value">{pending}</div>
          <div className="muted small">
            {pending === 0 ? 'Nothing in flight' : 'Settling now'}
          </div>
        </div>

        <div className="card">
          <div className="card-label">vCPU in view</div>
          <div className="card-value">{vcpu}</div>
          <div className="muted small">
            Allocated across these machines
          </div>
        </div>
      </section>

      <CommitmentTier active={user.commitmentTier} />

      <ComputeWorkspace rows={rows} groups={groups} />
    </>
  )
}

/**
 * Which of the four billing models this workspace is on.
 *
 * Shown as the full set with one marked active rather than a lone label, so
 * the reading is "this workspace, of these four" instead of an unexplained
 * string. The value is workspace-wide, so everybody in the tenant sees it —
 * it is the pricing *model*, not the prices, which stay admin-only in
 * `workspace_settings`.
 */
function CommitmentTier({ active }: { active: string }) {
  const known = COMMITMENT_TIERS.some((t) => t.value === active)

  return (
    <section className="panel">
      <h2>Resource commitment</h2>
      <div className={styles.tierRail}>
        {COMMITMENT_TIERS.map((tier) => {
          const on = tier.value === active
          return (
            <div
              key={tier.value}
              className={styles.tierSlot}
              data-active={on ? 'true' : 'false'}
            >
              <div className={styles.tierSlotHead}>
                <span className={styles.tierSlotName}>{tier.label}</span>
                {on && <span className={styles.tierMark}>Active</span>}
              </div>
              <p className={`muted small ${styles.tierBlurb}`}>{tier.blurb}</p>
            </div>
          )
        })}
      </div>
      {!known && (
        <p className="muted small">
          This workspace reports an unrecognised commitment tier:{' '}
          <code>{active}</code>.
        </p>
      )}
    </section>
  )
}
