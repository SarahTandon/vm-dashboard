import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

type Quota = {
  vcpu_limit: number
  ram_gb_limit: number
  vcpu_used: number
  ram_gb_used: number
}

function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string
  used: number
  limit: number
  unit: string
}) {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="muted">
          {used} / {limit} {unit}
        </span>
      </div>
      <div className="meter-track">
        <div
          className={`meter-fill ${pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : ''}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="muted small">{pct}% of quota</div>
    </div>
  )
}

export default async function OverviewPage() {
  const user = await requireUser()
  const supabase = await createClient()

  // Company-wide totals. This is a database function rather than a query
  // because a standard user cannot see other people's machines — the function
  // returns the correct total without exposing the rows behind it.
  const { data: quotaRows } = await supabase.rpc('quota_usage')
  const quota = (quotaRows as Quota[] | null)?.[0]

  // Only asked for when an admin is looking. The database would return 0 for
  // anyone else regardless, so the masking holds even if this check is wrong.
  let spend: number | null = null
  if (user.role === 'admin') {
    const { data } = await supabase.rpc('monthly_spend')
    spend = typeof data === 'number' ? data : Number(data ?? 0)
  }

  const { count: vmCount } = await supabase
    .from('provisions')
    .select('id', { count: 'exact', head: true })

  return (
    <>
      <header className="page-head">
        <h1>{user.workspaceName}</h1>
        <p className="muted">
          Signed in as {user.email} · replication target {user.rpoSeconds}s
        </p>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">Machines you can see</div>
          <div className="card-value">{vmCount ?? 0}</div>
          <div className="muted small">
            {user.role === 'admin'
              ? 'Everything in the workspace'
              : 'Yours and your groups'}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Commitment</div>
          <div className="card-value small-value">
            {user.commitmentTier.replace(/_/g, ' ')}
          </div>
          <div className="muted small">Active billing model</div>
        </div>

        {user.role === 'admin' && (
          <div className="card">
            <div className="card-label">Month to date</div>
            <div className="card-value">
              ${spend?.toFixed(2) ?? '0.00'}
            </div>
            <div className="muted small">Admin only</div>
          </div>
        )}
      </section>

      {quota && (
        <section className="panel">
          <h2>Workspace quota</h2>
          <Meter
            label="vCPU"
            used={quota.vcpu_used}
            limit={quota.vcpu_limit}
            unit="cores"
          />
          <Meter
            label="Memory"
            used={quota.ram_gb_used}
            limit={quota.ram_gb_limit}
            unit="GB"
          />
        </section>
      )}

      <section className="panel">
        <h2>Sprint 0 complete</h2>
        <p className="muted">
          Login, role routing, and the app shell are in place. The four feature
          tracks build out from here — Compute, Storage &amp; DR, Networking,
          and Insights.
        </p>
      </section>
    </>
  )
}
