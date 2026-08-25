'use client'

import { useEffect, useMemo, useState } from 'react'
import type { VmStatus } from '@/lib/provisions'
import {
  CHART_H,
  CHART_W,
  POINTS,
  SERIES,
  SERIES_BY_KEY,
  STEP_MS,
  TICK_MS,
  areaPath,
  buildSeries,
  formatValue,
  linePath,
  statusAt,
  type SeriesSpec,
} from '@/lib/telemetry'
import styles from './insights.module.css'

/** Points in a fleet-table sparkline — shorter than a full chart, so the
 *  shape still reads at 120px wide. */
const FLEET_POINTS = 30

export type TelemetryMachine = {
  id: string
  name: string
  status: VmStatus
  statusChangedAt: string
  cpuCores: number
  ramGb: number
}

/**
 * Performance telemetry.
 *
 * ## The hydration problem, and how it is solved
 *
 * Every point is a function of the current time, so if the server rendered from
 * its clock and the browser hydrated from its own, the two trees would differ
 * and React would throw a hydration error on every load.
 *
 * The page generates exactly one timestamp on the server and passes it in as
 * `baseEpoch`. That value seeds this component's `now` state, so the render the
 * server streams and the browser's first render are computed from the identical
 * number and produce byte-identical SVG paths. Only after mount does the
 * interval start replacing `now` with the browser's clock — by then hydration
 * is done and a re-render is just a re-render.
 *
 * The same argument applies to power state: `effectiveStatus()` reads
 * `Date.now()` internally, so this uses `statusAt(machine, now)` instead, which
 * is told what time it is.
 */
export default function TelemetryPanel({
  machines,
  baseEpoch,
}: {
  machines: TelemetryMachine[]
  baseEpoch: number
}) {
  // Seeded from the server's clock, so hydration matches. Advanced afterwards.
  const [now, setNow] = useState(baseEpoch)
  const [selectedId, setSelectedId] = useState(machines[0]?.id ?? '')

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const selected = useMemo(
    () => machines.find((m) => m.id === selectedId) ?? machines[0],
    [machines, selectedId]
  )

  if (!selected) {
    return (
      <section className="panel">
        <h2>Performance telemetry</h2>
        <p className={styles.empty}>
          No machines are visible to you, so there is nothing to chart.
        </p>
      </section>
    )
  }

  const selectedStatus = statusAt(
    { status: selected.status, status_changed_at: selected.statusChangedAt },
    now
  )
  const selectedRunning = selectedStatus === 'running'
  const windowMinutes = Math.round((POINTS * STEP_MS) / 60_000)

  return (
    <>
      <section className="panel">
        <div className={styles.sectionHead}>
          <div>
            <h2>Performance telemetry</h2>
            <p className="muted small">
              Last {windowMinutes} minutes, sampled every {STEP_MS / 1000}s ·{' '}
              {selected.cpuCores} vCPU · {selected.ramGb} GB
            </p>
          </div>
          <div className={styles.controls}>
            <span className={styles.live}>
              <span
                className={`${styles.liveDot} ${selectedRunning ? '' : styles.idle}`}
              />
              {selectedRunning ? 'Live' : 'No signal'}
            </span>
            <label className={styles.pickerLabel}>
              <span className="muted small">Machine</span>
              <select
                className={styles.picker}
                value={selected.id}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className={styles.chartGrid}>
          {SERIES.map((spec) => (
            <Chart
              key={spec.key}
              spec={spec}
              machineId={selected.id}
              machineName={selected.name}
              now={now}
              running={selectedRunning}
            />
          ))}
        </div>

        {!selectedRunning && (
          <p className={styles.note}>
            {selected.name} is {selectedStatus}. A machine
            that is not running reports nothing, so every series reads flat
            zero.
          </p>
        )}
      </section>

      <section className="panel">
        <div className={styles.sectionHead}>
          <div>
            <h2>Fleet at a glance</h2>
            <p className="muted small">
              CPU over the last {(FLEET_POINTS * STEP_MS) / 1000} seconds. Pick
              a row to chart it in full.
            </p>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Machine</th>
                <th>State</th>
                <th className={styles.num}>CPU</th>
                <th className={styles.sparkCell} />
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <FleetRow
                  key={m.id}
                  machine={m}
                  now={now}
                  selected={m.id === selected.id}
                  onSelect={setSelectedId}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------

function Chart({
  spec,
  machineId,
  machineName,
  now,
  running,
}: {
  spec: SeriesSpec
  machineId: string
  machineName: string
  now: number
  running: boolean
}) {
  const values = buildSeries(spec, machineId, now, running)
  const current = values[values.length - 1] ?? 0
  const windowMinutes = Math.round((POINTS * STEP_MS) / 60_000)

  return (
    <div className={`${styles.chart} ${running ? styles[spec.key] : styles.flat}`}>
      <div className={styles.chartHead}>
        <span className={styles.chartLabel}>{spec.label}</span>
        <span className={styles.chartValue}>{formatValue(spec, current)}</span>
      </div>
      <Plot
        values={values}
        max={spec.max}
        className={styles.chartSvg}
        title={`${spec.label} for ${machineName}: ${formatValue(spec, current)}`}
        gridLines
      />
      <div className={styles.chartFoot}>
        <span>−{windowMinutes} min</span>
        <span>{spec.axisLabel} full scale</span>
        <span>now</span>
      </div>
    </div>
  )
}

function FleetRow({
  machine,
  now,
  selected,
  onSelect,
}: {
  machine: TelemetryMachine
  now: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const status = statusAt(
    { status: machine.status, status_changed_at: machine.statusChangedAt },
    now
  )
  const running = status === 'running'
  const cpu = SERIES_BY_KEY.cpu
  const values = buildSeries(cpu, machine.id, now, running, FLEET_POINTS)
  const current = values[values.length - 1] ?? 0

  const pill =
    status === 'running'
      ? styles.pillRunning
      : status === 'stopped'
        ? styles.pillIdle
        : styles.pillBusy

  return (
    <tr
      className={`${styles.fleetRow} ${selected ? styles.selected : ''}`}
      onClick={() => onSelect(machine.id)}
    >
      <td>
        <button
          type="button"
          className={styles.fleetName}
          onClick={() => onSelect(machine.id)}
        >
          {machine.name}
        </button>
      </td>
      <td>
        <span className={`${styles.pill} ${pill}`}>{status}</span>
      </td>
      <td className={styles.num}>{formatValue(cpu, current)}</td>
      <td className={styles.sparkCell}>
        <Plot
          values={values}
          max={cpu.max}
          className={`${styles.spark} ${running ? styles.cpu : styles.flat}`}
          title={`CPU for ${machine.name}`}
        />
      </td>
    </tr>
  )
}

/**
 * The chart itself — an inline <svg>, no library.
 *
 * One fixed viewBox stretched by CSS. `preserveAspectRatio="none"` lets the
 * width fill its container while the height stays whatever the stylesheet says;
 * `vector-effect="non-scaling-stroke"` (set in the stylesheet) keeps the line an
 * even weight despite the non-uniform scale. Stroke and fill are `currentColor`,
 * so the colour comes from a theme variable on the wrapper and follows light
 * and dark automatically.
 */
function Plot({
  values,
  max,
  className,
  title,
  gridLines = false,
}: {
  values: number[]
  max: number
  className: string
  title: string
  gridLines?: boolean
}) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      {gridLines &&
        [0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            className={styles.grid}
            x1={0}
            x2={CHART_W}
            y1={CHART_H * f}
            y2={CHART_H * f}
          />
        ))}
      <path className={styles.area} d={areaPath(values, max)} />
      <path className={styles.line} d={linePath(values, max)} />
    </svg>
  )
}
