'use client'

import { useMemo } from 'react'
// Type-only import: erased at compile time, so none of lib/billing's
// server-side Supabase code is pulled into the client bundle.
import type { ShowbackRow } from '@/lib/billing'
import styles from './insights.module.css'

/** RFC 4180 quoting: wrap in quotes, double any quote inside. */
function cell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(
  workspace: string,
  periodLabel: string,
  spend: number,
  byProject: ShowbackRow[],
  byOwner: ShowbackRow[]
): string {
  const lines: string[] = []

  lines.push(['Workspace', workspace].map(cell).join(','))
  lines.push(['Period', periodLabel].map(cell).join(','))
  lines.push(['Month-to-date spend (USD)', spend.toFixed(2)].map(cell).join(','))
  lines.push('')

  const header = [
    'Grouping',
    'Name',
    'Machines',
    'vCPU',
    'RAM GB',
    'Storage GB',
    'Cost USD',
  ]
  lines.push(header.map(cell).join(','))

  const emit = (grouping: string, rows: ShowbackRow[]) => {
    for (const r of rows) {
      lines.push(
        [
          grouping,
          r.label,
          r.machines,
          r.vcpu,
          r.ramGb,
          r.storageGb,
          r.cost.toFixed(2),
        ]
          .map(cell)
          .join(',')
      )
    }
  }

  emit('Project', byProject)
  emit('Owner', byOwner)

  return lines.join('\n')
}

/**
 * Downloadable billing report.
 *
 * Built entirely in the browser from figures already rendered on the page —
 * no extra round trip, and nothing here can see anything the page could not.
 *
 * It is a plain `<a download>` rather than a scripted save, so the browser owns
 * the download. The href is a `data:` URL rather than the more usual
 * `URL.createObjectURL` blob: a blob URL can only be minted in the browser, so
 * the server would render one href and the client another and hydration would
 * fail on the attribute. A data URL is the same string on both sides, needs no
 * effect and no revoke, and a showback report of this size is a couple of
 * kilobytes — well inside what a data URL carries comfortably.
 */
export default function BillingReportLink({
  workspace,
  periodLabel,
  fileName,
  spend,
  byProject,
  byOwner,
}: {
  workspace: string
  periodLabel: string
  fileName: string
  spend: number
  byProject: ShowbackRow[]
  byOwner: ShowbackRow[]
}) {
  const csv = useMemo(
    () => buildCsv(workspace, periodLabel, spend, byProject, byOwner),
    [workspace, periodLabel, spend, byProject, byOwner]
  )

  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`

  return (
    <a className={styles.download} href={href} download={fileName}>
      Download billing report (CSV)
    </a>
  )
}
