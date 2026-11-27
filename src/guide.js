// Selection guide for the shape (overlay) being edited on the preview, like the one in Canva or Figma:
//   - a box around the shape (it turns with the shape) with 8 handles and a rotate handle on a stem,
//   - corner handle: resize in proportion · Shift: free (stretch both sides) · Alt: from the centre,
//   - side handle: stretch one side only (turns a circle into an oval, a square into a rectangle) · Alt: from the centre,
//   - rotate handle: turn the shape · Shift: 15° steps.
// Moving the shape is done by dragging it on the preview (main.js). The guide is plain DOM laid over the canvas.
//
// Geometry: a shape is { x, y, w, h, scale, rot } in cm from the centre of the print (y down); its drawn size is
// w × scale by h × scale. It turns by `rot` degrees (clockwise on screen), exactly as frames.js draws and hit-tests it.

const HANDLES = [
  ['nw', -1, -1],
  ['n', 0, -1],
  ['ne', 1, -1],
  ['e', 1, 0],
  ['se', 1, 1],
  ['s', 0, 1],
  ['sw', -1, 1],
  ['w', -1, 0],
]
const MIN_CM = 0.4 // smallest side
const ROT_OFFSET = 30 // px between the box and the rotate handle

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const r2 = (v) => Math.round(v * 100) / 100
const el = (tag, cls, attrs = {}) => Object.assign(Object.assign(document.createElement(tag), { className: cls }), attrs)

// Resize cursor that matches the handle's real direction on screen (the box can be rotated).
function cursorFor(hx, hy, rot) {
  const a = (((Math.atan2(hy, hx) * 180) / Math.PI + rot) % 180 + 180) % 180
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(a / 45) % 4]
}

/**
 * stage: element the canvas lives in · canvas: the preview canvas · params: the project (printW, printH)
 * frame(): the shape to show the guide for, or null · onChange(): called while the shape changes (redraw, sync sliders)
 * onStart() / onEnd(): a drag began / finished (history, cursor…)
 */
export function createGuide({ stage, canvas, params, frame, onChange, onStart, onEnd }) {
  const root = el('div', 'guide', { hidden: true })
  const box = el('div', 'gbox')
  const tip = el('div', 'gtip', { hidden: true })
  const stem = el('i', 'gstem')
  const handles = HANDLES.map(([id, hx, hy]) => {
    const h = el('i', `gh gh-${id}`)
    h.dataset.h = id
    h.style.left = `${(hx + 1) * 50}%`
    h.style.top = `${(hy + 1) * 50}%`
    h.title =
      hx && hy
        ? 'Drag to resize in proportion (Shift: free · Alt: from the centre)'
        : 'Drag to stretch this side (Alt: from the centre)'
    return { id, hx, hy, node: h }
  })
  const rotate = el('i', 'gh grot', { title: 'Drag to rotate (Shift: 15° steps)' })
  box.append(stem, ...handles.map((h) => h.node), rotate)
  root.append(box, tip)
  stage.append(root)

  let visible = false
  let drag = null

  /** Place the guide over the canvas and the box over the shape. Cheap: call it whenever the shape or the canvas changed. */
  function update() {
    const f = visible ? frame() : null
    root.hidden = !f
    if (!f) return
    const sr = stage.getBoundingClientRect()
    const cr = canvas.getBoundingClientRect()
    root.style.left = `${cr.left - sr.left}px`
    root.style.top = `${cr.top - sr.top}px`
    root.style.width = `${cr.width}px`
    root.style.height = `${cr.height}px`
    const kpx = cr.height / params.printH // px per cm
    const sc = f.scale || 1
    const W = f.w * sc * kpx
    const H = f.h * sc * kpx
    const cx = cr.width / 2 + f.x * kpx
    const cy = cr.height / 2 + f.y * kpx
    Object.assign(box.style, {
      left: `${cx - W / 2}px`,
      top: `${cy - H / 2}px`,
      width: `${W}px`,
      height: `${H}px`,
      transform: `rotate(${f.rot}deg)`,
    })
    for (const h of handles) h.node.style.cursor = cursorFor(h.hx, h.hy, f.rot)
    if (drag || !tip.hidden) {
      const a = (f.rot * Math.PI) / 180
      const ext = Math.abs((W / 2) * Math.sin(a)) + Math.abs((H / 2) * Math.cos(a)) // half the height of the turned box
      tip.style.left = `${clamp(cx, 40, cr.width - 40)}px`
      tip.style.top = `${clamp(cy + ext + ROT_OFFSET, 10, cr.height - 24)}px`
    }
  }

  function setVisible(on) {
    visible = on
    update()
  }

  function pointerCm(e) {
    return [(e.clientX - drag.cr.left - drag.cr.width / 2) * drag.kcm, (e.clientY - drag.cr.top - drag.cr.height / 2) * drag.kcm]
  }

  function begin(e, kind, hx = 0, hy = 0) {
    const f = frame()
    if (!f || e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    const cr = canvas.getBoundingClientRect()
    const sc = f.scale || 1
    drag = { kind, hx, hy, f, cr, kcm: params.printH / cr.height, x: f.x, y: f.y, W: f.w * sc, H: f.h * sc, sc, rot: f.rot, a0: 0 }
    if (kind === 'rotate') {
      const [px, py] = pointerCm(e)
      drag.a0 = Math.atan2(py - f.y, px - f.x)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    onStart?.()
  }

  function move(e) {
    if (!drag) return
    const { f, kind, hx, hy } = drag
    const [px, py] = pointerCm(e)

    if (kind === 'rotate') {
      let deg = drag.rot + (((Math.atan2(py - drag.y, px - drag.x) - drag.a0) * 180) / Math.PI)
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      deg = ((((deg + 180) % 360) + 360) % 360) - 180
      f.rot = Math.round(deg * 10) / 10
      showTip(`${f.rot}°`)
    } else {
      // Work in the shape's own axes (ex along its width, ey along its height) so a turned shape resizes along its sides.
      const a = (drag.rot * Math.PI) / 180
      const ex = [Math.cos(a), Math.sin(a)]
      const ey = [-Math.sin(a), Math.cos(a)]
      const sym = e.altKey // resize from the centre: the opposite side moves the other way
      const { W: W0, H: H0 } = drag
      const maxCm = Math.max(params.printW, params.printH) * 3
      // The point that stays still: the opposite corner / side, or the centre with Alt.
      const A = sym ? [drag.x, drag.y] : [drag.x - ex[0] * ((hx * W0) / 2) - ey[0] * ((hy * H0) / 2), drag.y - ex[1] * ((hx * W0) / 2) - ey[1] * ((hy * H0) / 2)]
      const dx = (px - A[0]) * ex[0] + (py - A[1]) * ex[1] // pointer from the fixed point, in the shape's axes
      const dy = (px - A[0]) * ey[0] + (py - A[1]) * ey[1]
      // From the centre the pointer only covers half of the shape, so the size is twice the distance to the centre.
      const m = sym ? 2 : 1
      let W = W0
      let H = H0
      if (hx && hy && !e.shiftKey) {
        // corner: in proportion. Follow the pointer along the diagonal.
        const s = clamp((m * (dx * hx * W0 + dy * hy * H0)) / (W0 * W0 + H0 * H0), MIN_CM / Math.min(W0, H0), maxCm / Math.max(W0, H0))
        W = W0 * s
        H = H0 * s
      } else {
        if (hx) W = clamp(dx * hx * m, MIN_CM, maxCm)
        if (hy) H = clamp(dy * hy * m, MIN_CM, maxCm)
      }
      const cx = sym ? drag.x : A[0] + ex[0] * ((hx * W) / 2) + ey[0] * ((hy * H) / 2)
      const cy = sym ? drag.y : A[1] + ex[1] * ((hx * W) / 2) + ey[1] * ((hy * H) / 2)
      f.x = r2(clamp(cx, -params.printW, params.printW))
      f.y = r2(clamp(cy, -params.printH, params.printH))
      f.w = Math.max(0.2, r2(W / drag.sc))
      f.h = Math.max(0.2, r2(H / drag.sc))
      showTip(`${r2(W)} × ${r2(H)} cm`)
    }
    onChange?.()
    update()
  }

  function showTip(text) {
    tip.hidden = false
    tip.textContent = text
  }

  function end() {
    if (!drag) return
    drag = null
    tip.hidden = true
    onEnd?.()
  }

  for (const h of handles) {
    h.node.addEventListener('pointerdown', (e) => begin(e, 'resize', h.hx, h.hy))
    h.node.addEventListener('pointermove', move)
    h.node.addEventListener('pointerup', end)
    h.node.addEventListener('pointercancel', end)
  }
  rotate.addEventListener('pointerdown', (e) => begin(e, 'rotate'))
  rotate.addEventListener('pointermove', move)
  rotate.addEventListener('pointerup', end)
  rotate.addEventListener('pointercancel', end)

  /** Show the live size / angle label (used by the two-finger gestures, which do not drag a handle). */
  function hint(text) {
    showTip(text)
    update()
  }
  function hideHint() {
    if (!drag) tip.hidden = true
  }

  return { update, setVisible, isVisible: () => visible, dragging: () => !!drag, hint, hideHint }
}
