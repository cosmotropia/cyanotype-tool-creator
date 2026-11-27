// Multi-touch gestures for the preview, the classic ones of Photoshop Express, Procreate, Canva and Figma:
//
//   two fingers pinch / spread ........ resize (the selected shape, or zoom the picture)
//   two fingers twist ................. rotate (with a small dead zone so a pinch does not turn by accident,
//                                       and a soft snap at 0° / 45° / 90°…)
//   two fingers drag together ......... move (the selected shape, or the picture)
//   double tap ........................ reset (a shape's size and turn, or the picture's zoom and position)
//   two-finger tap .................... undo        three-finger tap ........ redo
//
// This file only recognises the gestures from touch pointers; main.js decides what each one changes.
// One finger is left alone: it keeps working as before (move a shape, orbit / parallax the picture).

const TAP_MS = 320 // a tap is quick…
const TAP_SLOP = 10 // …and the fingers hardly move (px)
const DOUBLE_TAP_PX = 28 // two taps this close count as a double tap
const ROTATE_DEAD_ZONE = 6 // degrees of twist ignored until the user clearly turns

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x)
const wrap = (r) => Math.atan2(Math.sin(r), Math.cos(r)) // to (-π, π]

/**
 * el: the element to listen on.
 * h: {
 *   onStart({ x, y }),                      two fingers landed (x, y = their centre, in client px)
 *   onMove({ scale, rotation, dx, dy, x, y }) scale: ratio since the start · rotation: degrees since the start
 *                                            dx, dy: how far the centre moved (px) · x, y: the centre now
 *   onEnd(),                                the gesture finished
 *   onTwoFingerTap(), onThreeFingerTap(),   quick taps with 2 / 3 fingers
 *   onDoubleTap({ x, y }),                  two quick taps with one finger
 * }
 * Returns { active(), fingers() }: active() is true while two (or more) fingers are down, so one-finger code can step aside.
 */
export function createGestures(el, h) {
  const pts = new Map() // pointerId -> { x, y, x0, y0 }
  let g = null // the running two-finger gesture
  let tap = null // candidate for a tap: { t, maxN, moved }
  let lastTap = null // the previous one-finger tap, for the double tap
  let multi = false // more than two fingers touched during this touch: no pinch, only taps

  const two = () => [...pts.values()].slice(0, 2)
  const centre = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  function startGesture() {
    const [a, b] = two()
    const c = centre([a, b])
    g = { d0: Math.max(1, dist(a, b)), a: angle(a, b), rot: 0, turned: false, c0: c, moved: false }
    h.onStart?.(c)
  }
  function endGesture() {
    if (!g) return
    g = null
    h.onEnd?.()
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY })
    const n = pts.size
    if (n === 1) {
      multi = false
      tap = { t: performance.now(), maxN: 1, moved: false }
    } else if (tap) {
      tap.maxN = Math.max(tap.maxN, n)
    }
    if (n === 2 && !multi) startGesture()
    else if (n > 2) {
      multi = true
      endGesture()
    }
  })

  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (tap && !tap.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_SLOP) tap.moved = true
    if (!g || pts.size !== 2) return
    const [a, b] = two()
    const c = centre([a, b])
    // Twist: add up the small changes so turning past ±180° does not jump.
    const ang = angle(a, b)
    g.rot += wrap(ang - g.a)
    g.a = ang
    let deg = (g.rot * 180) / Math.PI
    if (!g.turned && Math.abs(deg) >= ROTATE_DEAD_ZONE) g.turned = true
    if (!g.turned) deg = 0 // once past the dead zone the turn follows the fingers exactly
    const moved = Math.hypot(c.x - g.c0.x, c.y - g.c0.y) > TAP_SLOP || Math.abs(dist(a, b) / g.d0 - 1) > 0.04 || g.turned
    if (moved) g.moved = true
    h.onMove?.({ scale: dist(a, b) / g.d0, rotation: deg, dx: c.x - g.c0.x, dy: c.y - g.c0.y, x: c.x, y: c.y })
  })

  function up(e) {
    if (e.pointerType !== 'touch') return
    const p = pts.get(e.pointerId)
    if (!p) return
    pts.delete(e.pointerId)
    if (pts.size < 2) endGesture()
    if (pts.size > 0 || !tap) return
    // The last finger left: was it a tap?
    const quick = performance.now() - tap.t < TAP_MS && !tap.moved && e.type === 'pointerup'
    const { maxN } = tap
    tap = null
    if (!quick) {
      lastTap = null
      return
    }
    if (maxN === 2) {
      lastTap = null
      h.onTwoFingerTap?.()
    } else if (maxN >= 3) {
      lastTap = null
      h.onThreeFingerTap?.()
    } else {
      const now = performance.now()
      if (lastTap && now - lastTap.t < TAP_MS + 80 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_PX) {
        lastTap = null
        h.onDoubleTap?.({ x: p.x, y: p.y })
      } else {
        lastTap = { t: now, x: p.x, y: p.y }
      }
    }
  }
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)

  return { active: () => pts.size >= 2, fingers: () => pts.size }
}
