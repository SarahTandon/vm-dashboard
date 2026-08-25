// Imports from '@/lib/vm', not '@/lib/provisions': this module is pulled into
// a client component, and provisions.ts reaches `next/headers` through the
// Supabase server client. Type-only imports would be erased and safe, but
// anything used at runtime has to come from the dependency-free module.

/**
 * Simulated performance telemetry.
 *
 * There is no metrics store and there never will be — the database is the
 * source of truth and it holds no samples. Every point on every chart is a
 * pure function of `(machine id, series, timestamp)`:
 *
 *     value(t) = base + amplitude · wave(t / period + phase) + jitter(bucket)
 *
 * `base`, `amplitude`, `period` and `phase` are all derived from a hash of the
 * machine's id, so each machine has a stable personality: the same id draws the
 * same line for every viewer, on every render, across refreshes. Nothing here
 * calls `Math.random()` or reads a clock of its own — the caller supplies the
 * timestamp, which is what lets the server and the client agree during
 * hydration.
 */

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** FNV-1a, 32-bit. Small, fast, and identical in every JS runtime. */
function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A stable number in [0, 1) for a set of string parts. */
function unitHash(...parts: string[]): number {
  return hash32(parts.join('')) / 4294967296
}

function between(lo: number, hi: number, ...parts: string[]): number {
  return lo + unitHash(...parts) * (hi - lo)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export type SeriesKey = 'cpu' | 'ram' | 'iops' | 'latency'

export type SeriesSpec = {
  key: SeriesKey
  label: string
  /** Top of the chart's Y axis, and the ceiling every sample is clamped to. */
  max: number
  /** Printed next to the axis maximum, e.g. "100%". */
  axisLabel: string
  /** Range the per-machine resting level is drawn from. */
  base: [number, number]
  /**
   * Range the per-machine swing is drawn from, as a fraction of that machine's
   * base. Proportional rather than absolute on purpose: an absolute amplitude
   * lets a quiet machine swing below zero, and the clamp then draws a flat
   * bottom that is indistinguishable from a powered-off machine. The wave peaks
   * at ±1.35, so a swing below 0.74 can never reach the floor.
   */
  swing: [number, number]
  /** Range of the primary cycle length, in milliseconds. */
  periodMs: [number, number]
  /** Peak-to-peak size of the per-bucket deterministic jitter. */
  jitter: number
}

export const SERIES: SeriesSpec[] = [
  {
    key: 'cpu',
    label: 'CPU utilisation',
    max: 100,
    axisLabel: '100%',
    base: [10, 55],
    swing: [0.15, 0.45],
    periodMs: [70_000, 190_000],
    jitter: 3.2,
  },
  {
    key: 'ram',
    label: 'Memory utilisation',
    max: 100,
    axisLabel: '100%',
    base: [30, 72],
    swing: [0.06, 0.18],
    periodMs: [130_000, 320_000],
    jitter: 1.6,
  },
  {
    key: 'iops',
    label: 'Disk IOPS',
    max: 3000,
    axisLabel: '3k',
    base: [350, 2000],
    swing: [0.15, 0.5],
    periodMs: [45_000, 150_000],
    jitter: 140,
  },
  {
    key: 'latency',
    label: 'Network latency',
    max: 15,
    axisLabel: '15 ms',
    base: [2.5, 9],
    swing: [0.15, 0.5],
    periodMs: [60_000, 170_000],
    jitter: 0.6,
  },
]

export const SERIES_BY_KEY: Record<SeriesKey, SeriesSpec> = Object.fromEntries(
  SERIES.map((s) => [s.key, s])
) as Record<SeriesKey, SeriesSpec>

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Time between samples. Timestamps are quantised to this, so a given wall
 *  clock instant always lands in the same bucket and yields the same value. */
export const STEP_MS = 3_000

/** Samples in a full-size chart — 60 × 3s = a three minute window. */
export const POINTS = 60

/** How often the client recomputes. One step, so the window scrolls by one
 *  point per tick rather than jumping. */
export const TICK_MS = STEP_MS

/**
 * The one timestamp a server render is allowed to take.
 *
 * Wrapped in a function rather than called inline in the page because a render
 * is supposed to be pure, and reaching for the wall clock in the middle of one
 * is exactly the thing that breaks hydration. Taking it once, here, and threading
 * the number down makes the impurity a single deliberate line instead of a
 * property of every component that draws a chart.
 */
export function renderClock(): number {
  return Date.now()
}

type Personality = {
  base: number
  amp: number
  period: number
  phase: number
  phase2: number
}

// Derived once per (machine, series) and kept — the hash inputs never change,
// so neither does the result. Keeps a tick down to arithmetic.
const personalities = new Map<string, Personality>()

function personality(spec: SeriesSpec, id: string): Personality {
  const cacheKey = `${id}${spec.key}`
  const hit = personalities.get(cacheKey)
  if (hit) return hit

  const base = between(spec.base[0], spec.base[1], id, spec.key, 'base')

  const made: Personality = {
    base,
    amp: base * between(spec.swing[0], spec.swing[1], id, spec.key, 'swing'),
    period: between(spec.periodMs[0], spec.periodMs[1], id, spec.key, 'period'),
    phase: unitHash(id, spec.key, 'phase') * Math.PI * 2,
    phase2: unitHash(id, spec.key, 'phase2') * Math.PI * 2,
  }
  personalities.set(cacheKey, made)
  return made
}

/** The value of one series for one machine in one time bucket. */
function sampleAtBucket(spec: SeriesSpec, id: string, bucket: number): number {
  const p = personality(spec, id)
  const t = bucket * STEP_MS

  // Two out-of-phase sines, so the line breathes instead of looking like a
  // textbook sine wave.
  const wave =
    Math.sin(t / p.period + p.phase) +
    0.35 * Math.sin(t / (p.period * 0.37) + p.phase2)

  const jitter = (unitHash(id, spec.key, String(bucket)) - 0.5) * spec.jitter

  return clamp(p.base + p.amp * wave + jitter, 0, spec.max)
}

/**
 * The last `points` samples ending at `nowMs`.
 * A machine that is not running reads a flat zero — there is nothing to plot.
 */
export function buildSeries(
  spec: SeriesSpec,
  id: string,
  nowMs: number,
  running: boolean,
  points: number = POINTS
): number[] {
  if (!running) return new Array<number>(points).fill(0)

  const end = Math.floor(nowMs / STEP_MS)
  const out = new Array<number>(points)
  for (let i = 0; i < points; i++) {
    out[i] = sampleAtBucket(spec, id, end - (points - 1 - i))
  }
  return out
}

// ---------------------------------------------------------------------------
// Status with the clock injected
// ---------------------------------------------------------------------------

/**
 * `statusAt` is the settle logic with the clock passed in rather than read.
 *
 * The charts have to agree between the server render and the client hydration,
 * and those happen at different instants. Passing the clock in means one
 * timestamp decides both. It now lives in lib/vm.ts alongside the settle table
 * and TRANSITION_MS, so there is one definition rather than a copy here.
 */
export { statusAt } from '@/lib/vm'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Thousands separators without `toLocaleString`, whose output depends on the
 *  runtime's locale — a classic server/client hydration mismatch. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatValue(spec: SeriesSpec, v: number): string {
  switch (spec.key) {
    case 'cpu':
    case 'ram':
      return `${v.toFixed(1)}%`
    case 'iops':
      return groupDigits(Math.round(v))
    case 'latency':
      return `${v.toFixed(1)} ms`
  }
}

// ---------------------------------------------------------------------------
// Path maths
//
// One fixed viewBox for every chart. The <svg> is stretched by CSS with
// preserveAspectRatio="none", and the stroke is drawn with
// vector-effect="non-scaling-stroke" so it stays an even width at any size.
// ---------------------------------------------------------------------------

export const CHART_W = 300
export const CHART_H = 80
const PAD = 3

function points(values: number[], max: number): Array<[number, number]> {
  const n = values.length
  const span = CHART_H - PAD * 2
  return values.map((v, i) => {
    const x = n < 2 ? 0 : (i / (n - 1)) * CHART_W
    const y = CHART_H - PAD - (clamp(v, 0, max) / max) * span
    return [x, y]
  })
}

export function linePath(values: number[], max: number): string {
  return points(values, max)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ')
}

export function areaPath(values: number[], max: number): string {
  const line = linePath(values, max)
  if (!line) return ''
  return `${line} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`
}
