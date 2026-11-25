// Crop dialog for pictures: the main pictures (A and B) and the pictures cut into shapes.
//
// openCrop({ src, title, aspects, note, name }) -> Promise of
//   null                       the dialog was closed without applying,
//   a source                   the cropped picture, remembering `orig` (the uncropped picture) and `cropRect`,
//                              so the next crop starts from the original and can widen the selection again,
//   the original source        when the selection covers the whole picture (= crop removed).
// "Save PNG" downloads exactly the selected area; "Apply crop" uses it in the project.

const MIN = 8 // smallest selection, in picture pixels
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const RATIOS = [
  ['Free', null],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
]

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k === 'text') e.textContent = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v)
  }
  for (const c of [].concat(children)) if (c) e.append(c)
  return e
}

// Gray floats (0..1) -> RGBA pixels of the area (x0, y0, cw, ch).
function paintGray(ctx, gray, W, x0, y0, cw, ch) {
  const img = ctx.createImageData(cw, ch)
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const v = Math.round(clamp(gray[(y0 + j) * W + x0 + i], 0, 1) * 255)
      const o = (j * cw + i) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

export function openCrop({ src, title, aspects = [], note = '', name = 'picture' }) {
  const base = src.orig || src // always crop from the uncropped picture
  const W = base.w
  const H = base.h
  const full = { x: 0, y: 0, w: W, h: H }
  let rect = src.cropRect ? { x: src.cropRect.x * W, y: src.cropRect.y * H, w: src.cropRect.w * W, h: src.cropRect.h * H } : { ...full }
  let ratio = null // width / height, or null = free
  let k = 1 // screen px per picture px
  let drag = null
  let savedMsg = ''
  let savedTimer = 0
  const previousFocus = document.activeElement

  // ---- picture + selection box ----
  const canvas = el('canvas', { class: 'cropimg', width: W, height: H })
  paintGray(canvas.getContext('2d'), base.gray, W, 0, 0, W, H)
  const box = el('div', { class: 'cropbox', tabindex: '0', 'aria-label': 'Crop selection' }, HANDLES.map((h) => el('i', { class: `handle ${h}`, 'data-h': h })))
  const stage = el('div', { class: 'cropstage' }, [canvas, box])
  const work = el('div', { class: 'cropwork' }, [stage])
  const info = el('div', { class: 'cropinfo', 'aria-live': 'polite' })

  const ints = () => {
    const x0 = clamp(Math.round(rect.x), 0, W - 1)
    const y0 = clamp(Math.round(rect.y), 0, H - 1)
    const x1 = clamp(Math.round(rect.x + rect.w), x0 + 1, W)
    const y1 = clamp(Math.round(rect.y + rect.h), y0 + 1, H)
    return { x0, y0, cw: x1 - x0, ch: y1 - y0 }
  }

  function render() {
    box.style.left = `${rect.x * k}px`
    box.style.top = `${rect.y * k}px`
    box.style.width = `${rect.w * k}px`
    box.style.height = `${rect.h * k}px`
    const { cw, ch } = ints()
    info.textContent = savedMsg || `Selection: ${cw} × ${ch} px`
  }

  function layout() {
    const maxW = Math.max(160, Math.min(window.innerWidth - 80, 860))
    const maxH = Math.max(140, window.innerHeight - 420) // room left for the title, ratio chips, hints and buttons
    k = Math.min(1.5, maxW / W, maxH / H)
    stage.style.width = `${Math.round(W * k)}px`
    stage.style.height = `${Math.round(H * k)}px`
    render()
  }

  // ---- geometry ----
  // Rectangle spanned between a fixed corner and the pointer (can flip over the corner), optionally with a fixed ratio.
  function fromAnchor(ax, ay, px, py) {
    const sx = px < ax ? -1 : 1
    const sy = py < ay ? -1 : 1
    const roomX = sx > 0 ? W - ax : ax
    const roomY = sy > 0 ? H - ay : ay
    let w = Math.min(Math.abs(px - ax), roomX)
    let h = Math.min(Math.abs(py - ay), roomY)
    if (ratio) {
      w = Math.min(Math.max(w, h * ratio), roomX, roomY * ratio)
      w = Math.max(w, MIN * Math.max(1, ratio))
      h = w / ratio
    } else {
      w = Math.max(w, MIN)
      h = Math.max(h, MIN)
    }
    return { x: clamp(sx > 0 ? ax : ax - w, 0, Math.max(0, W - w)), y: clamp(sy > 0 ? ay : ay - h, 0, Math.max(0, H - h)), w, h }
  }

  // One side moved with the pointer; the opposite side stays. With a fixed ratio the other axis follows around its centre.
  function fromEdge(h, px, py, s) {
    const cx = s.x + s.w / 2
    const cy = s.y + s.h / 2
    let { x, y, w, h: hh } = { ...s, h: s.h }
    if (h === 'e' || h === 'w') {
      const right = s.x + s.w
      w = h === 'e' ? px - s.x : right - px
      w = clamp(w, MIN, h === 'e' ? W - s.x : right)
      if (ratio) {
        w = Math.min(w, 2 * Math.min(cy, H - cy) * ratio)
        hh = w / ratio
        y = cy - hh / 2
      }
      x = h === 'e' ? s.x : right - w
    } else {
      const bottom = s.y + s.h
      hh = h === 's' ? py - s.y : bottom - py
      hh = clamp(hh, MIN, h === 's' ? H - s.y : bottom)
      if (ratio) {
        hh = Math.min(hh, (2 * Math.min(cx, W - cx)) / ratio)
        w = hh * ratio
        x = cx - w / 2
      }
      y = h === 's' ? s.y : bottom - hh
    }
    return { x: clamp(x, 0, Math.max(0, W - w)), y: clamp(y, 0, Math.max(0, H - hh)), w, h: hh }
  }

  // Picks a new ratio: the biggest selection of that ratio that fits inside the current one, around the same centre.
  function setRatio(r) {
    ratio = r
    if (r) {
      const w = Math.max(MIN * Math.max(1, r), Math.min(rect.w, rect.h * r))
      const h = w / r
      const cx = rect.x + rect.w / 2
      const cy = rect.y + rect.h / 2
      rect = { x: clamp(cx - w / 2, 0, Math.max(0, W - w)), y: clamp(cy - h / 2, 0, Math.max(0, H - h)), w, h }
    }
    aspectBtns.forEach(([btn, v]) => btn.classList.toggle('on', v === r))
    render()
  }

  // ---- pointer ----
  const pos = (e) => {
    const r = stage.getBoundingClientRect()
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]
  }
  stage.addEventListener('pointerdown', (e) => {
    const [px, py] = pos(e)
    const h = e.target.dataset?.h || (e.target === box ? 'move' : null)
    if (h === 'move') drag = { h, px, py, start: { ...rect } }
    else if (h) drag = { h, start: { ...rect } }
    else drag = { h: 'new', ax: clamp(px, 0, W), ay: clamp(py, 0, H) } // dragging on the picture draws a fresh selection
    stage.setPointerCapture(e.pointerId)
    e.preventDefault()
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    const [px, py] = pos(e)
    const s = drag.start
    if (drag.h === 'new') rect = fromAnchor(drag.ax, drag.ay, px, py)
    else if (drag.h === 'move') rect = { ...s, x: clamp(s.x + px - drag.px, 0, W - s.w), y: clamp(s.y + py - drag.py, 0, H - s.h) }
    else if (drag.h.length === 2) {
      // corner: the opposite corner is the anchor
      const ax = drag.h.includes('w') ? s.x + s.w : s.x
      const ay = drag.h.includes('n') ? s.y + s.h : s.y
      rect = fromAnchor(ax, ay, px, py)
    } else rect = fromEdge(drag.h, px, py, s)
    savedMsg = ''
    render()
  })
  const endDrag = () => (drag = null)
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

  // ---- result ----
  function applied() {
    const { x0, y0, cw, ch } = ints()
    if (cw === W && ch === H) return base // whole picture = no crop
    const gray = new Float32Array(cw * ch)
    for (let j = 0; j < ch; j++) gray.set(base.gray.subarray((y0 + j) * W + x0, (y0 + j) * W + x0 + cw), j * cw)
    return { gray, w: cw, h: ch, label: base.label, orig: base, cropRect: { x: x0 / W, y: y0 / H, w: cw / W, h: ch / H } }
  }

  function savePng() {
    const { x0, y0, cw, ch } = ints()
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    paintGray(c.getContext('2d'), base.gray, W, x0, y0, cw, ch)
    const file = `${String(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 48) || 'picture'}-crop-${cw}x${ch}.png`
    c.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = el('a', { href: url, download: file })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      savedMsg = `PNG saved · ${file}`
      render()
      clearTimeout(savedTimer)
      savedTimer = setTimeout(() => {
        savedMsg = ''
        render()
      }, 4000)
    }, 'image/png')
  }

  // ---- dialog chrome ----
  const aspectBtns = [...RATIOS, ...aspects.map(([label, r, hint]) => [label, r, hint])].map(([label, r, hint]) => [
    el('button', { type: 'button', text: label, title: hint || label, onclick: () => setRatio(r) }),
    r,
  ])
  aspectBtns[0][0].classList.add('on')

  const applyBtn = el('button', { type: 'button', class: 'primary', text: 'Apply crop', onclick: () => finish(applied()) })
  const closeBtn = el('button', { type: 'button', class: 'cropclose', 'aria-label': 'Close', text: '×', onclick: () => finish(null) })
  const card = el('div', { class: 'cropcard' }, [
    el('header', {}, [el('h2', { class: 'croptitle', text: title }), closeBtn]),
    el('div', { class: 'cropaspects', role: 'group', 'aria-label': 'Proportions' }, aspectBtns.map(([b]) => b)),
    work,
    info,
    el('div', { class: 'hint', text: 'Drag on the picture to draw a new selection, drag the box to move it, drag the handles to resize. Arrow keys nudge it, Esc closes.' }),
    src.orig ? el('div', { class: 'hint', text: 'This picture was cropped before: the original is shown, so you can widen the selection again.' }) : null,
    el('div', { class: 'hint', text: 'Pictures are kept in grayscale (what the cyanotype uses), so the saved PNG is grayscale too.' }),
    note ? el('div', { class: 'hint', 'data-kind': 'warn', text: note }) : null,
    el('div', { class: 'cropfoot' }, [
      el('div', { class: 'row2 tight wrap' }, [
        el('button', { type: 'button', text: 'Reset selection', onclick: () => { rect = { ...full }; setRatio(ratio) } }),
        el('button', { type: 'button', text: 'Save PNG', title: 'Download the selected area as a PNG', onclick: savePng }),
      ]),
      el('div', { class: 'row2 tight wrap' }, [el('button', { type: 'button', text: 'Cancel', onclick: () => finish(null) }), applyBtn]),
    ]),
  ])
  const overlay = el('div', { class: 'cropmodal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [card])
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) finish(null) // click outside the card
  })

  // While open, the dialog owns the keyboard: the app's shortcuts (R, E, H, ⌘Z…) must not fire behind it.
  const onKey = (e) => {
    e.stopImmediatePropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      return finish(null)
    }
    if (e.key === 'Tab') {
      const items = [...card.querySelectorAll('button, [tabindex="0"]')].filter((n) => !n.disabled)
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (!card.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
      return
    }
    const step = e.shiftKey ? 10 : 1
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d && document.activeElement === box) {
      e.preventDefault()
      rect = { ...rect, x: clamp(rect.x + d[0], 0, W - rect.w), y: clamp(rect.y + d[1], 0, H - rect.h) }
      render()
    }
  }

  let done = null
  const result = new Promise((resolve) => (done = resolve))
  function finish(value) {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', layout)
    clearTimeout(savedTimer)
    overlay.remove()
    previousFocus?.focus?.()
    done(value)
  }

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', layout)
  document.body.append(overlay)
  layout()
  setRatio(null)
  applyBtn.focus()
  return result
}
