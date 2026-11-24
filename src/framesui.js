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
const titleOf = (f, i) =>
  `${i + 1} · ${shapeName(f)}${f.fill === 'solid' ? ' · solid' : frameImages.has(f.id) ? '' : ' (no picture)'}${f.visible === false ? ' · hidden' : ''}`
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
  const shapeSel = el('select', { 'aria-label': 'Shape of the new overlay' }, FRAME_SHAPES.map(([v, t]) => el('option', { value: v, text: t })))
  const layoutSel = el('select', { 'aria-label': 'Ready-made layouts' }, [el('option', { value: '', text: 'Ready-made layouts…' })].concat(
    Object.keys(FRAME_LAYOUTS).map((n) => el('option', { value: n, text: n })),
  ))
  layoutSel.addEventListener('change', () => {
    if (layoutSel.value) h.onLayout(layoutSel.value)
    layoutSel.value = ''
  })
  const clearBtn = el('button', { type: 'button', text: 'Remove all overlays', onclick: () => h.onClear() })

  const root = el('div', { class: 'block flat framesblock' }, [
    el('div', { class: 'hint', text: 'Shapes sit on top of the black background or the picture. A solid shape needs no picture: it is one flat tone. A photo shape shows a picture cut into the shape.' }),
    el('div', { class: 'row2' }, [shapeSel]),
    el('div', { class: 'row2 wrap' }, [
      el('button', { type: 'button', class: 'primary solid-add', text: '+ Solid shape', title: 'A flat tone shape: no picture needed', onclick: () => h.onAdd(shapeSel.value, 'solid') }),
      el('button', { type: 'button', text: '+ Photo shape', title: 'A shape cut from a picture (give it one below)', onclick: () => h.onAdd(shapeSel.value, 'photo') }),
    ]),
    layoutSel,
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
    const buttons = el('div', { class: 'row2 tight wrap' }, [
      el('button', { type: 'button', text: 'Upload', onclick: () => file.click() }),
      el('button', { type: 'button', text: 'Sample', onclick: () => h.onImage(f.id, 'sample') }),
      el('button', { type: 'button', text: 'Code', title: 'Snapshot of the code generator', onclick: () => h.onImage(f.id, 'code') }),
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
    const shape = el('select', { 'aria-label': 'Shape' }, FRAME_SHAPES.map(([v, t]) => el('option', { value: v, text: t })))
    shape.value = f.shape
    shape.addEventListener('change', () => {
      f.shape = shape.value
      h.onChange()
      rebuild() // the list shows the shape name
    })

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

    const showToggle = toggle(f, 'visible', 'Show this overlay')
    showToggle.querySelector('input').addEventListener('change', rebuild) // the list marks hidden overlays

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
    const fillRow = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Fill' }, fillBtns)
    const toneSlider = slider(f, 'tone', 'Tone (0 black · 1 white)', 0, 1, 0.01)
    const solidHint = el('div', { class: 'hint', text: 'Solid: no picture needed. The shape is painted in this tone over the black background.' })

    return [
      el('div', { class: 'editing', text: `Editing overlay ${i + 1}` }),
      fillRow,
      ...(solid ? [toneSlider, solidHint] : [slot]),
      showToggle,
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

      heading('Shape & edges'),
      el('label', { class: 'ctl' }, [el('span', { class: 'row', text: 'Shape' }), shape]),
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
    if (!frames.length) {
      selected = null
      syncers = []
      list.append(el('div', { class: 'hint', text: 'No overlays yet. Add one, or start from a ready-made layout (for example 3 circles). Then pick it in the list to set its picture, size, shape and position.' }))
      return
    }
    if (!frames.some((f) => f.id === selected)) selected = frames[0].id
    frames.forEach((f, i) => {
      let thumb
      if (f.fill === 'solid') {
        thumb = el('span', { class: 'swatch', 'aria-hidden': 'true' })
        thumb.style.background = toneCss(f.tone)
      } else {
        thumb = el('img', { alt: '', width: 32, height: 32 })
        const url = thumbFor(f)
        if (url) thumb.src = url
      }
      list.append(
        el('button', {
          type: 'button',
          class: 'frameitem' + (f.id === selected ? ' on' : ''),
          'aria-pressed': String(f.id === selected),
          onclick() {
            selected = f.id
            rebuild()
          },
        }, [thumb, el('span', { text: titleOf(f, i) })]),
      )
    })
    const i = frames.findIndex((f) => f.id === selected)
    editor.append(...buildEditor(frames[i], i, frames.length))
  }

  rebuild()
  return {
    el: root,
    rebuild,
    open: (id) => (selected = id), // select an overlay; the caller rebuilds afterwards
    selectedId: () => (params.frames.some((f) => f.id === selected) ? selected : null),
    sync: () => syncers.forEach((fn) => fn()), // after the selected overlay was moved or scaled from outside
  }
}
