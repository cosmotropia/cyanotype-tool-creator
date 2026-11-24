// Photo frames: extra pictures placed on top of the main picture, each one cut into a shape (circle, triangle…)
// and with its own size and position in centimetres. Several frames can be used at once, e.g. three photos in circles.
//
// The settings of every frame are plain data in params.frames (so undo / redo and copy-paste cover them).
// The pictures themselves live in `frameImages` (frame id -> source), because they are too big for the params.
//
// Frame space: q.y in [-1, 1] (the frame height), q.x in [-aspect, aspect]. One cm = 2 / printH units.

export const FRAME_SHAPES = [
  ['circle', 'Circle / oval'],
  ['rect', 'Rectangle'],
  ['rounded', 'Rounded square'],
  ['triangle', 'Triangle'],
  ['diamond', 'Diamond'],
  ['hexagon', 'Hexagon'],
  ['star', 'Star'],
  ['arch', 'Arch'],
]
const SHAPE_ID = Object.fromEntries(FRAME_SHAPES.map(([id], i) => [id, i]))

// How an overlay mixes with what is under it (the picture and the overlays below). Values are light: 0 dark, 1 bright.
export const BLEND_MODES = [
  ['normal', 'Normal (covers what is below)'],
  ['add', 'Add (light on top of light)'],
  ['screen', 'Screen (soft add)'],
  ['lighten', 'Lighten (keeps the brighter)'],
  ['darken', 'Darken (keeps the darker)'],
  ['multiply', 'Multiply (darkens)'],
  ['difference', 'Difference'],
]
const BLEND_ID = Object.fromEntries(BLEND_MODES.map(([id], i) => [id, i]))

export const frameImages = new Map() // frame id -> { gray, w, h, label }

const uid = () => 'f' + Math.random().toString(36).slice(2, 8)
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
const round1 = (v) => Math.round(v * 10) / 10

export function newFrame(p, shape = 'circle', over = {}) {
  const s = round1(Math.min(p.printW, p.printH) * 0.5)
  return sanitizeFrame({ id: uid(), shape, x: 0, y: 0, w: s, h: s, ...over })
}

/** Makes any object a valid frame (used when loading settings from undo history or the clipboard). */
export function sanitizeFrame(f) {
  return {
    id: typeof f.id === 'string' && f.id ? f.id : uid(),
    shape: f.shape in SHAPE_ID ? f.shape : 'circle',
    x: num(f.x, 0), // cm from the centre of the print, right is positive
    y: num(f.y, 0), // cm from the centre of the print, down is positive
    w: Math.max(0.2, num(f.w, 8)), // cm
    h: Math.max(0.2, num(f.h, 8)),
    rot: num(f.rot, 0), // degrees
    soft: Math.min(0.6, Math.max(0, num(f.soft, 0))), // edge softness
    border: Math.max(0, num(f.border, 0)), // outline thickness, cm
    opacity: Math.min(1, Math.max(0, num(f.opacity, 1))),
    zoom: Math.min(6, Math.max(1, num(f.zoom, 1))), // zoom of the picture inside the frame
    panX: Math.min(1, Math.max(-1, num(f.panX, 0))), // slide the picture inside the frame
    panY: Math.min(1, Math.max(-1, num(f.panY, 0))),
    invert: !!f.invert,
    // Independent of the picture below: size multiplier, mixing, tone and visibility of this overlay only.
    scale: Math.min(6, Math.max(0.05, num(f.scale, 1))), // multiplies width and height
    blend: f.blend in BLEND_ID ? f.blend : 'normal',
    brightness: Math.min(1, Math.max(-1, num(f.brightness, 0))),
    contrast: Math.min(4, Math.max(0.1, num(f.contrast, 1))),
    flipX: !!f.flipX,
    flipY: !!f.flipY,
    visible: f.visible !== false,
    borderTone: Math.min(1, Math.max(0, num(f.borderTone, 1))), // outline brightness: 1 light, 0 dark
  }
}

export const sanitizeFrames = (list) => (Array.isArray(list) ? list.slice(0, 24).map(sanitizeFrame) : [])

// Ready-made arrangements, sized from the print size so they always fit.
export const FRAME_LAYOUTS = {
  '3 circles in a row': (W, H) => {
    const d = round1(Math.min((W / 3) * 0.88, H * 0.8))
    return [-1, 0, 1].map((i) => ({ shape: 'circle', x: round1((i * W) / 3), y: 0, w: d, h: d }))
  },
  '2 circles': (W, H) => {
    const d = round1(Math.min((W / 2) * 0.88, H * 0.8))
    return [-1, 1].map((i) => ({ shape: 'circle', x: round1((i * W) / 4), y: 0, w: d, h: d }))
  },
  '1 big circle': (W, H) => {
    const d = round1(Math.min(W, H) * 0.9)
    return [{ shape: 'circle', x: 0, y: 0, w: d, h: d }]
  },
  '2 × 2 rounded squares': (W, H) => {
    const d = round1(Math.min(W, H) / 2 * 0.88)
    return [-1, 1].flatMap((j) => [-1, 1].map((i) => ({ shape: 'rounded', x: round1((i * W) / 4), y: round1((j * H) / 4), w: d, h: d })))
  },
  '3 triangles in a row': (W, H) => {
    const d = round1(Math.min((W / 3) * 0.9, H * 0.8))
    return [-1, 0, 1].map((i) => ({ shape: 'triangle', x: round1((i * W) / 3), y: 0, w: d, h: round1(d * 0.9) }))
  },
  '3 hexagons in a row': (W, H) => {
    const d = round1(Math.min((W / 3) * 0.9, H * 0.8))
    return [-1, 0, 1].map((i) => ({ shape: 'hexagon', x: round1((i * W) / 3), y: 0, w: d, h: round1(d * 0.88) }))
  },
}

// Bilinear sample of a gray source at (u, v) in [0, 1].
function sampleGray(src, u, v) {
  const { gray, w, h } = src
  const fx = Math.min(w - 1.001, Math.max(0, u * (w - 1)))
  const fy = Math.min(h - 1.001, Math.max(0, v * (h - 1)))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = y0 * w + x0
  const top = gray[i] + (gray[i + 1] - gray[i]) * tx
  const bot = gray[i + w] + (gray[i + w + 1] - gray[i + w]) * tx
  return top + (bot - top) * ty
}

// Star: 5 points, outer radius 1, inner radius STAR_IN. Fills the unit box.
const STAR_IN = 0.42
const STAR_SEG = (Math.PI * 2) / 5
const STAR_PO = [0, 1]
const STAR_PI = [STAR_IN * Math.sin(STAR_SEG / 2), STAR_IN * Math.cos(STAR_SEG / 2)]
const STAR_D = [STAR_PI[0] - STAR_PO[0], STAR_PI[1] - STAR_PO[1]]
const STAR_CROSS = STAR_PO[0] * STAR_D[1] - STAR_PO[1] * STAR_D[0]

/**
 * "Distance" of the point (u, v) from the frame centre, where the frame (box) spans [-1, 1] on both axes:
 * below 1 is inside the shape, exactly 1 is on its outline.
 */
function shapeDist(shape, u, v) {
  const au = Math.abs(u)
  const av = Math.abs(v)
  switch (shape) {
    case 0: // circle / oval
      return Math.hypot(u, v)
    case 1: // rectangle
      return Math.max(au, av)
    case 2: // rounded square (superellipse)
      return Math.pow(au ** 4 + av ** 4, 0.25)
    case 3: // triangle, apex up
      return Math.max(v, 2 * u - v, -2 * u - v)
    case 4: // diamond
      return au + av
    case 5: // hexagon
      return Math.max(av, au + 0.5 * av)
    case 6: {
      // star
      const x = u * 0.951
      const y = -0.0955 + v * 0.9045
      const r = Math.hypot(x, y)
      if (r < 1e-6) return 0
      let a = (((Math.atan2(x, -y) % STAR_SEG) + STAR_SEG) % STAR_SEG)
      if (a > STAR_SEG / 2) a = STAR_SEG - a
      const dx = Math.sin(a)
      const dy = Math.cos(a)
      const t = STAR_CROSS / (dx * STAR_D[1] - dy * STAR_D[0])
      return r / t
    }
    default: // arch: round on top, straight at the bottom
      return v < 0 ? Math.hypot(u, v) : Math.max(au, v)
  }
}

/**
 * Returns compose(qx, qy, val) -> val with every frame painted over the picture value, or null when no frame
 * has a picture (so the common case costs nothing).
 */
export function makeFrameLayer(p) {
  const list = (p.frames || []).filter((f) => f.visible !== false && frameImages.has(f.id) && f.opacity > 0.001)
  if (!list.length) return null
  const k = 2 / Math.max(0.1, p.printH) // frame units per cm

  const fr = list.map((f) => {
    const src = frameImages.get(f.id)
    const sc = f.scale || 1
    const hw = (f.w * sc * k) / 2
    const hh = (f.h * sc * k) / 2
    const rot = (f.rot * Math.PI) / 180
    const sAsp = src.w / src.h
    const bAsp = f.w / f.h
    const fw = sAsp > bAsp ? bAsp / sAsp : 1 // part of the picture that is visible (cover fit)
    const fh = sAsp > bAsp ? 1 : sAsp / bAsp
    const z = Math.max(1, f.zoom)
    return {
      src,
      shape: SHAPE_ID[f.shape] ?? 0,
      cx: f.x * k,
      cy: f.y * k,
      hw,
      hh,
      r2: hw * hw + hh * hh,
      c: Math.cos(rot),
      s: Math.sin(rot),
      feather: Math.max(0.006, f.soft),
      ring: Math.min(0.9, (f.border * sc * k) / Math.max(1e-6, Math.min(hw, hh))), // outline thickness in shape units
      ringTone: f.borderTone ?? 1,
      blend: BLEND_ID[f.blend] ?? 0,
      bright: f.brightness || 0,
      contr: f.contrast ?? 1,
      flx: f.flipX ? -1 : 1,
      fly: f.flipY ? -1 : 1,
      op: f.opacity,
      invert: f.invert,
      sx: (0.5 * fw) / z,
      sy: (0.5 * fh) / z,
      ox: 0.5 + f.panX * 0.5 * (1 - fw / z),
      oy: 0.5 + f.panY * 0.5 * (1 - fh / z),
    }
  })

  return (qx, qy, val) => {
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i]
      const dx = qx - f.cx
      const dy = qy - f.cy
      if (dx * dx + dy * dy > f.r2) continue
      const u = (dx * f.c + dy * f.s) / f.hw
      const v = (-dx * f.s + dy * f.c) / f.hh
      const d = shapeDist(f.shape, u, v)
      if (d >= 1) continue
      const t = Math.min(1, (1 - d) / f.feather)
      const a = t * t * (3 - 2 * t) * f.op
      let fv = sampleGray(f.src, f.ox + u * f.flx * f.sx, f.oy + v * f.fly * f.sy)
      if (f.invert) fv = 1 - fv
      fv = (fv - 0.5) * f.contr + 0.5 + f.bright
      fv = fv < 0 ? 0 : fv > 1 ? 1 : fv
      if (f.ring > 0) {
        const m = Math.min(1, Math.max(0, (d - (1 - f.ring)) / 0.012))
        fv += (f.ringTone - fv) * m
      }
      let out
      switch (f.blend) {
        case 1: out = val + fv; break
        case 2: out = 1 - (1 - val) * (1 - fv); break
        case 3: out = Math.max(val, fv); break
        case 4: out = Math.min(val, fv); break
        case 5: out = val * fv; break
        case 6: out = Math.abs(val - fv); break
        default: out = fv
      }
      val += (out - val) * a
    }
    return val
  }
}
