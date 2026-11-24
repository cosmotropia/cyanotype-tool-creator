import { mat4, clamp } from './math.js'

const DEG = Math.PI / 180

// Perspective camera for the 3D code generators (static: no animation, just the chosen angles).
export function buildView(structure, params, W, H) {
  const R = structure.radius
  const D = (R * 3.4) / params.perspective

  // Fit the figure's footprint to the frame (tall subjects fill portrait canvases),
  // never looser than the bounding sphere.
  const aspect = W / H
  const [hx, hy, hz] = structure.half
  const needW = Math.hypot(hx, hz) * 1.08
  const needH = hy * 1.08
  const fit = W >= H ? Math.max(needH, needW / aspect) : Math.max(needW, needH * aspect)
  const extent = clamp(fit, R * 0.5, R * 1.06) / params.zoom
  const tanHalf = extent / D
  const near = Math.max(D * 0.04, D - R * 2.2)
  const far = D + R * 2.4

  const mv = [
    mat4.translation(0, 0, -D),
    mat4.rotationY(params.yaw * DEG),
    mat4.rotationX(-params.pitch * DEG),
    mat4.rotationZ(params.spin * DEG),
    mat4.translation(-structure.center[0], -structure.center[1], -structure.center[2]),
  ].reduce((acc, m) => mat4.multiply(acc, m))

  let halfW
  let halfH
  if (W >= H) {
    halfH = near * tanHalf
    halfW = halfH * (W / H)
  } else {
    halfW = near * tanHalf
    halfH = halfW * (H / W)
  }
  return { mv, near, far, halfW, halfH, D, R }
}

// Returns f(pt) -> [screenX, screenY, viewZ] for a W x H image.
export function makeProjector(view, W, H) {
  const m = view.mv
  return (pt) => {
    const x = m[0] * pt[0] + m[4] * pt[1] + m[8] * pt[2] + m[12]
    const y = m[1] * pt[0] + m[5] * pt[1] + m[9] * pt[2] + m[13]
    const z = m[2] * pt[0] + m[6] * pt[1] + m[10] * pt[2] + m[14]
    const iz = Math.max(1e-3, -z)
    const nx = (view.near * x) / (view.halfW * iz)
    const ny = (view.near * y) / (view.halfH * iz)
    return [(nx * 0.5 + 0.5) * W, (0.5 - ny * 0.5) * H, z, x, y]
  }
}
