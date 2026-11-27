// Panel for the overlay photos (see frames.js): add one, pick a shape, give it a picture, then pick it in the list
// to edit it. The controls of the selected overlay appear right below the list, grouped:
// picture · size · look (opacity, mixing, tone: all independent of the picture below) · position · shape & edges.

import { FRAME_SHAPES, FRAME_LAYOUTS, BLEND_MODES, frameImages } from './frames.js'
import { thumbUrl, isUploadableImage } from './source.js'

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

const thumbCache = new WeakMap() // source -> data url
const shapeName = (f) => (FRAME_SHAPES.find(([v]) => v === f.shape) || [])[1] || f.shape
const subtitleOf = (f) => {
  const base = f.fill === 'solid' ? 'Solid tone' : frameImages.has(f.id) ? 'Photo' : 'No picture yet'
  return f.visible === false ? `${base} · hidden` : base
}

// One filled silhouette per shape (24 × 24, static markup), used by the pickers and the layer list.
const SHAPE_PATHS = {
  circle: '<circle cx="12" cy="12" r="9"/>',
  rect: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
  rounded: '<rect x="4" y="4" width="16" height="16" rx="5"/>',
  triangle: '<path d="M12 4 21.5 20h-19z"/>',
  diamond: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
  hexagon: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/>',
  star: '<path d="M12 2.8l2.8 6 6.5.7-4.8 4.5 1.3 6.5L12 17.2 6.2 20.5l1.3-6.5L2.7 9.5l6.5-.7z"/>',
  arch: '<path d="M5 21V11a7 7 0 0 1 14 0v10z"/>',
}
export function shapeIcon(id) {
  const s = document.createElement('span')
  s.className = 'shapeico'
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">${SHAPE_PATHS[id] || SHAPE_PATHS.circle}</svg>`
  return s
}
const EYE = '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
const EYE_OFF = '<path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.6 6.9C4 8.7 2 12 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
const svgIcon = (inner) => {
  const s = document.createElement('span')
  s.className = 'ico'
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
  return s
}

/** A row of shape tiles (icons). onPick(shapeId) runs when one is clicked; .set(id) marks the current one. */
function shapePicker(label, onPick) {
  const tiles = FRAME_SHAPES.map(([v, t]) =>
    el('button', { type: 'button', class: 'shapetile', 'data-shape': v, title: t, 'aria-label': t, onclick: () => onPick(v) }, [shapeIcon(v)]),
  )
  const node = el('div', { class: 'shapegrid', role: 'group', 'aria-label': label }, tiles)
  node.set = (id) =>
    tiles.forEach((b) => {
      const on = b.dataset.shape === id
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
  return node
}
const toneCss = (t) => {
  const v = Math.round(Math.min(1, Math.max(0, t)) * 255)
  return `rgb(${v}, ${v}, ${v})`
}
const heading = (text) => el('div', { class: 'framegroup', text })

function thumbFor(f) {
  const src = frameImages.get(f.id)
  if (!src) return null
  if (!thumbCache.has(src)) thumbCache.set(src, thumbUrl(src))
  return thumbCache.get(src)
}

/**
 * h: { onChange(), onAdd(shape), onLayout(name), onClear(), onRemove(id), onDuplicate(id), onImage(id, action, file) }
 * Overlays are read from and written to params.frames.
 */
export function createFramesPanel(params, h) {
  let selected = null // id of the overlay being edited
  let syncers = [] // refresh the editor's sliders after the overlay changed from outside (dragging it on the preview)
  const unlocked = new Set() // overlays whose width and height move independently (the rest keep their proportions)

  const list = el('div', { class: 'frameitems' })
  const editor = el('div', { class: 'frameeditor' })
  // "Add" row: clicking a shape adds it right away (solid tone by default, or a photo shape if that is picked).
  // The shape of an existing one is changed in its own editor below, so each picker does exactly one thing.
  let addFill = 'solid'
  const addGrid = shapePicker('Add a shape', (shape) => h.onAdd(shape, addFill))
  const addModeBtns = [
    ['solid', 'Solid tone', 'A flat tone shape: no picture needed'],
    ['photo', 'Photo', 'A shape cut from a picture (give it one below)'],
  ].map(([v, label, title]) =>
    el('button', {
      type: 'button',
      class: 'seg' + (v === addFill ? ' on' : ''),
      'data-v': v,
      text: label,
      title,
      onclick() {
        addFill = v
        addModeBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === v))
      },
    }),
  )
  const layoutSel = el('select', { 'aria-label': 'Ready-made layouts' }, [el('option', { value: '', text: 'Ready-made layouts…' })].concat(
    Object.keys(FRAME_LAYOUTS).map((n) => el('option', { value: n, text: n })),
  ))
  layoutSel.addEventListener('change', () => {
    if (layoutSel.value) h.onLayout(layoutSel.value)
    layoutSel.value = ''
  })
  const clearBtn = el('button', { type: 'button', text: 'Remove all overlays', onclick: () => h.onClear() })

  const listCount = el('span', { class: 'count' })
  const listHead = el('div', { class: 'shapehead' }, [el('span', { text: 'Your shapes' }), listCount])
  const root = el('div', { class: 'block flat framesblock' }, [
    el('div', { class: 'shapehead first' }, [el('span', { text: 'Add a shape' })]),
    addGrid,
    el('div', { class: 'addmode' }, [el('span', { class: 'lbl', text: 'Fill' }), el('div', { class: 'segmented two', role: 'group', 'aria-label': 'Fill of the next shape' }, addModeBtns)]),
    layoutSel,
    listHead,
    list,
    editor,
    el('div', { class: 'row2' }, [clearBtn]),
  ])

  function slider(f, key, label, min, max, step, unit, extra) {
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
    const show = () => Number(f[key]).toFixed(dec)
    const range = el('input', { type: 'range', min, max, step, value: f[key], 'aria-label': label })
    const num = el('input', { type: 'number', class: 'valnum', min, max, step, value: show(), 'aria-label': label + ' value', title: 'Type a value and press Enter' })
    const set = (v) => {
      const old = f[key]
      f[key] = v
      extra?.(v, old)
      range.value = f[key]
      num.value = show()
      h.onChange()
    }
    range.addEventListener('input', () => set(parseFloat(range.value)))
    range.addEventListener('dblclick', () => set(DEFAULTS[key] ?? f[key]))
    num.addEventListener('change', () => {
      const v = parseFloat(num.value)
      if (!Number.isFinite(v)) return (num.value = show())
      set(Math.min(max, Math.max(min, v)))
    })
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') num.blur()
      if (e.key === 'Escape') num.value = show()
    })
    const node = el('label', { class: 'ctl', title: 'double-click the slider to reset' }, [
      el('span', { class: 'row' }, [el('span', { text: label }), el('span', { class: 'valwrap' }, [num, unit ? el('span', { class: 'unit', text: unit }) : null])]),
      range,
    ])
    node.sync = () => {
      range.value = f[key]
      num.value = show()
    }
    syncers.push(node.sync)
    return node
  }

  const DEFAULTS = { scale: 1, opacity: 1, brightness: 0, contrast: 1, soft: 0, border: 0, borderTone: 1, zoom: 1, panX: 0, panY: 0, rot: 0, x: 0, y: 0, tone: 1 }

  function toggle(f, key, label) {
    const cb = el('input', { type: 'checkbox' })
    cb.checked = !!f[key]
    cb.addEventListener('change', () => {
      f[key] = cb.checked
      h.onChange()
    })
    return el('label', { class: 'toggle' }, [cb, el('span', { text: label })])
  }

  // Controls of one overlay.
  function buildEditor(f, i, count) {
    syncers = []
    const src = frameImages.get(f.id)
    const thumb = el('img', { class: 'thumb', alt: `Overlay ${i + 1}`, width: 56, height: 56 })
    const url = thumbFor(f)
    if (url) thumb.src = url
    const file = el('input', { type: 'file', accept: 'image/*,.heic,.heif,image/heic,image/heif', hidden: '' })
    file.addEventListener('change', () => {
      if (file.files?.[0]) h.onImage(f.id, 'file', file.files[0])
      file.value = ''
    })
    const bgBtn = el('button', {
      type: 'button',
      text: 'Remove background',
      title: 'Remove the background of this picture and keep the subject: the shape updates in place (you can also save it as a transparent PNG)',
      onclick: () => h.onImage(f.id, 'bg'),
    })
    bgBtn.disabled = !src // needs a picture first
    const buttons = el('div', { class: 'row2 tight wrap' }, [
      el('button', { type: 'button', text: 'Upload', onclick: () => file.click() }),
      el('button', { type: 'button', text: 'Sample', onclick: () => h.onImage(f.id, 'sample') }),
      el('button', { type: 'button', text: 'Code', title: 'Snapshot of the code generator', onclick: () => h.onImage(f.id, 'code') }),
      bgBtn,
    ])
    const slot = el('div', { class: 'slot' }, [
      thumb,
      el('div', { class: 'slotcol' }, [el('span', { class: 'slotname', text: src ? src.label : 'No picture yet: upload one (or drop it here)' }), buttons]),
      file,
    ])
    slot.addEventListener('dragover', (e) => {
      e.preventDefault()
      slot.classList.add('drop')
    })
    slot.addEventListener('dragleave', () => slot.classList.remove('drop'))
    slot.addEventListener('drop', (e) => {
      e.preventDefault()
      slot.classList.remove('drop')
      const dropped = e.dataTransfer?.files?.[0]
      if (isUploadableImage(dropped)) h.onImage(f.id, 'file', dropped)
    })

    // Move in the stack: later overlays are drawn on top of earlier ones.
    const move = (dir) => {
      const frames = params.frames
      const j = frames.findIndex((x) => x.id === f.id)
      const k = j + dir
      if (k < 0 || k >= frames.length) return
      ;[frames[j], frames[k]] = [frames[k], frames[j]]
      h.onChange()
      rebuild()
    }
    const forward = el('button', { type: 'button', text: '▲ Forward', title: 'Draw this overlay above the next one', onclick: () => move(1) })
    const back = el('button', { type: 'button', text: '▼ Back', title: 'Draw this overlay below the previous one', onclick: () => move(-1) })
    forward.disabled = i >= count - 1
    back.disabled = i <= 0
    const bar = el('div', { class: 'row2 tight wrap' }, [
      forward,
      back,
      el('button', { type: 'button', text: 'Duplicate', onclick: () => h.onDuplicate(f.id) }),
      el('button', { type: 'button', text: 'Remove', onclick: () => h.onRemove(f.id) }),
    ])

    // Size: one "Scale" slider shrinks or enlarges the whole overlay; width / height set its proportions.
    const finalSize = el('div', { class: 'hint' })
    const showSize = () => (finalSize.textContent = `Final size: ${(f.w * f.scale).toFixed(1)} × ${(f.h * f.scale).toFixed(1)} cm`)
    syncers.push(showSize)
    showSize()
    const lock = el('input', { type: 'checkbox' })
    lock.checked = !unlocked.has(f.id)
    lock.addEventListener('change', () => (lock.checked ? unlocked.delete(f.id) : unlocked.add(f.id)))
    const W = Math.max(params.printW, params.printH)
    let wS
    let hS
    // With the lock on, changing one side scales the other so the proportions stay.
    wS = slider(f, 'w', 'Width', 0.5, Math.ceil(W * 1.5), 0.1, ' cm', (v, old) => {
      if (lock.checked && old > 0) {
        f.h = Math.max(0.2, Math.round(f.h * (v / old) * 10) / 10)
        hS?.sync()
      }
      showSize()
    })
    hS = slider(f, 'h', 'Height', 0.5, Math.ceil(W * 1.5), 0.1, ' cm', (v, old) => {
      if (lock.checked && old > 0) {
        f.w = Math.max(0.2, Math.round(f.w * (v / old) * 10) / 10)
        wS?.sync()
      }
      showSize()
    })
    const scaleS = slider(f, 'scale', 'Scale (shrink / enlarge)', 0.05, 3, 0.01, '×', showSize)

    const blend = el('select', { 'aria-label': 'Blend mode' }, BLEND_MODES.map(([v, t]) => el('option', { value: v, text: t })))
    blend.value = f.blend
    blend.addEventListener('change', () => {
      f.blend = blend.value
      h.onChange()
    })
    const shapeGrid = shapePicker('Shape', (v) => {
      f.shape = v
      h.onChange()
      rebuild() // the list and the header show the new shape
    })
    shapeGrid.set(f.shape)

    const center = el('button', {
      type: 'button',
      text: 'Center',
      title: 'Put this overlay in the middle of the print',
      onclick() {
        f.x = 0
        f.y = 0
        syncers.forEach((fn) => fn())
        h.onChange()
      },
    })

    // Fill: photo (needs a picture) or solid (one flat tone, no picture). Switching re-draws the editor.
    const solid = f.fill === 'solid'
    const fillBtns = [
      ['photo', 'Photo'],
      ['solid', 'Solid tone'],
    ].map(([v, label]) =>
      el('button', {
        type: 'button',
        class: 'seg',
        'data-v': v,
        text: label,
        title: v === 'photo' ? 'Cut a picture into the shape' : 'Fill the shape with one flat tone (no picture needed)',
        onclick() {
          f.fill = v
          h.onChange()
          rebuild()
        },
      }),
    )
    fillBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === (solid ? 'solid' : 'photo')))
    const fillRow = el('div', { class: 'segmented two', role: 'group', 'aria-label': 'Fill' }, fillBtns)
    const toneSlider = slider(f, 'tone', 'Tone (0 black · 1 white)', 0, 1, 0.01)
    const solidHint = el('div', { class: 'hint', text: 'Solid: no picture needed. The shape is painted in this tone over the black background.' })

    return [
      el('div', { class: 'editing' }, [shapeIcon(f.shape), el('span', { text: 'Editing' }), el('b', { text: shapeName(f) })]),
      fillRow,
      ...(solid ? [toneSlider, solidHint] : [slot]),
      heading('Shape'),
      shapeGrid,
      heading('Arrange'),
      bar,

      heading('Size'),
      scaleS,
      finalSize,
      wS,
      hS,
      el('label', { class: 'toggle' }, [lock, el('span', { text: 'Keep width / height proportions' })]),

      heading('Look · independent of the picture below'),
      slider(f, 'opacity', 'Opacity', 0, 1, 0.01),
      el('label', { class: 'ctl' }, [el('span', { class: 'row', text: 'Mix with what is below' }), blend]),
      ...(solid ? [] : [slider(f, 'brightness', 'Brightness', -1, 1, 0.01), slider(f, 'contrast', 'Contrast', 0.1, 4, 0.01), toggle(f, 'invert', 'Invert this picture')]),

      heading('Position'),
      slider(f, 'x', 'X (from centre)', -Math.ceil(params.printW), Math.ceil(params.printW), 0.1, ' cm'),
      slider(f, 'y', 'Y (from centre)', -Math.ceil(params.printH), Math.ceil(params.printH), 0.1, ' cm'),
      el('div', { class: 'row2 tight' }, [center]),
      slider(f, 'rot', 'Rotation', -180, 180, 0.5, '°'),
      el('div', { class: 'row2' }, [toggle(f, 'flipX', 'Flip left ↔ right'), toggle(f, 'flipY', 'Flip up ↔ down')]),

      heading('Edges'),
      slider(f, 'soft', 'Soft edge', 0, 0.6, 0.01),
      slider(f, 'border', 'Outline thickness', 0, 2, 0.05, ' cm'),
      slider(f, 'borderTone', 'Outline brightness', 0, 1, 0.01),

      ...(solid ? [] : [heading('Picture inside the shape'), slider(f, 'zoom', 'Zoom', 1, 6, 0.01), slider(f, 'panX', 'Slide X', -1, 1, 0.01), slider(f, 'panY', 'Slide Y', -1, 1, 0.01)]),
    ].filter(Boolean)
  }

  function rebuild() {
    list.replaceChildren()
    editor.replaceChildren()
    const frames = params.frames
    clearBtn.hidden = !frames.length
    listHead.hidden = !frames.length
    listCount.textContent = String(frames.length)
    h.onCount?.(frames.length)
    if (!frames.length) {
      selected = null
      syncers = []
      list.append(el('div', { class: 'hint emptylist', text: 'No shapes yet. Click a shape above to add it, or pick a ready-made layout.' }))
      return
    }
    if (!frames.some((f) => f.id === selected)) selected = frames[0].id
    // Top of the stack first, like the layers of any design app (the last one is drawn on top).
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]
      const on = f.id === selected
      const hidden = f.visible === false
      const thumb = el('span', { class: 'fthumb', 'aria-hidden': 'true' })
      const url = f.fill === 'solid' ? null : thumbFor(f)
      if (url) thumb.append(el('img', { alt: '', width: 32, height: 32, src: url }))
      else {
        const ic = shapeIcon(f.shape)
        ic.style.color = f.fill === 'solid' ? toneCss(f.tone) : '#5d5c59' // a solid shape shows its own tone
        thumb.append(ic)
      }
      const eye = el('button', {
        type: 'button',
        class: 'eyebtn' + (hidden ? ' off' : ''),
        title: hidden ? 'Show this shape' : 'Hide this shape',
        'aria-label': hidden ? 'Show this shape' : 'Hide this shape',
        'aria-pressed': String(hidden),
        onclick() {
          f.visible = hidden // flip
          h.onChange()
          rebuild()
        },
      }, [svgIcon(hidden ? EYE_OFF : EYE)])
      list.append(
        el('div', { class: 'frameitem' + (on ? ' on' : '') + (hidden ? ' off' : '') }, [
          el('button', {
            type: 'button',
            class: 'frameselect',
            'aria-pressed': String(on),
            onclick() {
              selected = f.id
              rebuild()
              h.onSelect?.()
            },
          }, [thumb, el('span', { class: 'fname' }, [el('span', { class: 'ftitle', text: shapeName(f) }), el('small', { text: subtitleOf(f) })])]),
          eye,
        ]),
      )
    }
    const i = frames.findIndex((f) => f.id === selected)
    editor.append(...buildEditor(frames[i], i, frames.length))
  }

  // Bring the editor of the selected shape into view (the user just added or picked it), optionally with a short glow.
  function reveal(flash = false) {
    const target = editor.firstElementChild || root
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (!flash) return
    for (const n of [editor, list.querySelector('.frameitem.on')]) {
      if (!n) continue
      n.classList.remove('flash')
      void n.offsetWidth // restart the animation
      n.classList.add('flash')
      n.addEventListener('animationend', () => n.classList.remove('flash'), { once: true })
    }
  }

  rebuild()
  return {
    el: root,
    rebuild,
    reveal,
    open: (id) => (selected = id), // select an overlay; the caller rebuilds afterwards
    selectedId: () => (params.frames.some((f) => f.id === selected) ? selected : null),
    sync: () => syncers.forEach((fn) => fn()), // after the selected overlay was moved or scaled from outside
  }
}
