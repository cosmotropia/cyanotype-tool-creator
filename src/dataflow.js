// Optional: numbers (sensor readings, x/y trajectories, JSON) -> features.
//
//   text -> parseData -> columns -> features (each 0..1, or -1..1 for trend)
//
// The numbers are drawn on top of the picture by measure.js. Nothing here changes the picture's shape.
// Dependency-free. To use an external library (statistics, FFT, a model...), import it and call
// registerFeature(name, fn): fn({ cols, labels, n }) returns a number, which then shows up in the overlay.

import { clamp, mulberry32 } from './math.js'

// ---------------------------------------------------------------- parsing

const toNum = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  return s === '' ? NaN : Number(s)
}

/** CSV / TSV / ;-separated / whitespace / JSON array / {"data": [...]}. Header row optional. */
export function parseData(text) {
  const t = String(text ?? '').trim()
  if (!t) throw new Error('No data yet: paste numbers, load a file or try a demo.')

  let names = null
  let rows
  if (t[0] === '[' || t[0] === '{') {
    let j
    try {
      j = JSON.parse(t)
    } catch (e) {
      throw new Error('Invalid JSON: ' + e.message)
    }
    const arr = Array.isArray(j) ? j : j?.data
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('JSON must be an array, or {"data": [...]}')
    if (arr[0] && typeof arr[0] === 'object' && !Array.isArray(arr[0])) {
      names = Object.keys(arr[0])
      rows = arr.map((o) => names.map((k) => toNum(o[k])))
    } else {
      rows = arr.map((r) => (Array.isArray(r) ? r : [r]).map(toNum))
    }
  } else {
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : null
    const split = (l) => (sep ? l.split(sep) : l.split(/\s+/)).map((c) => c.trim())
    // ';' files often use decimal commas (1,5), so read those as dots.
    const cell = (c) => toNum(sep === ';' ? c.replace(',', '.') : c)
    const first = split(lines[0])
    if (first.some((c) => !Number.isFinite(cell(c)))) {
      names = first
      lines.shift()
    }
    rows = lines.map((l) => split(l).map(cell))
  }

  const width = names?.length || rows[0]?.length || 0
  rows = rows.filter((r) => r.length === width && r.every(Number.isFinite))
  if (width === 0 || rows.length < 3) {
    throw new Error(`Need at least 3 complete rows of numbers (found ${rows.length}).`)
  }
  const all = Array.from({ length: width }, (_, j) => rows.map((r) => r[j]))
  const allLabels = all.map((_, j) => (names?.[j] || '').trim() || `c${j + 1}`)
  // A time / index column is the x-axis of the data, not a signal: keep it out of the features.
  const isTime = allLabels.map((l) => TIME_LABEL.test(l))
  const keep = isTime.some((v) => !v) ? isTime.map((v) => !v) : all.map(() => true)
  const cols = all.filter((_, j) => keep[j])
  const labels = allLabels.filter((_, j) => keep[j])
  const timeIdx = isTime.indexOf(true)
  return { labels, cols, n: rows.length, time: timeIdx >= 0 ? all[timeIdx] : null }
}

const TIME_LABEL = /^(t|time|timestamp|ts|index|idx|frame|sample)$/i

// ---------------------------------------------------------------- features

const registry = new Map()

/** Add a feature. fn({ cols, labels, n }) -> number. Use values in 0..1 (or -1..1 with `signed: true` in a mapping). */
export function registerFeature(name, fn) {
  registry.set(name, fn)
}

function stats(xs) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
    sum += x
  }
  const n = xs.length
  const mean = sum / n
  let v = 0
  for (const x of xs) v += (x - mean) ** 2
  return { min, max, mean, range: max - min || 1e-9, std: Math.sqrt(v / n) }
}

// Mean of a per-column measure, so multi-axis sensors count every axis.
const perColumn = (d, f) => d.cols.reduce((s, c) => s + f(c), 0) / d.cols.length

// x/y trajectory: first two columns, each axis scaled to 0..1 so units don't matter.
function trajectory(d) {
  if (d.cols.length < 2) return null
  const norm = (c) => {
    const s = stats(c)
    return c.map((v) => (v - s.min) / s.range)
  }
  const x = norm(d.cols[0])
  const y = norm(d.cols[1])
  let path = 0
  let turn = 0
  let turns = 0
  let px = null
  let py = null
  for (let i = 1; i < x.length; i++) {
    const dx = x[i] - x[i - 1]
    const dy = y[i] - y[i - 1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    path += len
    if (px !== null) {
      turn += Math.abs(Math.atan2(dx * py - dy * px, dx * px + dy * py))
      turns++
    }
    px = dx
    py = dy
  }
  const last = x.length - 1
  const disp = Math.hypot(x[last] - x[0], y[last] - y[0])
  return { path, disp, meanTurn: turns ? turn / turns : 0, steps: x.length - 1 }
}

// Column features (averaged over columns)
registerFeature('variability', (d) =>
  perColumn(d, (x) => {
    const s = stats(x)
    return clamp((s.std / s.range) * 2.8, 0, 1) // flat ≈ 0, random noise ≈ 1
  }),
)
registerFeature('rate', (d) =>
  perColumn(d, (x) => {
    const s = stats(x)
    let a = 0
    for (let i = 1; i < x.length; i++) a += Math.abs(x[i] - x[i - 1])
    return clamp((a / (x.length - 1) / s.range) * 20, 0, 1) // how fast it changes sample to sample
  }),
)
registerFeature('oscillation', (d) =>
  perColumn(d, (x) => {
    const m = stats(x).mean
    let z = 0
    for (let i = 1; i < x.length; i++) if ((x[i - 1] - m) * (x[i] - m) < 0) z++
    return clamp((z / (x.length - 1)) * 25, 0, 1) // zero-crossing rate: periodic / jittery
  }),
)
registerFeature('spikiness', (d) =>
  perColumn(d, (x) => {
    const s = stats(x)
    if (s.std === 0) return 0
    let m4 = 0
    for (const v of x) m4 += ((v - s.mean) / s.std) ** 4
    const excessKurtosis = m4 / x.length - 3 // gaussian = 0, impacts / peaks = large
    return clamp(Math.max(0, excessKurtosis) / 8, 0, 1)
  }),
)
registerFeature('trend', (d) =>
  perColumn(d, (x) => {
    const n = x.length
    const s = stats(x)
    const tm = (n - 1) / 2
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (i - tm) * (x[i] - s.mean)
      den += (i - tm) ** 2
    }
    const slope = den ? num / den : 0
    return clamp((slope * (n - 1)) / s.range, -1, 1) // signed: overall rise (+) or fall (−)
  }),
)

// Trajectory features (need two or more columns)
registerFeature('turning', (d) => {
  const t = trajectory(d)
  return t ? clamp(t.meanTurn / (Math.PI / 6), 0, 1) : NaN // average turn per step: 0 smooth, 1 zigzag
})
registerFeature('straightness', (d) => {
  const t = trajectory(d)
  return t ? (t.path > 1e-9 ? clamp(t.disp / t.path, 0, 1) : 1) : NaN // 1 straight line, 0 closed loop
})
registerFeature('stepSize', (d) => {
  const t = trajectory(d)
  return t ? clamp((t.path / Math.max(1, t.steps)) * 20, 0, 1) : NaN // average step length
})

export const FEATURE_HELP = {
  variability: 'how much the values spread (0 flat … 1 random)',
  rate: 'how fast the values change from sample to sample',
  oscillation: 'how often the signal crosses its mean (periodic or jittery)',
  spikiness: 'sharp peaks or impacts (excess kurtosis)',
  trend: 'overall rise (+) or fall (−) across the series, signed −1…1',
  turning: 'trajectory curvature: average turn per step (0 smooth, 1 zigzag)',
  straightness: 'start-to-end distance ÷ path length (1 straight, 0 closed loop)',
  stepSize: 'average trajectory step length',
}

/** Parse + compute every registered feature. Features that cannot be computed for this data are left out. */
export function analyze(text) {
  const data = parseData(text)
  const features = {}
  for (const [name, fn] of registry) {
    try {
      const v = fn(data)
      if (Number.isFinite(v)) features[name] = v
    } catch (err) {
      console.warn(`feature "${name}" failed:`, err)
    }
  }
  return { ...data, features }
}

// ---------------------------------------------------------------- demo data

/** Synthetic example data as CSV text. kind: 'sensor' (3-axis accelerometer-like) or 'trajectory' (x/y loops). */
export function demoCsv(kind = 'sensor', n = 240) {
  const rnd = mulberry32(kind === 'sensor' ? 3 : 11)
  const noise = (a) => (rnd() - 0.5) * a
  const out = []
  if (kind === 'trajectory') {
    out.push('x,y')
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      const r = 1 + 0.4 * Math.sin(5 * t) // rose curve: loops and petals
      out.push([r * Math.cos(t) + noise(0.02), r * Math.sin(t) + noise(0.02)].map((v) => v.toFixed(3)).join(','))
    }
  } else {
    out.push('t,ax,ay,az')
    for (let i = 0; i < n; i++) {
      const t = i / n
      const impact = i % 60 === 0 ? 0.8 : 0 // a knock every 60 samples
      const ax = 0.6 * Math.sin(2 * Math.PI * 3 * t) + noise(0.08)
      const ay = 0.4 * Math.cos(2 * Math.PI * 1.3 * t) + noise(0.08) + impact
      const az = 1 + 0.2 * t + noise(0.05)
      out.push([t, ax, ay, az].map((v) => v.toFixed(3)).join(','))
    }
  }
  return out.join('\n')
}
