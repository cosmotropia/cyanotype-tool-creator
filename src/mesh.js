// Geometry containers shared by the procedural generators.
//
// Generators emit three kinds of primitives, which the 2D renderer (render2d.js) draws with additive light:
//   strips : polylines with per-point brightness and width multiplier (filaments, ribs, bones)
//   dots   : soft glowing points (beads, pores, joints)
//   sheets : translucent tissue grids (petal membranes, glass bell)

export class MeshBuilder {
  constructor() {
    this.strips = []
    this.dots = []
    this.sheets = []
  }
}

export function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// Two unit vectors perpendicular to tangent t (and to each other).
export function perpFrame(t, hint = [0, 0, 1]) {
  let e1 = cross3(t, hint)
  if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-4) e1 = cross3(t, [1, 0, 0])
  e1 = normalize3(e1[0], e1[1], e1[2])
  const e2 = normalize3(...cross3(t, e1))
  return [e1, e2]
}

// Polyline. pts: [[x,y,z]...], bright/wm: per-point arrays or constants.
export function addStrip(mesh, pts, bright, wm, rnd) {
  if (pts.length < 2) return
  mesh.strips.push({
    pts,
    br: Array.isArray(bright) ? bright : pts.map(() => bright),
    wm: Array.isArray(wm) ? wm : pts.map(() => wm),
    rnd,
  })
}

// Soft glowing dot.
export function addDot(mesh, p, bright, size, rnd) {
  mesh.dots.push({ p, br: bright, size, rnd })
}

// Translucent sheet from a (rows+1) x cols grid of points. uvFn(c, r) -> [u, v]; fade(c, r) -> brightness.
export function addGridSheet(mesh, grid, cols, rows, uvFn, fade) {
  const uv = []
  const fades = []
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      uv.push(uvFn(c, r))
      fades.push(fade(c, r))
    }
  }
  mesh.sheets.push({ grid, cols, rows, uv, fade: fades })
}

// Collects the bounding box + points of a generator so it can report centre and radius.
export class Bounds {
  constructor() {
    this.lo = [Infinity, Infinity, Infinity]
    this.hi = [-Infinity, -Infinity, -Infinity]
    this.pts = []
  }

  track(pt) {
    for (let a = 0; a < 3; a++) {
      if (pt[a] < this.lo[a]) this.lo[a] = pt[a]
      if (pt[a] > this.hi[a]) this.hi[a] = pt[a]
    }
    this.pts.push(pt)
    return pt
  }

  result() {
    const center = this.pts.length ? [0, 1, 2].map((a) => (this.lo[a] + this.hi[a]) / 2) : [0, 0, 0]
    let radius = 1
    for (const pt of this.pts) {
      radius = Math.max(radius, Math.hypot(pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]))
    }
    const half = this.pts.length ? [0, 1, 2].map((a) => (this.hi[a] - this.lo[a]) / 2) : [1, 1, 1]
    return { center, radius, half }
  }
}
