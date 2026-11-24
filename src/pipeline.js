// Picture pipeline (no WebGL):
//   stage 1  sample the transformed picture -> + relief + glow + filaments  => Float32 "light" map
//   stage 2  exposure, vignette, levels, gamma, S-curve, dither  => Float32 artwork
//            then the cyanotype post-process (negative / simulation) => pixels

import { makeSampler } from './transform.js'
import { traceStrands, drawStrands } from './strands.js'
import { applyEffect } from './effects.js'
import { clamp, smoothstep } from './math.js'
import { applyCyanotype, simulatePrint } from './cyanotype.js'

const DEG = Math.PI / 180

function blurGrid(src, w, h) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      tmp[j * w + i] = (src[j * w + Math.max(0, i - 1)] + 2 * src[j * w + i] + src[j * w + Math.min(w - 1, i + 1)]) / 4
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      out[j * w + i] = (tmp[Math.max(0, j - 1) * w + i] + 2 * tmp[j * w + i] + tmp[Math.min(h - 1, j + 1) * w + i]) / 4
    }
  }
  return out
}

/** Sample the transformed picture at W x H. */
export function samplePicture(p, A, B, W, H) {
  const aspect = W / H
  const sampler = makeSampler(p, A, B, aspect)
  const G = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const qy = ((y + 0.5) / H) * 2 - 1
    const row = y * W
    for (let x = 0; x < W; x++)     G[row + x] = sampler.sample((((x + 0.5) / W) * 2 - 1) * aspect, qy)
  }
  // Line / point-cloud / glitch effects replace the sampled picture here (no-op when effect = none).
  return { G: applyEffect(p, G, W, H), sampler, aspect }
}

/** Filament overlay as a Float32 light map (or null when strands = 0). */
export function filamentLayer(p, sampler, aspect, W, H) {
  if (p.strands < 1 || p.strandGain <= 0) return null
  const strands = traceStrands(sampler, p, aspect)
  if (!strands.length) return null
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  drawStrands(ctx, strands, W, H, aspect, p)
  const px = ctx.getImageData(0, 0, W, H).data
  const out = new Float32Array(W * H)
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] / 255
  return out
}

/** Combine picture, relief, glow and filaments into a light map. */
export function composeBase(p, G, fil, W, H) {
  const acc = new Float32Array(W * H)
  const mix = p.photoMix

  // Relief: a rim-lit emboss of the picture's own luminance.
  const depth = p.xDepth
  const la = p.xLight * DEG
  const lx = Math.cos(la)
  const ly = Math.sin(la)
  const s = Math.max(1, Math.round(Math.min(W, H) / 700))
  const reliefK = depth * 0.9

  // Glow: coarse blurred copy of the picture.
  const block = Math.max(4, Math.round(Math.min(W, H) / 120))
  const gw = Math.ceil(W / block)
  const gh = Math.ceil(H / block)
  let glow = null
  if (p.glow > 0.001) {
    glow = new Float32Array(gw * gh)
    const cnt = new Float32Array(gw * gh)
    for (let y = 0; y < H; y++) {
      const gj = Math.floor(y / block) * gw
      for (let x = 0; x < W; x++) {
        const gi = gj + Math.floor(x / block)
        glow[gi] += G[y * W + x]
        cnt[gi]++
      }
    }
    for (let i = 0; i < glow.length; i++) glow[i] /= cnt[i] || 1
    glow = blurGrid(blurGrid(blurGrid(glow, gw, gh), gw, gh), gw, gh)
  }
  const glowK = p.glow * 0.7

  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - s)
    const yp = Math.min(H - 1, y + s)
    const row = y * W
    let gl0 = 0
    let gl1 = 0
    let gty = 0
    if (glow) {
      const fy = clamp((y + 0.5) / block - 0.5, 0, gh - 1.001)
      gl0 = Math.floor(fy) * gw
      gl1 = gl0 + gw
      gty = fy - Math.floor(fy)
    }
    for (let x = 0; x < W; x++) {
      const i = row + x
      let v = mix * G[i]
      if (reliefK > 0) {
        const xm = Math.max(0, x - s)
        const xp = Math.min(W - 1, x + s)
        const gx = G[row + xp] - G[row + xm]
        const gy = G[yp * W + x] - G[ym * W + x]
        const e = gx * lx + gy * ly
        if (e > 0) v += reliefK * e * 1.3
      }
      if (glow) {
        const fx = clamp((x + 0.5) / block - 0.5, 0, gw - 1.001)
        const xi = Math.floor(fx)
        const tx = fx - xi
        const a = glow[gl0 + xi] + (glow[gl0 + xi + 1] - glow[gl0 + xi]) * tx
        const b = glow[gl1 + xi] + (glow[gl1 + xi + 1] - glow[gl1 + xi]) * tx
        v += glowK * (a + (b - a) * gty)
      }
      if (fil) v += fil[i]
      acc[i] = v
    }
  }
  return acc
}

function hash(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Stage 2a - "Tone & print": exposure, vignette, levels, gamma, S-curve, dither.
 * Returns the rendered artwork as a Float32 grayscale map (0..1, light on dark). With the default
 * (clean) settings this is the picture untouched.
 */
export function toneMap(p, acc, W, H) {
  const out = new Float32Array(W * H)

  // levels -> gamma -> S-curve as a lookup table (input in [0, 1]).
  const N = 16384
  const lut = new Float32Array(N + 1)
  const black = p.blackPoint
  const span = Math.max(0.001, p.whitePoint - black)
  for (let i = 0; i <= N; i++) {
    let v = clamp((i / N - black) / span, 0, 1)
    v = Math.pow(v, 1 / p.gamma)
    const sc = v * v * (3 - 2 * v)
    lut[i] = v + (sc - v) * p.contrast
  }

  const ex = p.exposure
  const vig = p.vignette
  const grain = p.grain
  const mirror = p.mirror
  const shoulder = p.shoulder
  const flat = black === 0 && p.whitePoint >= 1 && p.gamma === 1 && p.contrast === 0 // identity curve: skip the LUT

  for (let y = 0; y < H; y++) {
    const ny = ((y + 0.5) / H) * 2 - 1
    for (let x = 0; x < W; x++) {
      const sx = mirror ? W - 1 - x : x
      let v = acc[y * W + sx] * ex
      if (shoulder && v > 0.6) v = 0.6 + 0.4 * Math.tanh((v - 0.6) / 0.4) // soft shoulder keeps highlight detail
      if (vig > 0) {
        const nx = ((sx + 0.5) / W) * 2 - 1
        v *= 1 - vig * smoothstep(0.55, 1.3, Math.hypot(nx, ny))
      }
      v = flat ? clamp(v, 0, 1) : lut[Math.round(clamp(v, 0, 1) * N)]
      if (grain > 0) v = clamp(v + (hash(x, y) + hash(x + 9173, y + 4231) - 1) * grain, 0, 1)
      out[y * W + x] = v
    }
  }
  return out
}

/**
 * Stage 2b - the three views, as Float32 maps:
 *   'mono'      original artwork
 *   'negative'  digital negative (cyanotype adjustments + invert)
 *   'cyanotype' the same negative (the simulation colours are applied by floatToImageData / the exporter)
 */
export function processLayers(p, acc, W, H, mode) {
  const art = toneMap(p, acc, W, H)
  return mode === 'mono' ? art : applyCyanotype(p, art, W, H)
}

/** Float map -> pixels. mode 'cyanotype' paints the Prussian-blue print simulation, anything else is grayscale. */
export function floatToImageData(f, W, H, mode) {
  const out = new ImageData(W, H)
  const d = out.data
  if (mode === 'cyanotype') {
    simulatePrint(f, d, 4)
  } else {
    for (let i = 0, o = 0; i < f.length; i++, o += 4) {
      const g = Math.round(clamp(f[i], 0, 1) * 255)
      d[o] = g
      d[o + 1] = g
      d[o + 2] = g
      d[o + 3] = 255
    }
  }
  return out
}

/** Convenience: tone & print -> ImageData for the preview. mode: 'mono' | 'negative' | 'cyanotype'. */
export function postProcess(p, acc, W, H, mode) {
  return floatToImageData(processLayers(p, acc, W, H, mode), W, H, mode)
}

export function imageDataToCanvas(img) {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d').putImageData(img, 0, 0)
  return c
}
