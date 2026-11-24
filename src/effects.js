// Picture effects that turn the sampled picture into line, point-cloud or glitch art.
//   lines   flowing contour lines: every line is pushed up by the picture's brightness, so the bright
//           areas bulge like a jellyfish bell
//   points  point cloud: a grid of dots sized by brightness, jittered and dispersed like dust
//   glitch  the picture cut into displaced horizontal bands, plus bright hairline streaks
//
// They run right after the picture is sampled (see samplePicture in pipeline.js), so filaments, glow,
// relief, tone and the cyanotype stage all work on top of them. Everything scales with the frame size,
// so the preview and the export look the same. `effKeep` mixes the original picture back in.

import { clamp, createNoise, mulberry32 } from './math.js'

const TAU = Math.PI * 2

/** Float32 light map (W x H) -> effect output (same shape). Returns `G` untouched when the effect is off. */
export function applyEffect(p, G, W, H) {
  if (!p.effect || p.effect === 'none') return G
  const out =
    p.effect === 'lines' ? linesEffect(p, G, W, H) : p.effect === 'points' ? pointsEffect(p, G, W, H) : glitchEffect(p, G, W, H)
  if (p.effKeep > 0) for (let i = 0; i < out.length; i++) out[i] += G[i] * p.effKeep
  return out
}

// ---------------------------------------------------------------------------------------------- helpers

// Edge-replicating separable box blur (running sums, O(W*H)).
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const inv = 1 / (2 * r + 1)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let s = 0
    for (let k = -r; k <= r; k++) s += src[row + Math.min(W - 1, Math.max(0, k))]
    for (let x = 0; x < W; x++) {
      tmp[row + x] = s * inv
      s += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0
    for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, k)) * W + x]
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s * inv
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]
    }
  }
  return out
}

// Black canvas that is painted with additive white ink; read back as a Float32 map with `inkToMap`.
function inkCanvas(W, H) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  return ctx
}

function inkToMap(ctx, W, H) {
  const px = ctx.getImageData(0, 0, W, H).data
  const out = new Float32Array(W * H)
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] / 255
  return out
}

// ---------------------------------------------------------------------------------------------- lines

function linesEffect(p, G, W, H) {
  const N = Math.max(4, Math.round(p.effLines))
  const S = Math.min(W, H) / 900 // same scale as the filaments
  const spacing = H / N
  const bulge = p.effAmp * spacing * 2.5 // px of push for full brightness
  const step = Math.max(1, Math.round(W / 480)) // sample every `step` px along each line
  const B = boxBlur(G, W, H, Math.max(1, Math.round(Math.min(W, H) / 200)))
  const wob = createNoise(p.seed + 61) // organic ripple so the lines flow instead of looking mechanical

  const ctx = inkCanvas(W, H)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let k = 0; k < N; k++) {
    const y0 = (k + 0.5) * spacing
    const row = clamp(Math.round(y0), 0, H - 1) * W
    let prevX = 0
    let prevY = 0
    for (let x = 0; x <= W; x += step) {
      const xi = Math.min(W - 1, x)
      const b = B[row + xi] // sampled on the rest line, so the displacement never feeds back into itself
      const y = y0 - bulge * (b - 0.3) + wob(x * 0.003, k * 0.22, 0.7) * spacing * 0.8 * p.effAmp
      if (x > 0) {
        ctx.globalAlpha = clamp(0.1 + 0.9 * b, 0, 1) // faint on the empty ground, strong where the subject is
        ctx.lineWidth = Math.max(0.6, p.effWidth * S * (0.6 + 0.8 * b))
        ctx.beginPath()
        ctx.moveTo(prevX, prevY)
        ctx.lineTo(x, y)
        ctx.stroke()
      }
      prevX = x
      prevY = y
    }
  }
  ctx.globalAlpha = 1
  return inkToMap(ctx, W, H)
}

// ---------------------------------------------------------------------------------------------- points

function pointsEffect(p, G, W, H) {
  const cells = Math.max(8, Math.round(p.effCells))
  const cell = Math.min(W, H) / cells
  const cols = Math.ceil(W / cell)
  const rows = Math.ceil(H / cell)
  const rnd = mulberry32(p.seed * 131 + 17)
  const ctx = inkCanvas(W, H)

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Draw the same random numbers for every cell so the layout is stable while sliders move.
      const r0 = rnd()
      const r1 = rnd()
      const r2 = rnd()
      const r3 = rnd()
      const r4 = rnd()
      const cx = (i + 0.5) * cell
      const cy = (j + 0.5) * cell
      const b = G[Math.min(H - 1, Math.floor(cy)) * W + Math.min(W - 1, Math.floor(cx))]
      const dust = b < 0.04
      if (dust && r0 > 0.04) continue // a few stray specks around the form, nothing elsewhere

      const ang = r1 * TAU
      const reach = p.effSpread * cell * 2.5 * r2 * r2 * (1.2 - b) // dim dots drift further
      const x = cx + (r3 - 0.5) * cell * 0.6 + Math.cos(ang) * reach
      const y = cy + (r4 - 0.5) * cell * 0.6 + Math.sin(ang) * reach
      const rad = dust ? p.effSize * cell * 0.12 : Math.max(0.45, p.effSize * cell * (0.1 + 0.4 * b) * (0.6 + 0.8 * r0))
      ctx.globalAlpha = dust ? 0.5 : clamp(0.2 + 0.8 * b, 0, 1)
      ctx.beginPath()
      ctx.arc(x, y, rad, 0, TAU)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  return inkToMap(ctx, W, H)
}

// ---------------------------------------------------------------------------------------------- glitch

function glitchEffect(p, G, W, H) {
  const amt = clamp(p.effGlitch, 0, 1)
  const out = Float32Array.from(G)
  const rnd = mulberry32(p.seed * 73 + 9)

  // Displaced bands: each band is copied from the picture shifted sideways (wrapping at the edge).
  const bands = Math.round(amt * 36)
  for (let n = 0; n < bands; n++) {
    const y0 = Math.floor(rnd() * H)
    const h = 1 + Math.floor(rnd() * rnd() * H * 0.08)
    const dx = Math.round((rnd() * 2 - 1) * amt * W * 0.14)
    for (let y = y0; y < Math.min(H, y0 + h); y++) {
      const row = y * W
      for (let x = 0; x < W; x++) out[row + x] = G[row + ((((x - dx) % W) + W) % W)]
    }
  }

  // Bright hairline streaks across the frame.
  const streaks = Math.round(amt * 90)
  for (let n = 0; n < streaks; n++) {
    const y = Math.floor(rnd() * H)
    const x0 = Math.floor(rnd() * W)
    const len = Math.round(W * (0.03 + 0.35 * rnd() * rnd()))
    const v = 0.55 + 0.45 * rnd()
    for (let x = x0; x < Math.min(W, x0 + len); x++) out[y * W + x] = Math.max(out[y * W + x], v)
  }
  return out
}
