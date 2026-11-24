// Filament overlay: thin strands traced through the transformed picture, following its contours
// (and a little organic flow), then drawn as translucent light on top of the picture.

import { mulberry32, createNoise, clamp } from './math.js'

const DEG = Math.PI / 180

function blur3(src, w, h) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = src[j * w + Math.max(0, i - 1)]
      const b = src[j * w + i]
      const c = src[j * w + Math.min(w - 1, i + 1)]
      tmp[j * w + i] = (a + 2 * b + c) / 4
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = tmp[Math.max(0, j - 1) * w + i]
      const b = tmp[j * w + i]
      const c = tmp[Math.min(h - 1, j + 1) * w + i]
      out[j * w + i] = (a + 2 * b + c) / 4
    }
  }
  return out
}

/**
 * Traces strands. Output coordinates are frame space (q.x in [-aspect, aspect], q.y in [-1, 1]).
 * Each strand: { pts: [[x, y, v]...], rnd }
 */
export function traceStrands(sampler, p, aspect) {
  const count = Math.round(p.strands)
  if (count <= 0) return []
  const rand = mulberry32(p.seed * 31 + 5)
  const noise = createNoise(p.seed + 5)

  const FH = 260
  const FW = Math.max(8, Math.round(FH * aspect))
  let F = new Float32Array(FW * FH)
  for (let j = 0; j < FH; j++) {
    const qy = ((j + 0.5) / FH) * 2 - 1
    for (let i = 0; i < FW; i++) F[j * FW + i] = sampler.sample(((i + 0.5) / FW * 2 - 1) * aspect, qy)
  }
  F = blur3(F, FW, FH)

  // Importance sampling by luminance.
  const cdf = new Float32Array(F.length)
  let acc = 0
  for (let i = 0; i < F.length; i++) {
    acc += Math.pow(F[i], 1.15) + 0.0005
    cdf[i] = acc
  }
  const pick = () => {
    const t = rand() * acc
    let lo = 0
    let hi = cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const bil = (x, y) => {
    const fx = clamp(x - 0.5, 0, FW - 1.001)
    const fy = clamp(y - 0.5, 0, FH - 1.001)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const i = y0 * FW + x0
    const a = F[i] + (F[i + 1] - F[i]) * tx
    const b = F[i + FW] + (F[i + FW + 1] - F[i + FW]) * tx
    return a + (b - a) * ty
  }

  const maxSteps = Math.round(p.strandLen)
  const stepCells = 1.3
  const follow = p.strandFollow
  const strands = []

  for (let s = 0; s < count; s++) {
    const idx = pick()
    let x = (idx % FW) + rand()
    let y = Math.floor(idx / FW) + rand()
    const dirSign = rand() < 0.5 ? -1 : 1
    const pts = []
    let lastDx = 0
    let lastDy = 0
    for (let k = 0; k < maxSteps; k++) {
      const v = bil(x, y)
      if (k > 3 && v < 0.04) break
      pts.push([((x / FW) * 2 - 1) * aspect, (y / FH) * 2 - 1, v])
      // gradient -> tangent along contours
      const gx = bil(x + 1.5, y) - bil(x - 1.5, y)
      const gy = bil(x, y + 1.5) - bil(x, y - 1.5)
      const gl = Math.hypot(gx, gy)
      const qx = ((x / FW) * 2 - 1) * aspect
      const qy = (y / FH) * 2 - 1
      const a = noise(qx * 1.8, qy * 1.8, 0.4) * Math.PI * 2
      let dx = Math.cos(a)
      let dy = Math.sin(a)
      if (gl > 1e-4) {
        const tx = (-gy / gl) * dirSign
        const ty = (gx / gl) * dirSign
        const wgt = follow * clamp(gl * 18, 0, 1)
        dx = dx * (1 - wgt) + tx * wgt
        dy = dy * (1 - wgt) + ty * wgt
      }
      // inertia keeps strands smooth
      dx = dx * 0.45 + lastDx * 0.55
      dy = dy * 0.45 + lastDy * 0.55
      const dl = Math.hypot(dx, dy) || 1
      dx /= dl
      dy /= dl
      lastDx = dx
      lastDy = dy
      x += dx * stepCells
      y += dy * stepCells
      if (x < 1 || y < 1 || x > FW - 1 || y > FH - 1) break
    }
    if (pts.length > 4) strands.push({ pts, rnd: rand() })
  }
  return strands
}

/**
 * Draws strands as additive light into a W x H canvas context. Returns nothing.
 * Parallax (xTilt / xYaw) shifts each point by its picture brightness, as if the image had relief.
 */
export function drawStrands(ctx, strands, W, H, aspect, p) {
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const scale = Math.min(W, H) / 900
  const base = p.strandWidth * scale
  const par = p.xDepth * 0.12
  const tx = Math.sin(p.xYaw * DEG)
  const ty = Math.sin(p.xTilt * DEG)
  const sx = W / (2 * aspect)
  const sy = H / 2
  const gain = p.strandGain * clamp(Math.sqrt(2200 / Math.max(200, p.strands)), 0.35, 1.3)

  for (const s of strands) {
    const P = s.pts.map(([x, y, v]) => {
      const shift = (v - 0.4) * par
      return [(x + shift * tx + aspect) * sx, (y - shift * ty + 1) * sy, v]
    })
    const wMul = 0.6 + 0.9 * s.rnd
    for (let i = 0; i < P.length - 1; i++) {
      const t = i / (P.length - 1)
      const taper = Math.sin(Math.PI * Math.min(1, t * 1.05)) // fade at both ends
      const v = (P[i][2] + P[i + 1][2]) / 2
      let alpha = gain * 0.3 * taper * (0.35 + 0.9 * v) * (0.6 + 0.6 * s.rnd)
      let lw = base * wMul * (0.5 + 0.8 * v)
      if (alpha < 0.004) continue
      if (lw < 0.8) {
        alpha *= lw / 0.8
        lw = 0.8
      }
      ctx.globalAlpha = Math.min(1, alpha)
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(P[i][0], P[i][1])
      ctx.lineTo(P[i + 1][0], P[i + 1][1])
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}
