// Cyanotype post-processing. Non-destructive: it only reads the rendered artwork (a Float32 grayscale map,
// light subject on a dark ground) and returns a new map. The procedural geometry is never touched.
//
//   1  grayscale luminance (the artwork is already a luminance map)
//   2  brightness -> contrast -> black / white point -> gamma
//   3  optional unsharp mask (radius scales with the image so preview == export)
//   4  invert  => digital negative (dark subject on pure white). All intermediate grey levels are kept.
//   5  optional threshold (off by default) and horizontal mirror
//
// The cyanotype *simulation* is a separate render of the finished negative: exposed (clear film) areas turn
// Prussian blue, blocked areas stay off-white paper, grey values give intermediate blues.

import { clamp } from './math.js'

const LUT_N = 65535

// ---------------------------------------------------------------------------------------------- blur
// Edge-replicating running-sum box blur of one line, `src` -> `dst` (length n).
function boxLine(src, dst, n, r) {
  const w = 2 * r + 1
  let sum = 0
  for (let k = -r; k <= r; k++) sum += src[k < 0 ? 0 : k >= n ? n - 1 : k]
  for (let i = 0; i < n; i++) {
    dst[i] = sum / w
    const add = i + r + 1
    const sub = i - r
    sum += src[add >= n ? n - 1 : add] - src[sub < 0 ? 0 : sub]
  }
}

// ~Gaussian blur (3 box passes) in place on a W*H Float32Array.
function gaussianBlur(a, W, H, sigma) {
  const wIdeal = Math.sqrt(4 * sigma * sigma + 1)
  const r = Math.max(1, Math.round((wIdeal - 1) / 2))
  // rows
  const scratch = new Float32Array(Math.max(W, H))
  for (let y = 0; y < H; y++) {
    const row = a.subarray(y * W, (y + 1) * W)
    for (let pass = 0; pass < 3; pass++) {
      boxLine(row, scratch, W, r)
      row.set(scratch.subarray(0, W))
    }
  }
  // columns, in strips so memory access stays friendly
  const S = 16
  const strip = new Float32Array(S * H)
  for (let x0 = 0; x0 < W; x0 += S) {
    const cw = Math.min(S, W - x0)
    for (let y = 0; y < H; y++) {
      const o = y * W + x0
      for (let c = 0; c < cw; c++) strip[c * H + y] = a[o + c]
    }
    for (let c = 0; c < cw; c++) {
      const col = strip.subarray(c * H, (c + 1) * H)
      for (let pass = 0; pass < 3; pass++) {
        boxLine(col, scratch, H, r)
        col.set(scratch.subarray(0, H))
      }
    }
    for (let y = 0; y < H; y++) {
      const o = y * W + x0
      for (let c = 0; c < cw; c++) a[o + c] = strip[c * H + y]
    }
  }
}

function unsharp(v, W, H, amount) {
  const sigma = Math.max(0.7, Math.min(W, H) * 0.0007)
  const blur = Float32Array.from(v)
  gaussianBlur(blur, W, H, sigma)
  for (let i = 0; i < v.length; i++) {
    const s = v[i] + amount * (v[i] - blur[i])
    v[i] = s < 0 ? 0 : s > 1 ? 1 : s
  }
}

// ---------------------------------------------------------------------------------------------- pipeline
/** Cyanotype settings -> digital negative. Works in place on `v` (values 0..1) and returns it. */
export function applyCyanotype(p, v, W, H) {
  const contrast = p.cyContrast / 100
  const bright = p.cyBrightness / 200 // -100..100 -> -0.5..+0.5
  const black = clamp(p.cyBlack / 100, 0, 0.95)
  const white = Math.max(black + 0.01, p.cyWhite / 100)
  const invGamma = 1 / Math.max(0.05, p.cyGamma)

  const identity = contrast === 1 && bright === 0 && black === 0 && white >= 1 && invGamma === 1
  if (!identity) {
    const lut = new Float32Array(LUT_N + 1)
    for (let i = 0; i <= LUT_N; i++) {
      let x = (i / LUT_N - 0.5) * contrast + 0.5 + bright
      x = clamp((x - black) / (white - black), 0, 1)
      lut[i] = invGamma === 1 ? x : Math.pow(x, invGamma)
    }
    for (let i = 0; i < v.length; i++) {
      const x = v[i]
      v[i] = lut[Math.round((x < 0 ? 0 : x > 1 ? 1 : x) * LUT_N)]
    }
  }

  if (p.cySharpen > 0) unsharp(v, W, H, p.cySharpen / 100)

  if (p.cyInvert) for (let i = 0; i < v.length; i++) v[i] = 1 - v[i]

  const thr = p.cyThreshold / 100
  if (thr > 0) for (let i = 0; i < v.length; i++) v[i] = v[i] >= thr ? 1 : 0

  if (p.cyMirror) {
    for (let y = 0; y < H; y++) {
      const row = v.subarray(y * W, (y + 1) * W)
      row.reverse()
    }
  }
  return v
}

// ---------------------------------------------------------------------------------------------- simulation
// Colour ramp of a printed cyanotype, by exposure amount t (0 = unexposed paper, 1 = fully exposed Prussian blue).
const STOPS = [
  [0.0, [243, 240, 227]], // off-white paper
  [0.18, [196, 214, 220]],
  [0.4, [118, 165, 197]],
  [0.65, [38, 99, 156]],
  [0.85, [10, 58, 110]],
  [1.0, [3, 38, 82]], // Prussian blue (Dmax)
]

let simLut = null
function getSimLut() {
  if (simLut) return simLut
  const N = 1024
  simLut = new Uint8Array((N + 1) * 3)
  for (let i = 0; i <= N; i++) {
    const t = i / N
    let k = 0
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++
    const [t0, c0] = STOPS[k]
    const [t1, c1] = STOPS[k + 1]
    const f = clamp((t - t0) / (t1 - t0), 0, 1)
    for (let c = 0; c < 3; c++) simLut[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * f)
  }
  return simLut
}

/**
 * Simulate the print made from the digital negative `neg` (1 = clear film -> UV passes -> blue,
 * 0 = opaque film -> paper stays white). Writes RGB into `rgb` (3 bytes per pixel) or RGBA when `stride` is 4.
 */
export function simulatePrint(neg, rgb, stride = 3) {
  const lut = getSimLut()
  for (let i = 0, o = 0; i < neg.length; i++, o += stride) {
    const t = neg[i]
    const k = Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * 1024) * 3
    rgb[o] = lut[k]
    rgb[o + 1] = lut[k + 1]
    rgb[o + 2] = lut[k + 2]
    if (stride === 4) rgb[o + 3] = 255
  }
}
