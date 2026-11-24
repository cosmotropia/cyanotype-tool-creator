// Image transform chain: output pixel -> source pixel.
//   zoom -> rotate -> radial symmetry (kaleidoscope) -> curvature warp -> organic noise -> sample A/B (morph) -> tone
// Everything here is plain code; the same sampler drives the pixels and the filament field.

import { createNoise, clamp, lerp } from './math.js'
import { makeFrameLayer } from './frames.js'

const DEG = Math.PI / 180
const TAU = Math.PI * 2

// Coarse noise lookup so per-pixel organic warps stay cheap at print resolution.
function makeNoiseGrid(seed) {
  const noise = createNoise(seed)
  const N = 128
  const RANGE = 2.4
  const gx = new Float32Array(N * N)
  const gy = new Float32Array(N * N)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 * RANGE - RANGE
      const y = (j / (N - 1)) * 2 * RANGE - RANGE
      gx[j * N + i] = noise(x * 1.1, y * 1.1, 0.3) + 0.4 * noise(x * 2.9, y * 2.9, 1.7)
      gy[j * N + i] = noise(x * 1.1 + 9.1, y * 1.1 + 4.2, 0.9) + 0.4 * noise(x * 2.9 + 3, y * 2.9, 2.2)
    }
  }
  let NX = 0
  let NY = 0
  const at = (x, y) => {
    const fx = clamp(((x + RANGE) / (2 * RANGE)) * (N - 1), 0, N - 1.001)
    const fy = clamp(((y + RANGE) / (2 * RANGE)) * (N - 1), 0, N - 1.001)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const i = y0 * N + x0
    NX = lerp(lerp(gx[i], gx[i + 1], tx), lerp(gx[i + N], gx[i + N + 1], tx), ty)
    NY = lerp(lerp(gy[i], gy[i + 1], tx), lerp(gy[i + N], gy[i + N + 1], tx), ty)
  }
  return { at, get x() { return NX }, get y() { return NY } }
}

function sampler2D(src) {
  const { gray, w, h } = src
  return (u, v) => {
    if (u < 0 || v < 0 || u > 1 || v > 1) return 0
    const fx = u * (w - 1)
    const fy = v * (h - 1)
    const x0 = Math.min(w - 2, Math.floor(fx))
    const y0 = Math.min(h - 2, Math.floor(fy))
    const tx = fx - x0
    const ty = fy - y0
    const i = y0 * w + x0
    const top = gray[i] + (gray[i + 1] - gray[i]) * tx
    const bot = gray[i + w] + (gray[i + w + 1] - gray[i + w]) * tx
    return top + (bot - top) * ty
  }
}

/**
 * Frame space: q.y in [-1, 1], q.x in [-aspect, aspect]. Source pictures cover the frame.
 * Returns { sample(qx, qy) -> tone-mapped gray in [0,1] }.
 */
export function makeSampler(p, A, B, aspect) {
  const grid = makeNoiseGrid(p.seed + 77)
  const zoom = Math.max(0.05, p.xZoom)
  const panX = p.xPanX || 0
  const panY = p.xPanY || 0
  const rot = p.xRotate * DEG
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  const folds = Math.round(p.xFolds)
  const seg = folds >= 2 ? TAU / folds : 0
  const amt = p.xBend
  const type = p.imgWarpType
  const org = p.xOrganic
  const morph = clamp(p.imgMorph, 0, 1)
  const contrast = p.imgContrast
  const thr = p.imgThreshold
  const invert = p.imgInvert
  const frames = makeFrameLayer(p)

  const cover = (S) => {
    const aS = S.w / S.h
    const Hs = Math.max(1, aspect / aS)
    return { Ws: Hs * aS, Hs }
  }
  const fitA = cover(A)
  const smpA = sampler2D(A)
  const fitB = B ? cover(B) : null
  const smpB = B ? sampler2D(B) : null

  let DX = 0
  let DY = 0
  const displace = (x, y) => {
    const r2 = x * x + y * y
    switch (type) {
      case 'twirl': {
        const a = amt * 2.2 * Math.exp(-r2 * 1.8)
        const c = Math.cos(a)
        const s = Math.sin(a)
        DX = x * c - y * s - x
        DY = x * s + y * c - y
        break
      }
      case 'bulge': {
        const f = 1 - amt * 0.6 * (1 - Math.min(1, r2))
        DX = x * (f - 1)
        DY = y * (f - 1)
        break
      }
      case 'wave':
        DX = Math.sin(y * 5 + 1.3) * amt * 0.12
        DY = Math.cos(x * 5 + 0.4) * amt * 0.12
        break
      default:
        grid.at(x * 0.8, y * 0.8)
        DX = grid.x * amt * 0.22
        DY = grid.y * amt * 0.22
    }
    if (org > 0) {
      grid.at(x * 1.6 + 5, y * 1.6 - 3)
      DX += grid.x * org * 0.08
      DY += grid.y * org * 0.08
    }
  }

  function sample(qx, qy) {
    // Pan first (screen space), so the picture follows the hand; then zoom and rotate around the frame centre.
    let x = (qx - panX) / zoom
    let y = (qy - panY) / zoom
    const rx = x * cr - y * sr
    const ry = x * sr + y * cr
    x = rx
    y = ry
    if (seg > 0) {
      const r = Math.hypot(x, y)
      let th = ((Math.atan2(y, x) % seg) + seg) % seg
      if (p.xMirror && th > seg / 2) th = seg - th
      x = r * Math.cos(th)
      y = r * Math.sin(th)
    }
    displace(x, y)
    let val
    if (B) {
      const a = smpA(0.5 + (x + morph * DX) / (2 * fitA.Ws), 0.5 + (y + morph * DY) / (2 * fitA.Hs))
      const b = smpB(0.5 + (x - (1 - morph) * DX) / (2 * fitB.Ws), 0.5 + (y - (1 - morph) * DY) / (2 * fitB.Hs))
      val = a + (b - a) * morph
    } else {
      val = smpA(0.5 + (x + DX) / (2 * fitA.Ws), 0.5 + (y + DY) / (2 * fitA.Hs))
    }
    if (invert) val = 1 - val
    val = 0.5 + (val - 0.5) * contrast
    val = val < 0 ? 0 : val > 1 ? 1 : val
    val = (val - thr) / (1 - thr)
    if (val < 0) val = 0
    return frames ? frames(qx, qy, val) : val // photo frames sit on top, independent of the picture's own transform
  }

  return { sample }
}
