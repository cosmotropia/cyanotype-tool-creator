// Additional procedural forms inspired by skeletal flowers and bone-tentacled jellyfish:
//   - generateReliquary: translucent pleated fan-petals with beaded rims on a vertebral spine
//   - generateMedusa:    glassy spined bell with pores, beaded tentacles or jointed bone chains
// Both return the same shape as generateStructure() so the renderer treats them identically.

import { createNoise, mulberry32, clamp, lerp, smoothstep } from './math.js'
import {
  MeshBuilder, Bounds, addStrip, addDot, addGridSheet, perpFrame, normalize3, add3, scale3, sub3,
} from './mesh.js'
import { RADIUS } from './structure.js'

const R = RADIUS
const TAU = Math.PI * 2
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function makeContext(p, salt) {
  const noise = createNoise(p.seed + salt)
  const rand = mulberry32(p.seed * 977 + salt)
  const lines = new MeshBuilder()
  const membrane = new MeshBuilder()
  const bounds = new Bounds()
  const state = { filaments: 0 }
  const nf = 0.004 * p.noiseScale
  const wob = (x, y, z, amt) => [
    noise(x * nf, y * nf, z * nf) * amt,
    noise(x * nf + 31.4, y * nf + 7.7, z * nf + 3.1) * amt,
    noise(x * nf + 77.7, y * nf + 2.2, z * nf + 19.9) * amt,
  ]
  return {
    noise, rand, lines, membrane, bounds, state, wob,
    strip(pts, br, wm, rnd = rand()) {
      for (const q of pts) bounds.track(q)
      addStrip(lines, pts, br, wm, rnd)
      state.filaments++
    },
    dot(q, br, size, rnd = rand()) {
      bounds.track(q)
      addDot(lines, q, br, size, rnd)
    },
  }
}

function circle(c, e1, e2, r, n) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU
    pts.push([
      c[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r,
      c[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r,
      c[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r,
    ])
  }
  return pts
}

// =====================================================================================
// Reliquary: fan-petal flower on a vertebral column
// =====================================================================================
export function generateReliquary(p) {
  const ctx = makeContext(p, 11)
  const { rand, wob, strip, dot, lines, membrane } = ctx
  const depth = p.depth
  const V = Math.round(p.segments)

  // ---- Spine centreline (hangs down from the flower, tail hooks with curvature) ----
  const Ls = R * 1.75 * p.spineLength
  const M = 300
  const X = [0]
  const Y = [0]
  const Z = [0]
  const ds = Ls / M
  let hx = 0
  let hy = 0
  for (let i = 0; i < M; i++) {
    const s = (i + 0.5) / M
    const h = -Math.PI / 2 + p.curvature * (0.5 * Math.sin(s * Math.PI * 1.2) + 0.85 * smoothstep(0.6, 1, s))
    hx += Math.cos(h) * ds
    hy += Math.sin(h) * ds
    X.push(hx)
    Y.push(hy)
    Z.push(depth * R * 0.14 * Math.sin(s * Math.PI * 1.3 + p.seed))
  }
  const sample = (arr, s) => {
    const f = clamp(s, 0, 1) * M
    const i = Math.min(M - 1, Math.floor(f))
    return lerp(arr[i], arr[i + 1], f - i)
  }
  const centre = (s) => [sample(X, s), sample(Y, s), sample(Z, s)]
  const tangent = (s) => {
    const a = centre(Math.max(0, s - 0.01))
    const b = centre(Math.min(1, s + 0.01))
    return normalize3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }

  // One vertebra: body, outlined ends, joint, dorsal spike and curved ribs.
  function vertebra(c, t, r, bodyLen, ribLen, brightScale, sFrac) {
    const [e1, e2] = perpFrame(t, [0, 0, 1])
    const half = scale3(t, bodyLen / 2)
    const fat = clamp((r / (R * 0.06)) * 4.5, 2, 6)
    strip([sub3(c, half), c, add3(c, half)], 1.0 * brightScale, fat, rand())
    for (const sg of [-1, 1]) {
      const off = scale3(e1, sg * r)
      strip([add3(sub3(c, half), off), add3(c, off), add3(add3(c, half), off)], 0.8 * brightScale, 1.3, rand())
    }
    strip(circle(sub3(c, half), e1, e2, r * 0.95, 18), 0.55 * brightScale, 0.6, rand())
    strip(circle(add3(c, half), e1, e2, r * 0.95, 18), 0.55 * brightScale, 0.6, rand())
    dot(add3(c, scale3(t, bodyLen * 0.62)), 0.9 * brightScale, 0.8 + (r / (R * 0.06)) * 0.9)

    // dorsal spike
    const spike = r * 3.2
    const sp = []
    for (let k = 0; k <= 8; k++) {
      const u = k / 8
      sp.push(add3(add3(c, scale3(e2, r * 0.9 + spike * u * 0.8)), scale3(t, -spike * u * u * 1.2)))
    }
    strip(sp, [0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3].map((b) => b * brightScale), 0.9, rand())

    // curved lateral ribs
    if (ribLen > 0.5) {
      for (const sg of [-1, 1]) {
        const pts = []
        const br = []
        const wm = []
        for (let k = 0; k <= 14; k++) {
          const u = k / 14
          const reach = r * 0.9 + ribLen * Math.sin(u * Math.PI * 0.55)
          const wobble = scale3(e2, Math.sin(u * 5 + sFrac * 40) * ribLen * 0.05)
          pts.push(add3(add3(add3(c, scale3(e1, sg * reach)), scale3(t, ribLen * 0.95 * Math.pow(u, 1.7))), wobble))
          br.push(lerp(0.9, 0.4, u) * brightScale)
          wm.push(lerp(2.3, 0.4, u))
        }
        strip(pts, br, wm, rand())
        if (p.beads > 0.3) dot(pts[pts.length - 1], 0.8 * brightScale, 0.7 + p.beads * 0.6)
      }
    }
  }

  const spacing = Ls / Math.max(1, V)
  for (let i = 0; i < V; i++) {
    const s = (i + 0.5) / V
    const r = R * 0.062 * (1 - 0.8 * Math.pow(s, 0.85)) + R * 0.006
    const ribLen =
      r * (2 + 6.5 * p.ribSpread * Math.sin(Math.PI * Math.pow(clamp(s, 0, 1), 0.8)) * (0.35 + 0.65 * (1 - s * 0.3))) * (0.8 + 0.4 * rand())
    vertebra(centre(s), tangent(s), r, spacing * 0.78, ribLen, 1, s)
  }

  // Upper spine rising from the flower head.
  const Vu = Math.max(2, Math.round(V * 0.22))
  const r0 = R * 0.062
  for (let i = 0; i < Vu; i++) {
    const k = (i + 1) / Vu
    const r = r0 * lerp(0.8, 0.3, k)
    const c = [Math.sin(k * 1.2) * R * 0.03, R * 0.38 + k * R * 0.5 * p.spineLength, 0]
    vertebra(c, [0, 1, 0], r, spacing * 0.7, r * 1.6 * p.ribSpread, 0.85, 0)
  }

  // ---- Fan petals ----
  const N = Math.round(p.symmetry)
  const L = Math.round(p.layers)
  const F = Math.round(p.density)
  for (let l = 0; l < L; l++) {
    const f = L > 1 ? l / (L - 1) : 0
    const Lf = R * 0.95 * p.petalLength * lerp(1, 0.55, f)
    const alpha = (Math.PI / N) * p.petalWidth * 0.93
    const baseZ = l * R * 0.05 * depth
    const rIn = R * 0.1 * (1 - 0.4 * f)
    const ribTs = []
    for (let k = 1; k <= p.ribs; k++) ribTs.push(lerp(0.2, 0.85, k / (p.ribs + 1)))

    for (let s = 0; s < N; s++) {
      const theta0 = TAU * ((s + 0.5 * (l % 2)) / N) + Math.PI / 2
      const scale = 1 + (rand() - 0.5) * 0.12 * (0.3 + p.organic)

      const pointAt = (u, t) => {
        const edge = Lf * scale * (0.8 + 0.2 * Math.cos(u * Math.PI * 0.5))
        const rho = rIn + (edge - rIn) * t
        const theta = theta0 + u * alpha * (0.25 + 0.75 * Math.pow(t, 0.7)) + p.twist * 0.25 * t * t
        const z =
          baseZ + depth * R * 0.3 * p.curvature * t * t + p.cupping * u * u * t * t * Lf * 0.12 * depth * (p.curvature >= 0 ? 1 : -1)
        let x = Math.cos(theta) * rho
        let y = Math.sin(theta) * rho
        let zz = z
        const d = wob(x, y, zz, p.organic * R * 0.03 * t)
        x += d[0]
        y += d[1]
        zz += d[2]
        return [x, y, zz]
      }

      // Radial pleats
      for (let j = 0; j < F; j++) {
        const u = -1 + (2 * (j + 0.5)) / F
        const base = (0.5 + 0.5 * rand()) * lerp(1, 0.7, f)
        const pts = []
        const br = []
        const wm = []
        const STEPS = 34
        const wigPhase = rand() * TAU
        for (let k = 0; k <= STEPS; k++) {
          const t = 0.06 + (0.94 * k) / STEPS
          const wig = 0.012 * p.organic * Math.sin(t * 14 + wigPhase)
          pts.push(pointAt(u + wig, t))
          br.push(base * (0.55 + 0.45 * t) * smoothstep(0.0, 0.2, t - 0.06))
          wm.push(0.55)
        }
        strip(pts, br, wm, rand())
      }

      // Rim + side edges
      const rim = []
      for (let k = 0; k <= 48; k++) rim.push(pointAt(-1 + (2 * k) / 48, 1))
      strip(rim, 1.0 * lerp(1, 0.7, f), 1.5, rand())
      for (const sg of [-1, 1]) {
        const edge = []
        for (let k = 0; k <= 24; k++) edge.push(pointAt(sg, 0.1 + (0.9 * k) / 24))
        strip(edge, 0.7 * lerp(1, 0.7, f), 1.1, rand())
      }

      // Beaded scalloped rim
      if (p.beads > 0.02) {
        const nb = Math.round(F * 1.1)
        for (let k = 0; k < nb; k++) {
          const u = -1 + (2 * (k + 0.5)) / nb
          dot(pointAt(u, 1.0), 1.1 * lerp(1, 0.7, f), (0.8 + 0.9 * p.beads) * (0.7 + 0.5 * rand()) * lerp(1, 0.8, f))
        }
      }

      // Concentric ribs
      for (const t of ribTs) {
        const pts = []
        for (let k = 0; k <= 26; k++) pts.push(pointAt(-1 + (2 * k) / 26, t))
        strip(pts, 0.35, 0.45, rand())
      }

      // Translucent membrane between the pleats
      const cols = clamp(Math.round(F / 2) + 1, 9, 25)
      const rows = 22
      const grid = []
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c < cols; c++) grid.push(pointAt(-1 + (2 * c) / (cols - 1), 0.04 + (0.96 * r) / rows))
      }
      addGridSheet(membrane, grid, cols, rows, (c, r) => [-1 + (2 * c) / (cols - 1), 0.04 + (0.96 * r) / rows], () => lerp(1, 0.6, f))
    }
  }

  // ---- Rosette core ----
  const Mc = Math.round(p.core)
  for (let i = 0; i < Mc; i++) {
    const a = Math.sqrt((i + 0.5) / Math.max(1, Mc))
    const ang = i * GOLDEN
    const rr = a * R * 0.16
    dot(
      [Math.cos(ang) * rr, Math.sin(ang) * rr, depth * R * 0.07 * Math.sqrt(Math.max(0, 1 - a * a)) + R * 0.02],
      0.9, 0.55 + 0.5 * (1 - a),
    )
  }
  if (Mc > 0) {
    ;[[0.2, 18], [0.26, 26], [0.31, 34]].forEach(([rad, n], ri) => {
      const ring = []
      for (let k = 0; k <= n; k++) {
        const ang = (k / n) * TAU
        ring.push([Math.cos(ang) * R * rad, Math.sin(ang) * R * rad, R * 0.03 + ri * R * 0.008 * depth])
      }
      strip(ring, 0.5, 0.6, rand())
      for (let k = 0; k < n; k++) dot(ring[k], 0.9, 0.9)
    })
  }

  const { center, radius, half } = ctx.bounds.result()
  return {
    lines, membrane, center, radius, half, filamentCount: ctx.state.filaments,
    norm: { line: 1.9, tissue: 1.0 },
  }
}

// =====================================================================================
// Medusa: spined glassy bell with beaded tentacles / bone chains
// =====================================================================================
export function generateMedusa(p) {
  const ctx = makeContext(p, 23)
  const { rand, wob, lines, membrane } = ctx
  const clusterLayout = [
    { ox: 0, oy: 0, oz: 0, s: 1, tilt: 0.06 },
    { ox: -1.05 * R, oy: -0.3 * R, oz: -R * 0.2, s: 0.68, tilt: 0.35 },
    { ox: 1.0 * R, oy: -0.5 * R, oz: R * 0.15, s: 0.74, tilt: -0.4 },
    { ox: -0.4 * R, oy: 0.65 * R, oz: -R * 0.35, s: 0.5, tilt: 0.2 },
    { ox: 0.5 * R, oy: 0.75 * R, oz: -R * 0.3, s: 0.45, tilt: -0.25 },
  ]
  const clusters = clamp(Math.round(p.cluster), 1, 5)
  const bone = clamp(p.boneStyle, 0, 1)
  const depthScale = Math.max(0.15, p.depth)

  for (let ci = 0; ci < clusters; ci++) {
    const pl = clusterLayout[ci]
    const cs = Math.cos(pl.tilt)
    const sn = Math.sin(pl.tilt)
    const T = (q) => [
      (q[0] * cs - q[1] * sn) * pl.s + pl.ox,
      (q[0] * sn + q[1] * cs) * pl.s + pl.oy,
      q[2] * pl.s + pl.oz,
    ]
    const strip = (pts, br, wm, rnd = rand()) => ctx.strip(pts.map(T), br, wm, rnd)
    const dot = (q, br, size, rnd = rand()) => ctx.dot(T(q), br, size, rnd)

    const Rb = R * 0.5
    const Hb = Rb * 0.85
    const thetaMax = 1.75
    const spikes = Math.round(p.spikes)

    const bell = (theta, phi, out = 0) => {
      const frill = 1 + 0.06 * smoothstep(0.75, 1, theta / thetaMax) * Math.cos(Math.max(1, spikes) * phi)
      const rr = (Rb + out) * Math.sin(theta) * frill
      return [rr * Math.cos(phi), (Hb + out * 0.5) * Math.cos(theta), rr * Math.sin(phi) * depthScale]
    }
    const bellJ = (theta, phi, out = 0) => {
      const q = bell(theta, phi, out)
      const d = wob(q[0], q[1], q[2], p.organic * R * 0.012)
      return [q[0] + d[0], q[1] + d[1], q[2] + d[2]]
    }

    // Meridians
    const Mn = Math.max(8, Math.round(p.symmetry * 2))
    for (let i = 0; i < Mn; i++) {
      const phi = (i / Mn) * TAU
      const pts = []
      const br = []
      for (let k = 0; k <= 36; k++) {
        const th = 0.04 + ((thetaMax - 0.04) * k) / 36
        pts.push(bellJ(th, phi, Rb * 0.004))
        br.push(0.6 * (0.45 + 0.55 * Math.sin(th)) * smoothstep(0.04, 0.3, th))
      }
      strip(pts, br, 0.6, rand())
    }
    // Parallels
    const K = p.layers * 2 + 2
    for (let k = 0; k < K; k++) {
      const th = (thetaMax * (k + 1)) / (K + 1)
      const pts = []
      for (let a = 0; a <= 90; a++) pts.push(bellJ(th, (a / 90) * TAU, Rb * 0.004))
      strip(pts, 0.4, 0.55, rand())
    }
    // Rim ring (heavier)
    const rim = []
    for (let a = 0; a <= 120; a++) rim.push(bellJ(thetaMax, (a / 120) * TAU, Rb * 0.006))
    strip(rim, 1.0, 1.6, rand())

    // Glass membrane over the dome
    {
      const cols = 61
      const rows = 26
      const grid = []
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c < cols; c++) grid.push(bellJ(0.02 + ((thetaMax - 0.02) * r) / rows, (c / (cols - 1)) * TAU))
      }
      addGridSheet(membrane, grid.map((q) => T(q)), cols, rows, (c, r) => [(0.02 + ((thetaMax - 0.02) * r) / rows) / thetaMax, 0.5], () => 1)
    }

    // Pores / bubbles on the surface
    const pores = Math.round(p.density * 7)
    for (let i = 0; i < pores; i++) {
      const th = Math.acos(1 - rand() * (1 - Math.cos(thetaMax * 0.97)))
      const phi = rand() * TAU
      dot(bell(th, phi, Rb * 0.012), 0.5 + 0.6 * rand(), 0.5 + 1.4 * Math.pow(rand(), 2))
    }

    // Rim spikes
    for (let i = 0; i < spikes; i++) {
      const phi = (i / spikes) * TAU
      const base = bell(thetaMax, phi, Rb * 0.01)
      const len = Rb * 0.26 * (0.8 + 0.4 * rand())
      const out = [Math.cos(phi), 0, Math.sin(phi) * depthScale]
      const pts = []
      for (let k = 0; k <= 8; k++) {
        const u = k / 8
        pts.push([
          base[0] + out[0] * len * u,
          base[1] + len * 0.55 * Math.pow(u, 0.8) - len * 0.1 * u * u,
          base[2] + out[2] * len * u,
        ])
      }
      strip(pts, [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5], [1.3, 1.2, 1.1, 1, 0.9, 0.8, 0.7, 0.5, 0.3], rand())
      dot(pts[8], 1.2, 1.1)
    }

    // ---- Tentacles ----
    const Lt = R * 1.5 * p.spineLength

    function tentacle({ phi, r0, y0, len, thick, sway, phase }) {
      const NT = 90
      const P = []
      for (let i = 0; i < NT; i++) {
        const s = i / (NT - 1)
        const r = r0 * (1 - 0.35 * s) + sway * Rb * 0.6 * Math.sin(s * Math.PI * 1.4 + phase) * s + p.curvature * Rb * 0.5 * Math.pow(s, 1.5)
        const ph = phi + p.twist * 0.8 * s + 0.4 * Math.sin(s * Math.PI * 1.7 + phase) * s
        const x = Math.cos(ph) * Math.max(0, r)
        const z = Math.sin(ph) * Math.max(0, r) * depthScale
        const y = y0 - len * s
        const d = wob(x, y, z, p.organic * Rb * 0.3 * s)
        P.push([x + d[0], y + d[1] * 0.4, z + d[2]])
      }
      const tan = (i) => {
        const a = P[Math.max(0, i - 1)]
        const b = P[Math.min(NT - 1, i + 1)]
        return normalize3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      }
      const taper = (s) => lerp(1, 0.45, s)

      // Smooth tentacle: central strand with two helical strands
      const ms = clamp(1 - bone * 1.4, 0, 1)
      if (ms > 0.05) {
        strip(P, P.map((_, i) => 0.85 * ms * (0.7 + 0.3 * (1 - i / NT))), P.map((_, i) => thick * 2.8 * taper(i / NT)), rand())
        for (let k = 0; k < 2; k++) {
          const hp = []
          for (let i = 0; i < NT; i++) {
            const s = i / (NT - 1)
            const [e1, e2] = perpFrame(tan(i), [0, 0, 1])
            const ang = s * TAU * (5 + 3 * thick) + k * Math.PI
            const rad = thick * Rb * 0.045 * taper(s)
            hp.push(add3(P[i], add3(scale3(e1, Math.cos(ang) * rad), scale3(e2, Math.sin(ang) * rad))))
          }
          strip(hp, 0.8 * ms, 0.8, rand())
        }
      }

      // Jointed bone chain
      const mb = clamp((bone - 0.1) * 1.3, 0, 1)
      if (mb > 0.05) {
        const Vseg = Math.max(4, Math.round(p.segments))
        const gap = 0.08 + 0.22 * bone
        for (let k = 0; k < Vseg; k++) {
          const s0 = (k + gap) / Vseg
          const s1 = (k + 1 - gap) / Vseg
          const i0 = Math.round(s0 * (NT - 1))
          const i1 = Math.max(i0 + 1, Math.round(s1 * (NT - 1)))
          const seg = P.slice(i0, i1 + 1)
          const sm = (k + 0.5) / Vseg
          strip(seg, 0.95 * mb, thick * 3.4 * taper(sm), rand())
          // knuckle + processes at the joint
          const ij = Math.round((k / Vseg) * (NT - 1))
          dot(P[ij], 1.0 * mb, (1.8 + 1.2 * thick) * taper(k / Vseg) * (0.7 + 0.5 * bone))
          const [e1] = perpFrame(tan(ij), [0, 0, 1])
          for (const sg of [-1, 1]) {
            const tl = Rb * 0.06 * taper(k / Vseg) * (1 + bone)
            const pts = []
            for (let a = 0; a <= 4; a++) {
              const u = a / 4
              pts.push(add3(add3(P[ij], scale3(e1, sg * tl * Math.sin(u * 1.4))), [0, -tl * 0.8 * u * u, 0]))
            }
            strip(pts, 0.8 * mb, 1.1, rand())
          }
        }
      }

      // Beads and hanging chains
      if (p.beads > 0.02) {
        const nB = Math.round(p.beads * 30 * (len / Lt))
        for (let b = 0; b < nB; b++) {
          const i = Math.floor(lerp(0.1, 1, rand()) * (NT - 1))
          const [e1, e2] = perpFrame(tan(i), [0, 0, 1])
          const a = rand() * TAU
          const off = Rb * 0.05 * thick * (0.5 + rand())
          dot(add3(P[i], add3(scale3(e1, Math.cos(a) * off), scale3(e2, Math.sin(a) * off))), 0.75, 0.7 + rand() * 1.5)
        }
        const chains = Math.round(p.beads * 7)
        for (let c = 0; c < chains; c++) {
          const i = Math.floor(lerp(0.15, 0.95, rand()) * (NT - 1))
          const m = 4 + Math.floor(rand() * 6)
          const sp = Rb * 0.035
          const dx = (rand() - 0.5) * Rb * 0.05
          const dz = (rand() - 0.5) * Rb * 0.05
          const ch = [P[i]]
          for (let j = 1; j <= m; j++) {
            const q = [P[i][0] + dx * j + Math.sin(j * 1.3 + c) * sp * 0.3, P[i][1] - j * sp, P[i][2] + dz * j]
            ch.push(q)
            dot(q, 0.7, Math.max(0.5, (1.6 - j * 0.12)) * (0.8 + 0.4 * rand()))
          }
          strip(ch, 0.35, 0.3, rand())
        }
      }
      dot(P[NT - 1], 1.1, 1.3 * thick)
    }

    const outerCount = Math.max(3, Math.round(p.symmetry))
    const rimR = Rb * Math.sin(thetaMax) * 0.92
    const rimY = Hb * Math.cos(thetaMax)
    for (let i = 0; i < outerCount; i++) {
      tentacle({
        phi: ((i + 0.5 + (rand() - 0.5) * 0.4) / outerCount) * TAU,
        r0: rimR,
        y0: rimY,
        len: Lt * (0.75 + 0.5 * rand()),
        thick: 1,
        sway: 0.3 + rand() * 0.5,
        phase: rand() * TAU,
      })
    }
    for (let i = 0; i < 5; i++) {
      tentacle({
        phi: (i / 5) * TAU + rand() * 0.5,
        r0: Rb * 0.18,
        y0: Hb * 0.05,
        len: Lt * 0.45 * (0.8 + 0.4 * rand()),
        thick: 1.5,
        sway: 0.4,
        phase: rand() * TAU,
      })
    }
  }

  const { center, radius, half } = ctx.bounds.result()
  return {
    lines, membrane, center, radius, half, filamentCount: ctx.state.filaments,
    norm: { line: 1.9, tissue: 1.0 },
  }
}
