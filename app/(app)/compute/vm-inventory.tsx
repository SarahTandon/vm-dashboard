'use client'

import { useDeferredValue, useId, useMemo, useState } from 'react'
import type { ProvisionView, VmStatus } from '@/lib/provisions'
import { PowerButtons } from './power-controls'
import { StatusPill } from './status-pill'
import { STATUS_OPTIONS, TIER_OPTIONS, secondsRemaining } from './view-model'
import styles from './compute.module.css'

const ANY = '__any'
const UNGROUPED = '__none'

type Filters = {
  q: string
  status: string
  tier: string
  group: string
}

const EMPTY: Filters = { q: '', status: ANY, tier: ANY, group: ANY }

/**
 * The VM inventory.
 *
 * Filtering happens in the browser against the rows already on the page. The
 * database has already decided which rows the caller may see, so narrowing
 * them further is a pure display concern — no round trip, no spinner, and the
 * table responds on the keystroke.
 */
export function VmInventory({
  rows,
  statusOf,
  now,
}: {
  rows: ProvisionView[]
  statusOf: (row: ProvisionView) => VmStatus
  now: number | null
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const baseId = useId()

  // The search box is the only filter a person types into, so it is the only
  // one worth deferring — the selects apply on the same frame as the click.
  const q = useDeferredValue(filters.q)

  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      if (r.group_id && r.group_name) seen.set(r.group_id, r.group_name)
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (needle) {
        const haystack = `${r.vm_name} ${r.ip_address ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (filters.status !== ANY && statusOf(r) !== filters.status) return false
      if (filters.tier !== ANY && r.storage_tier !== filters.tier) return false
      if (filters.group !== ANY) {
        if (filters.group === UNGROUPED) {
          if (r.group_id) return false
        } else if (r.group_id !== filters.group) return false
      }
      return true
    })
  }, [rows, q, filters.status, filters.tier, filters.group, statusOf])

  const dirty =
    filters.q !== '' ||
    filters.status !== ANY ||
    filters.tier !== ANY ||
    filters.group !== ANY

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <section className="panel">
      <div className={styles.panelHead}>
        <h2>VM inventory</h2>
        <span className="muted small">
          {visible.length === rows.length
            ? `${rows.length} machine${rows.length === 1 ? '' : 's'}`
            : `${visible.length} of ${rows.length} machines`}
        </span>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor={`${baseId}-q`}>
            Search
          </label>
          <input
            id={`${baseId}-q`}
            type="search"
            className={styles.search}
            placeholder="Name or IP"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
          />
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor={`${baseId}-status`}>
            Status
          </label>
          <select
            id={`${baseId}-status`}
            className={styles.select}
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value={ANY}>Any status</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor={`${baseId}-tier`}>
            Storage tier
          </label>
          <select
            id={`${baseId}-tier`}
            className={styles.select}
            value={filters.tier}
            onChange={(e) => set('tier', e.target.value)}
          >
            <option value={ANY}>Any tier</option>
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor={`${baseId}-group`}>
            App group
          </label>
          <select
            id={`${baseId}-group`}
            className={styles.select}
            value={filters.group}
            onChange={(e) => set('group', e.target.value)}
          >
            <option value={ANY}>Any group</option>
            {groupOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value={UNGROUPED}>Ungrouped</option>
          </select>
        </div>

        {dirty && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => setFilters(EMPTY)}
          >
            Clear
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="muted">
          {rows.length === 0
            ? 'No machines are provisioned to you yet.'
            : 'No machines match these filters.'}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Machine</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>
                  vCPU
                </th>
                <th scope="col" className={styles.num}>
                  RAM
                </th>
                <th scope="col">Storage</th>
                <th scope="col">App group</th>
                <th scope="col">Owner</th>
                <th scope="col">Power</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const status = statusOf(row)
                return (
                  <tr key={row.id}>
                    <th scope="row" className={styles.nameCell}>
                      <span className={styles.vmName}>{row.vm_name}</span>
                      <span className="muted small">
                        {row.ip_address ?? 'No address assigned'}
                      </span>
                    </th>
                    <td>
                      <StatusPill
                        status={status}
                        secondsLeft={secondsRemaining(row, now)}
                      />
                    </td>
                    <td className={styles.num}>{row.cpu_cores}</td>
                    <td className={styles.num}>{row.ram_gb} GB</td>
                    <td>
                      <span className={styles.storageSize}>
                        {row.storage_gb.toLocaleString()} GB
                      </span>
                      <span className={styles.tierTag}>{row.tier_label}</span>
                    </td>
                    <td className="muted">
                      {row.group_name ??
                        (row.group_id ? 'Group not visible' : '—')}
                    </td>
                    <td className="muted">{row.owner_name}</td>
                    <td>
                      <PowerButtons provisionId={row.id} status={status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
