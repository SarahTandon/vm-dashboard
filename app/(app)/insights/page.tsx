import { requireUser } from '@/lib/auth'
import { listProvisions } from '@/lib/provisions'
import {
  HOURS_PER_MONTH,
  loadFinancials,
  money,
  monthStartMs,
  type Financials,
  type ShowbackRow,
} from '@/lib/billing'
import {
  ASSET_KIND_LABELS,
  listCatalog,
  type Catalog,
  type CatalogAsset,
} from '@/lib/catalog'
import { groupDigits, renderClock, statusAt } from '@/lib/telemetry'
import BillingReportLink from './billing-report-link'
import TelemetryPanel, { type TelemetryMachine } from './telemetry-panel'
import styles from './insights.module.css'

export default async function InsightsPage() {
  const user = await requireUser()

  // One clock for the whole page. Every figure below — the charts' starting
  // window, the settled power states, the month-to-date arithmetic — is
  // computed from this single number, and it is what the client component is
  // seeded with so its first render matches the server's exactly.
  const now = renderClock()

  const [provisions, catalog] = await Promise.all([
    listProvisions(),
    listCatalog(),
  ])

  // Asked for only when an admin is looking. The database returns nothing to
  // anyone else regardless — `workspace_settings` is admin-only by policy and
  // `monthly_spend()` returns 0 — so the masking holds even if this check is
  // wrong.
  const financials: Financials | null =
    user.role === 'admin' ? await loadFinancials(now) : null

  const machines: TelemetryMachine[] = provisions.map((p) => ({
    id: p.id,
    name: p.vm_name,
    status: p.status,
    statusChangedAt: p.status_changed_at,
    cpuCores: p.cpu_cores,
    ramGb: p.ram_gb,
  }))

  const runningCount = provisions.filter(
    (p) => statusAt(p, now) === 'running'
  ).length

  const assetCount = catalog.global.length + catalog.tenant.length

  return (
    <>
      <header className="page-head">
        <h1>Insights</h1>
        <p className="muted">
          Performance telemetry, chargeback, and asset catalogs for{' '}
          {user.workspaceName}.
        </p>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">Machines observed</div>
          <div className="card-value">{provisions.length}</div>
          <div className="muted small">
            {user.role === 'admin'
              ? 'Everything in the workspace'
              : 'Yours only'}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Reporting now</div>
          <div className="card-value">{runningCount}</div>
          <div className="muted small">Running and emitting telemetry</div>
        </div>

        {financials && (
          <div className="card">
            <div className="card-label">Month to date</div>
            <div className="card-value">{money(financials.spend)}</div>
            <div className="muted small">Admin only</div>
          </div>
        )}

        <div className="card">
          <div className="card-label">Catalog assets</div>
          <div className="card-value">{assetCount}</div>
          <div className="muted small">
            {catalog.global.length} global · {catalog.tenant.length} private
          </div>
        </div>
      </section>

      <TelemetryPanel machines={machines} baseEpoch={now} />

      {financials && (
        <FinancialSection
          financials={financials}
          workspaceName={user.workspaceName}
          now={now}
        />
      )}

      <CatalogSection catalog={catalog} workspaceName={user.workspaceName} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Financials — admin only
// ---------------------------------------------------------------------------

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function FinancialSection({
  financials,
  workspaceName,
  now,
}: {
  financials: Financials
  workspaceName: string
  now: number
}) {
  const { spend, rates, byProject, byOwner, attributed } = financials
  const start = monthStartMs(now)
  const periodLabel = `${isoDate(start)} to ${isoDate(now)} (UTC)`
  const month = isoDate(now).slice(0, 7)
  const slug =
    workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace'

  // Straight-line projection: what this month lands at if nothing changes.
  const elapsedHours = Math.max((now - start) / 3_600_000, 1)
  const daysInMonth = new Date(
    Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 0)
  ).getUTCDate()
  const forecast = (spend / elapsedHours) * (daysInMonth * 24)

  return (
    <section className="panel">
      <div className={styles.sectionHead}>
        <div>
          <h2>Financial chargeback</h2>
          <p className="muted small">
            {periodLabel} · prices are admin-only, and the database is what
            withholds them.
          </p>
        </div>
        <div className={styles.controls}>
          <BillingReportLink
            workspace={workspaceName}
            periodLabel={periodLabel}
            fileName={`${slug}-billing-${month}.csv`}
            spend={spend}
            byProject={byProject}
            byOwner={byOwner}
          />
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <div className="card-label">Spend, month to date</div>
          <div className="card-value">{money(spend)}</div>
          <div className="muted small">From monthly_spend()</div>
        </div>
        <div className="card">
          <div className="card-label">Forecast, full month</div>
          <div className="card-value">{money(forecast)}</div>
          <div className="muted small">At the current run rate</div>
        </div>
        <div className="card">
          <div className="card-label">Attributed</div>
          <div className="card-value">{money(attributed)}</div>
          <div className="muted small">
            Sum of the showback rows below
          </div>
        </div>
      </div>

      <p className={styles.rates}>
        <span>vCPU {money(rates.vcpu_hour)}/hour</span>
        <span>RAM {money(rates.ram_gb_hour)}/GB/hour</span>
        <span>Storage {money(rates.storage_gb_month)}/GB/month</span>
        <span>
          A 1 vCPU / 1 GB machine costs{' '}
          {money((rates.vcpu_hour + rates.ram_gb_hour) * HOURS_PER_MONTH)} a
          month to run
        </span>
      </p>

      <ShowbackTable
        caption="By project"
        nameHeading="Project"
        rows={byProject}
      />
      <ShowbackTable caption="By owner" nameHeading="Owner" rows={byOwner} />
    </section>
  )
}

function ShowbackTable({
  caption,
  nameHeading,
  rows,
}: {
  caption: string
  nameHeading: string
  rows: ShowbackRow[]
}) {
  if (rows.length === 0) return null

  const total = rows.reduce(
    (acc, r) => ({
      machines: acc.machines + r.machines,
      vcpu: acc.vcpu + r.vcpu,
      ramGb: acc.ramGb + r.ramGb,
      storageGb: acc.storageGb + r.storageGb,
      cost: acc.cost + r.cost,
    }),
    { machines: 0, vcpu: 0, ramGb: 0, storageGb: 0, cost: 0 }
  )

  return (
    <>
      <h3 className={styles.subhead}>{caption}</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{nameHeading}</th>
              <th className={styles.num}>VMs</th>
              <th className={styles.num}>vCPU</th>
              <th className={styles.num}>RAM GB</th>
              <th className={styles.num}>Storage GB</th>
              <th className={styles.num}>Month to date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className={styles.num}>{r.machines}</td>
                <td className={styles.num}>{r.vcpu}</td>
                <td className={styles.num}>{groupDigits(r.ramGb)}</td>
                <td className={styles.num}>{groupDigits(r.storageGb)}</td>
                <td className={styles.num}>{money(r.cost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className={styles.num}>{total.machines}</td>
              <td className={styles.num}>{total.vcpu}</td>
              <td className={styles.num}>{groupDigits(total.ramGb)}</td>
              <td className={styles.num}>{groupDigits(total.storageGb)}</td>
              <td className={styles.num}>{money(total.cost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

function CatalogSection({
  catalog,
  workspaceName,
}: {
  catalog: Catalog
  workspaceName: string
}) {
  return (
    <div className={styles.shelves}>
      <section className="panel">
        <div className={styles.sectionHead}>
          <div>
            <h2>
              Global blueprints{' '}
              <span className={`${styles.pill} ${styles.pillGlobal}`}>
                operator
              </span>
            </h2>
            <p className="muted small">
              Published by the platform operator and visible to every tenant.
            </p>
          </div>
        </div>
        <AssetList
          assets={catalog.global}
          empty="The operator has not published any blueprints."
        />
      </section>

      <section className="panel">
        <div className={styles.sectionHead}>
          <div>
            <h2>{workspaceName} assets</h2>
            <p className="muted small">
              Uploaded by this company. No other tenant can see them.
            </p>
          </div>
        </div>
        <AssetList
          assets={catalog.tenant}
          empty="No private media or ISOs uploaded yet."
        />
      </section>
    </div>
  )
}

function AssetList({
  assets,
  empty,
}: {
  assets: CatalogAsset[]
  empty: string
}) {
  if (assets.length === 0) return <p className={styles.empty}>{empty}</p>

  return (
    <ul className={styles.assetList}>
      {assets.map((a) => (
        <li key={a.id} className={styles.asset}>
          <div>
            <div className={styles.assetName}>{a.name}</div>
            <div className={styles.assetMeta}>
              {ASSET_KIND_LABELS[a.kind]}
              {a.os ? ` · ${a.os}` : ''}
            </div>
          </div>
          <span className={styles.assetSize}>{a.size_gb.toFixed(2)} GB</span>
        </li>
      ))}
    </ul>
  )
}
