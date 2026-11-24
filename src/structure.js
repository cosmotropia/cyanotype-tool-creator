// Procedural generator for the radial bloom.
//
// The structure is built from layered rings of "petals". Every petal has a spine
// (a curve in the radial/height plane, integrated from a heading angle that bends
// with `curvature`) and is filled with many filaments that fan across its width.
// Output is flat typed data for two meshes:
//   - lines:    screen-space-width ribbons (filaments, ribs, core, plus glow dots)
//   - membrane: translucent tissue surfaces stretched between the filaments
//
// Per-vertex data layout (shared by both meshes):
//   position  : x y z
//   normal    : lines -> tangent, membrane -> surface normal
//   uv        : lines -> (side | dot corner x, dot corner y), membrane -> (u across, t along)
//   color     : r = brightness, g = width multiplier, b = random, a = kind (0 line, 1 dot)

import { createNoise, mulberry32, clamp, lerp, smoothstep } from './math.js'
import { MeshBuilder, addStrip, addDot, addGridSheet } from './mesh.js'

export const RADIUS = 400
const SPINE_STEPS = 120
const DEG = Math.PI / 180

// Integrates a petal spine in the (rho, z) half-plane.
function buildSpine({ len, beta0, curl, r0, z0 }) {
  const rho = new Float32Array(SPINE_STEPS + 1)
  const z = new Float32Array(SPINE_STEPS + 1)
  const nr = new Float32Array(SPINE_STEPS + 1)
  const nz = new Float32Array(SPINE_STEPS + 1)
  rho[0] = r0
  z[0] = z0
  const ds = len / SPINE_STEPS
  const heading = (t) => beta0 + curl * Math.pow(t, 1.35)
  for (let i = 0; i < SPINE_STEPS; i++) {
    const b = heading((i + 0.5) / SPINE_STEPS)
    rho[i + 1] = rho[i] + Math.cos(b) * ds
    z[i + 1] = z[i] + Math.sin(b) * ds
  }
  for (let i = 0; i <= SPINE_STEPS; i++) {
    const b = heading(i / SPINE_STEPS)
    nr[i] = -Math.sin(b)
    nz[i] = Math.cos(b)
  }
  return { rho, z, nr, nz }
}

function sampleSpine(arr, t) {
  const f = clamp(t, 0, 1) * SPINE_STEPS
  const i = Math.min(SPINE_STEPS - 1, Math.floor(f))
  return lerp(arr[i], arr[i + 1], f - i)
}

// Petal half-width profile: converges to points at base and tip.
const petalShape = (t) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.65))), 0.85)

export function generateStructure(p) {
  const noise = createNoise(p.seed)
  const rand = mulberry32(p.seed * 104729 + 1)
  const R = RADIUS
  const N = Math.round(p.symmetry)
  const L = Math.round(p.layers)
  const F = Math.round(p.density)
  const depth = p.depth
  const STEPS = 44
  const RIB_POINTS = 30

  const lines = new MeshBuilder()
  const membrane = new MeshBuilder()

  const nf = (0.004 * p.noiseScale) / (R / 400)
  const organicAmp = p.organic * R * 0.085

  // Smooth coherent 3D displacement (two octaves).
  const displace = (x, y, z, t) => {
    const a = organicAmp * (0.2 + 0.8 * smoothstep(0, 1, t))
    if (a < 1e-3) return [0, 0, 0]
    const X = x * nf
    const Y = y * nf
    const Z = z * nf
    return [
      a * (noise(X, Y, Z) + 0.35 * noise(X * 2.7, Y * 2.7, Z * 2.7)),
      a * (noise(X + 31.4, Y + 17.1, Z + 5.7) + 0.35 * noise(X * 2.7 + 9, Y * 2.7, Z * 2.7)),
      a * 0.7 * (noise(X + 77.7, Y + 3.3, Z + 41.9) + 0.35 * noise(X * 2.7, Y * 2.7 + 5, Z * 2.7)),
    ]
  }

  let filamentCount = 0
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const bounds = [] // every filament point, used for centring and the bounding radius

  const track = (pt) => {
    for (let a = 0; a < 3; a++) {
      if (pt[a] < lo[a]) lo[a] = pt[a]
      if (pt[a] > hi[a]) hi[a] = pt[a]
    }
    bounds.push(pt)
  }

  // ---- Petals ----
  for (let l = 0; l < L; l++) {
    const f = L > 1 ? l / (L - 1) : 0.3
    const len = R * p.petalLength * lerp(1.0, 0.5, Math.pow(f, 0.9))
    const beta0 = lerp(6, 52, Math.pow(f, 1.1)) * DEG
    const curl = p.curvature * Math.PI * 0.85 * (1 - 0.4 * f)
    const r0 = R * lerp(0.1, 0.035, f)
    const z0 = R * 0.22 * f
    const spine = buildSpine({ len, beta0, curl, r0, z0 })

    const wMax = p.petalWidth * Math.min(((0.9 * Math.PI) / N) * len, 0.5 * len)
    const twistTotal = p.twist * 1.15
    const layerPhase = (l % 2) * 0.5 + l * 0.037
    const veinStep = Math.max(3, Math.round(F / 6))
    const ribTs = []
    for (let k = 1; k <= p.ribs; k++) ribTs.push(lerp(0.14, 0.86, k / (p.ribs + 1)))

    for (let s = 0; s < N; s++) {
      const phi0 = ((s + layerPhase) / N) * Math.PI * 2
      const scale = 1 + (rand() - 0.5) * 0.16 * (0.3 + p.organic)
      const lift = (rand() - 0.5) * R * 0.03 * p.organic

      // Position on the petal at (u across -1..1, t along 0..1).
      const pointAt = (u, t, wiggle) => {
        const rho = sampleSpine(spine.rho, t) * scale
        const zs = sampleSpine(spine.z, t) * scale + lift * t
        const nrr = sampleSpine(spine.nr, t)
        const nzz = sampleSpine(spine.nz, t)
        const w = wMax * petalShape(t) * scale
        const uu = u + wiggle
        const lat = uu * w
        const cup = p.cupping * uu * uu * w * 0.8
        const rr = rho + cup * nrr
        const zz = zs + cup * nzz
        const phi = phi0 + twistTotal * Math.pow(t, 1.6) * (1 - 0.45 * f)
        const c = Math.cos(phi)
        const sn = Math.sin(phi)
        let x = c * rr - sn * lat
        let y = sn * rr + c * lat
        let z = zz
        const d = displace(x, y, z, t)
        x += d[0]
        y += d[1]
        z += d[2]
        return [x, y, z * depth]
      }

      // Filaments
      const veinU = []
      for (let i = 0; i < F; i++) {
        const jitter = (rand() - 0.5) * (1 / F) * p.organic * 0.8
        const u = clamp(-1 + (2 * (i + 0.5)) / F + jitter, -1, 1)
        const isVein = i % veinStep === 0
        if (isVein) veinU.push(u)
        const base =
          (0.42 + 0.58 * Math.pow(rand(), 1.4)) * (isVein ? 1.35 : 1) * (Math.abs(u) > 0.88 ? 1.2 : 1) * lerp(1, 0.6, f)
        const wmBase = (0.65 + 0.7 * rand()) * (isVein ? 1.5 : 1)
        const wigAmp = 0.05 * p.organic * (0.5 + rand())
        const wigFreq = 2.5 + rand() * 4
        const wigPhase = rand() * Math.PI * 2
        const rnd = rand()

        const pts = []
        const br = []
        const wm = []
        for (let k = 0; k <= STEPS; k++) {
          const t = k / STEPS
          const wig = wigAmp * Math.sin(t * Math.PI * wigFreq + wigPhase) * Math.sin(Math.PI * t)
          const pt = pointAt(u, t, wig)
          pts.push(pt)
          track(pt)
          const profile =
            (0.3 + 0.7 * Math.pow(1 - t, 0.8)) * smoothstep(0.02, 0.28, t) * (1 - 0.45 * smoothstep(0.82, 1, t))
          br.push(base * profile)
          wm.push(wmBase * lerp(1, 0.4, Math.pow(t, 0.8)))
        }
        addStrip(lines, pts, br, wm, rnd)
        filamentCount++
      }

      // Cross ribs: segmented bands that make the tissue feel engineered.
      for (let ri = 0; ri < ribTs.length; ri++) {
        const t = ribTs[ri]
        const pts = []
        const br = []
        const wm = []
        for (let k = 0; k < RIB_POINTS; k++) {
          const u = -1 + (2 * k) / (RIB_POINTS - 1)
          pts.push(pointAt(u, t, 0))
          const edge = 1 - 0.55 * Math.pow(Math.abs(u), 3)
          br.push(0.5 * edge * (0.65 + 0.35 * (1 - t)))
          wm.push(0.75)
        }
        addStrip(lines, pts, br, wm, rand())

        if (p.nodes > 0.01) {
          for (const u of veinU) {
            addDot(lines, pointAt(u, t, 0), 0.9, 0.9 + p.nodes * 1.8, rand())
          }
        }
      }

      // Membrane
      {
        const cols = clamp(Math.round(F / 2) + 1, 7, 25)
        const rows = 30
        const grid = []
        for (let r = 0; r <= rows; r++) {
          const t = 0.02 + (0.98 * r) / rows
          for (let c = 0; c < cols; c++) grid.push(pointAt(-1 + (2 * c) / (cols - 1), t, 0))
        }
        addGridSheet(
          membrane, grid, cols, rows,
          (c, r) => [-1 + (2 * c) / (cols - 1), 0.02 + (0.98 * r) / rows],
          () => lerp(1, 0.6, f),
        )
      }
    }
  }

  // ---- Core: phyllotaxis stamens ending in glowing bulbs ----
  const M = Math.round(p.core)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < M; i++) {
    const a = Math.sqrt((i + 0.5) / M)
    const ang = i * golden
    const r0 = R * 0.012 + a * R * 0.12
    const H = R * (0.2 + 0.45 * rand()) * (1 - 0.4 * a)
    const out = R * 0.1 * (0.4 + a) * (0.7 + 0.6 * rand())
    const bright = 0.55 + 0.45 * rand()
    const swirl = p.twist * 0.8
    const pts = []
    const br = []
    const wm = []
    const CS = 24
    for (let k = 0; k <= CS; k++) {
      const t = k / CS
      const rr = r0 + out * Math.pow(t, 2.2)
      const phi = ang + swirl * t
      let x = Math.cos(phi) * rr
      let y = Math.sin(phi) * rr
      let z = H * (1 - Math.pow(1 - t, 1.7))
      const d = displace(x, y, z, t)
      x += d[0] * 0.35
      y += d[1] * 0.35
      z += d[2] * 0.35
      const pt = [x, y, z * depth]
      pts.push(pt)
      track(pt)
      br.push(bright * 0.7 * (0.3 + 0.7 * t))
      wm.push(lerp(0.9, 0.5, t))
    }
    addStrip(lines, pts, br, wm, rand())
    addDot(lines, pts[CS], 1.5, 1.8 + 1.6 * rand(), rand())
    filamentCount++
  }

  const center = bounds.length ? [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2) : [0, 0, 0]
  let radius = 1
  for (const pt of bounds) {
    radius = Math.max(radius, Math.hypot(pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]))
  }

  // Keep overall light roughly constant as the structure gets denser.
  const load = (F * N * L) / (26 * 11 * 4)
  const norm = {
    line: clamp(1 / Math.sqrt(load), 0.35, 1.7),
    tissue: clamp(1 / Math.sqrt((N * L) / 44), 0.4, 1.7),
  }

  const half = [0, 1, 2].map((a) => (hi[a] - lo[a]) / 2)
  return { lines, membrane, center, radius, half, filamentCount, norm }
}
