// Which kind of input the user has right now: 'touch' (finger), 'pen' or 'mouse' (mouse / trackpad).
//
// The first guess comes from the device (a coarse pointer = a finger), then it follows what the user really uses:
// every pointer event updates it, so a laptop with a touch screen or a tablet with a keyboard switches by itself.
// It is written to <html data-input="…"> so the CSS can adapt (bigger targets, gesture help instead of shortcuts).

const root = document.documentElement
const listeners = new Set()
let type = window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse'
root.dataset.input = type

function set(next) {
  if (next === type) return
  type = next
  root.dataset.input = next
  listeners.forEach((fn) => fn(next))
}

// Capture phase so it sees the event before anything stops it. 'pen' behaves like a mouse for layout purposes.
window.addEventListener(
  'pointerdown',
  (e) => set(e.pointerType === 'touch' ? 'touch' : 'mouse'),
  { capture: true, passive: true },
)
window.addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType === 'mouse') set('mouse') // a hovering mouse means the pointer is not a finger
  },
  { capture: true, passive: true },
)

export const inputType = () => type
export const isTouch = () => type === 'touch'
/** fn(type) runs when the kind of input changes. Returns an unsubscribe function. */
export const onInputChange = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
