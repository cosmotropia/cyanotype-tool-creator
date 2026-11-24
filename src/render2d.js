// CPU/Canvas2D renderer for the procedural generators. No WebGL required.
// Light is accumulated additively ('lighter') at half intensity into an 8-bit canvas, then decoded
// back to linear light and passed through a soft film shoulder to give a display-ready grayscale map.

import { buildView, makeProjector } from './camera.js'
import { clamp, smoothstep } from './math.js'

let spriteCache = null
function glowSprite() {
  if (spriteCache) return spriteCache
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.12, 'rgba(255,255,255,0.8)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.28)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.06)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  spriteCache = c
  return c
}

/**
 * Renders a generator result to a Float32 grayscale map in [0, 1] (row-major, W*H).
 */
export function renderStructure(structure, params, W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#fff'

  const view = buildView(structure, params, W, H)
  const project = makeProjector(view, W, H)
  const D = view.D
  const R = structure.radius
  const scale = Math.min(W, H) / 900
  const HALF = 0.5 // render at half intensity so overlaps don't clip in 8 bits
  const gain = 0.42 * structure.norm.line * HALF
  const tissueGain = params.membrane * structure.norm.tissue * HALF
  const baseWidth = params.lineWidth * 1.35 * scale
  const dotPx = 2.0 * scale

  const fogOf = (viewZ) => {
    const depthN = (-viewZ - D) / R
    return 1 - params.fog * 0.92 * clamp(depthN * 0.5 + 0.5, 0, 1)
  }
  const blurOf = (viewZ) => Math.abs((-viewZ - D) / R - params.focusDepth) * params.focus * 3

  // ---- Tissue sheets ----
  if (tissueGain > 0.001) {
    for (const sh of structure.membrane.sheets) {
      const { grid, cols, rows, uv, fade } = sh
      const P = grid.map((pt) => project(pt))
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i00 = r * cols + c
          const a = P[i00]
          const b = P[i00 + 1]
          const d = P[i00 + cols]
          const e = P[i00 + cols + 1]
          // view-space normal
          const ux = b[3] - a[3]
          const uy = b[4] - a[4]
          const uz = b[2] - a[2]
          const vx = d[3] - a[3]
          const vy = d[4] - a[4]
          const vz = d[2] - a[2]
          let nx = uy * vz - uz * vy
          let ny = uz * vx - ux * vz
          let nz = ux * vy - uy * vx
          const nl = Math.hypot(nx, ny, nz) || 1
          nx /= nl
          ny /= nl
          nz /= nl
          const cx = (a[3] + e[3]) / 2
          const cy = (a[4] + e[4]) / 2
          const cz = (a[2] + e[2]) / 2
          const vl = Math.hypot(cx, cy, cz) || 1
          const ndv = Math.abs((nx * -cx + ny * -cy + nz * -cz) / vl)
          const fres = Math.pow(1 - ndv, 1.6)
          const i11 = i00 + cols + 1
          const u = (uv[i00][0] + uv[i11][0]) / 2
          const t = (uv[i00][1] + uv[i11][1]) / 2
          const rim = smoothstep(0.7, 1.0, Math.abs(u))
          const veins = 0.5 + 0.5 * Math.cos(u * Math.PI * 9)
          const tFade = smoothstep(0, 0.14, t) * (1 - 0.35 * t)
          const f = (fade[i00] + fade[i11]) / 2
          const v = (0.035 + 0.075 * veins + 0.5 * fres + 0.45 * rim) * tFade * f * fogOf(cz) * tissueGain * 0.35
          const g = Math.round(v * 255)
          if (g < 1) continue
          ctx.fillStyle = `rgb(${g},${g},${g})`
          ctx.beginPath()
          ctx.moveTo(a[0], a[1])
          ctx.lineTo(b[0], b[1])
          ctx.lineTo(e[0], e[1])
          ctx.lineTo(d[0], d[1])
          ctx.closePath()
          ctx.fill()
        }
      }
    }
  }

  // ---- Filament strips ----
  for (const s of structure.lines.strips) {
    const P = s.pts.map((pt) => project(pt))
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i]
      const b = P[i + 1]
      const z = (a[2] + b[2]) / 2
      const persp = Math.pow(D / Math.max(1, -z), 0.8)
      const w = baseWidth * ((s.wm[i] + s.wm[i + 1]) / 2) * persp
      const blur = blurOf(z)
      let alpha = ((s.br[i] + s.br[i + 1]) / 2) * fogOf(z) * gain * (w / (w + 2 * blur))
      if (alpha < 0.004) continue
      let lw = w + blur * 1.5
      if (lw < 0.8) {
        alpha *= lw / 0.8
        lw = 0.8
      }
      ctx.globalAlpha = Math.min(1, alpha)
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
  }

  // ---- Glowing dots ----
  const sprite = glowSprite()
  for (const d of structure.lines.dots) {
    const p = project(d.p)
    const persp = Math.pow(D / Math.max(1, -p[2]), 0.8)
    const blur = blurOf(p[2])
    const rad = dotPx * d.size * persp + blur
    const alpha = d.br * fogOf(p[2]) * gain * 0.9 * (rad / (rad + 1.5 * blur)) * 1.6
    if (alpha < 0.004) continue
    const ext = Math.max(1.5, rad * 3)
    ctx.globalAlpha = Math.min(1, alpha)
    ctx.drawImage(sprite, p[0] - ext, p[1] - ext, ext * 2, ext * 2)
  }
  ctx.globalAlpha = 1

  // ---- Decode to linear light, apply a soft shoulder ----
  const px = ctx.getImageData(0, 0, W, H).data
  const out = new Float32Array(W * H)
  const ex = params.genExposure
  for (let i = 0; i < out.length; i++) {
    const v = (px[i * 4] / 255) / HALF
    out[i] = 1 - Math.exp(-v * ex)
  }
  return { gray: out, w: W, h: H }
}
