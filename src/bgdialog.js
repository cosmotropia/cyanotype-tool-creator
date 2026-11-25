// "Remove background" dialog for pictures: the main pictures (A and B) and the pictures cut into shapes.
//
// openBgRemove({ src, title, name, note }) -> Promise of
//   null                         closed without changes,
//   { kind: 'apply', base, alpha, matte, state }
//                                 `base` is the picture without any cut-out, `alpha` its cut-out mask (0..1, one value per pixel),
//                                 `matte` / `state` are kept on the picture so reopening the dialog is instant and keeps the sliders,
//   { kind: 'restore', base }    the original picture is wanted back.
//
// Two methods: "Smart (AI)" finds the main subject with a model that runs in the browser (bgremove.js); "By brightness"
// makes the dark parts transparent (white-on-black artwork). Both go through the same two sliders. The result is applied
// in place; "Save PNG" additionally downloads it as a transparent PNG.

import { extractMatte, refineMatte, upscaleMask } from './bgremove.js'
import { encodePNG } from './encode.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const PREVIEW_SIDE = 900
const DEFAULTS = {
  ai: { keep: 0.5, soft: 0.3 },
  tone: { keep: 0.85, soft: 0.35 }, // keeps dark detail, only the real background goes
}

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

export function openBgRemove({ src, title, name = 'picture', note = '' }) {
  const base = src.bgOrig || src // always work from the picture without a cut-out
  const W = base.w
  const H = base.h
  let method = src.bgState?.method || 'ai'
  let state = { ...DEFAULTS[method], ...(src.bgState || {}) }
  let matte = src.bgMatte || null // { alpha, w, h } from the model, cached on the picture
  let view = 'cut' // 'cut' | 'orig'
  let busy = false
  let closed = false
  let savedMsg = ''
  let savedTimer = 0
  const previousFocus = document.activeElement

  // ---- preview (small copy of the picture, so the sliders feel instant) ----
  const k = Math.min(1, PREVIEW_SIDE / Math.max(W, H))
  const pw = Math.max(8, Math.round(W * k))
  const ph = Math.max(8, Math.round(H * k))
  const pg = new Float32Array(pw * ph)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(H - 1, Math.floor(((y + 0.5) * H) / ph))
    for (let x = 0; x < pw; x++) pg[y * pw + x] = base.gray[sy * W + Math.min(W - 1, Math.floor(((x + 0.5) * W) / pw))]
  }
  let pmAI = null // the model's mask at preview size
  const buildPmAI = () => (pmAI = matte ? upscaleMask(matte.alpha, matte.w, matte.h, pw, ph) : null)
  buildPmAI()

  const canvas = el('canvas', { class: 'bgcanvas', width: pw, height: ph })
  const ctx = canvas.getContext('2d')
  const work = el('div', { class: 'cropwork' }, [canvas])
  const info = el('div', { class: 'cropinfo', 'aria-live': 'polite' })
  const bar = el('progress', { class: 'bgbar', max: 1, hidden: '' })
  const status = el('div', { class: 'hint', 'aria-live': 'polite', hidden: '' })

  const currentMask = () => {
    const pm = method === 'ai' ? pmAI : pg
    return pm ? refineMatte(pm, state) : null
  }

  function paint() {
    const a = view === 'cut' ? currentMask() : null
    const img = ctx.createImageData(pw, ph)
    for (let i = 0, o = 0; i < pg.length; i++, o += 4) {
      const v = Math.round(clamp(pg[i], 0, 1) * 255)
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = a ? Math.round(a[i] * 255) : 255
    }
    ctx.putImageData(img, 0, 0)
    const m = currentMask()
    if (m && !savedMsg) {
      let s = 0
      for (let i = 0; i < m.length; i++) s += m[i]
      info.textContent = `Keeping ${Math.round((s / m.length) * 100)}% of the picture`
    } else info.textContent = savedMsg || ''
  }

  function layout() {
    const maxW = Math.max(160, Math.min(window.innerWidth - 80, 860))
    const maxH = Math.max(160, window.innerHeight - 400)
    const s = Math.min(1.5, maxW / pw, maxH / ph)
    canvas.style.width = `${Math.round(pw * s)}px`
    canvas.style.height = `${Math.round(ph * s)}px`
  }

  // ---- controls ----
  const sliders = {}
  function slider(key, label, hint) {
    const val = el('span', { class: 'bgval' })
    const input = el('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': label })
    const row = el('label', { class: 'bgctl', title: hint }, [el('span', { text: label }), input, val])
    const sync = () => {
      input.value = state[key]
      val.textContent = state[key].toFixed(2)
    }
    input.addEventListener('input', () => {
      state[key] = parseFloat(input.value)
      savedMsg = ''
      sync()
      paint()
    })
    sync()
    sliders[key] = { input, sync, row }
    return row
  }
  const keepRow = slider('keep', 'Keep more', 'Raise it to keep faint parts of the subject, lower it to cut closer')
  const softRow = slider('soft', 'Edge softness', 'How soft the edge of the cut-out is')

  const chip = (label, hint, onclick) => el('button', { type: 'button', text: label, title: hint, onclick })
  const methodBtns = {
    ai: chip('Smart (AI)', 'Finds the main subject, like remove.bg or Canva. Runs on your computer', () => setMethod('ai')),
    tone: chip('By brightness', 'Dark areas become transparent: best for white-on-black artwork', () => setMethod('tone')),
  }
  const viewBtns = {
    cut: chip('Cutout', 'The picture with the background removed', () => setView('cut')),
    orig: chip('Original', 'The picture as it was', () => setView('orig')),
  }

  function syncUi() {
    for (const [id, b] of Object.entries(methodBtns)) b.classList.toggle('on', id === method)
    for (const [id, b] of Object.entries(viewBtns)) b.classList.toggle('on', id === view)
    const ready = !busy && (method === 'tone' || !!pmAI)
    for (const s of Object.values(sliders)) s.input.disabled = !ready
    applyBtn.disabled = !ready
    saveBtn.disabled = !ready
    for (const b of Object.values(methodBtns)) b.disabled = busy
    status.hidden = !busy && !status.textContent
    bar.hidden = !busy
  }

  function setView(v) {
    view = v
    paint()
    syncUi()
  }

  function setMethod(m, keepState = false) {
    method = m
    if (!keepState) state = { ...DEFAULTS[m] }
    for (const s of Object.values(sliders)) s.sync()
    savedMsg = ''
    if (m === 'ai' && !pmAI) runAI()
    else {
      status.textContent = ''
      view = 'cut'
      paint()
    }
    syncUi()
  }

  async function runAI() {
    busy = true
    view = 'orig' // while the model works, show the picture
    status.textContent = 'Preparing the cut-out model…'
    bar.removeAttribute('value')
    paint()
    syncUi()
    try {
      matte = await extractMatte(base, {
        onProgress(p) {
          if (closed) return
          if (p.phase === 'download') {
            status.textContent = `Downloading the cut-out model… ${(p.loaded / 1e6).toFixed(0)} of ${(p.total / 1e6).toFixed(0)} MB (first time only)`
            bar.value = p.total ? p.loaded / p.total : 0
          } else if (p.phase === 'segment') {
            status.textContent = 'Finding the subject…'
            bar.removeAttribute('value')
          }
        },
      })
      if (closed) return
      buildPmAI()
      busy = false
      status.textContent = ''
      delete status.dataset.kind
      view = 'cut'
    } catch (err) {
      console.error(err)
      if (closed) return
      busy = false
      status.textContent = 'Could not load the cut-out model (check your internet connection). Switched to “By brightness”.'
      status.dataset.kind = 'warn'
      method = 'tone'
      state = { ...DEFAULTS.tone }
      for (const s of Object.values(sliders)) s.sync()
      view = 'cut'
    }
    paint()
    syncUi()
  }

  // ---- result ----
  function fullAlpha() {
    if (method === 'ai') return upscaleMask(refineMatte(matte.alpha, state), matte.w, matte.h, W, H)
    return refineMatte(base.gray, state)
  }

  function result() {
    return { kind: 'apply', base, alpha: fullAlpha(), matte, state: { method, ...state } }
  }

  async function savePng() {
    const alpha = fullAlpha()
    const data = new Uint8Array(W * H * 2)
    for (let i = 0; i < alpha.length; i++) {
      data[i * 2] = Math.round(clamp(base.gray[i], 0, 1) * 255)
      data[i * 2 + 1] = Math.round(alpha[i] * 255)
    }
    const blob = await encodePNG({ data, width: W, height: H, channels: 2, depth: 8, dpi: 300 })
    const file = `${String(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 48) || 'picture'}-cutout-${W}x${H}.png`
    const url = URL.createObjectURL(blob)
    const a = el('a', { href: url, download: file })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    savedMsg = `PNG saved · ${file}`
    paint()
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      savedMsg = ''
      paint()
    }, 4000)
  }

  // ---- dialog chrome ----
  const applyBtn = el('button', { type: 'button', class: 'primary', text: 'Apply', title: 'Use the cut-out on this picture (you can come back to refine it)', onclick: () => finish(result()) })
  const saveBtn = el('button', { type: 'button', text: 'Save PNG', title: 'Download the cut-out as a transparent PNG', onclick: savePng })
  const closeBtn = el('button', { type: 'button', class: 'cropclose', 'aria-label': 'Close', text: '×', onclick: () => finish(null) })
  const card = el('div', { class: 'cropcard' }, [
    el('header', {}, [el('h2', { class: 'croptitle', text: title }), closeBtn]),
    el('div', { class: 'bgrow' }, [
      el('div', { class: 'cropaspects', role: 'group', 'aria-label': 'Method' }, Object.values(methodBtns)),
      el('div', { class: 'cropaspects', role: 'group', 'aria-label': 'View' }, Object.values(viewBtns)),
    ]),
    work,
    bar,
    status,
    info,
    el('div', { class: 'bgsliders' }, [keepRow, softRow]),
    el('div', { class: 'hint', text: 'The cut-out is applied to this picture in place. You can come back to refine it, or restore the original. The model (44 MB) downloads once and runs on your computer: the picture is never uploaded.' }),
    el('div', { class: 'hint', text: '“Smart (AI)” finds the main subject, best for photos. For white-on-black artwork, use “By brightness”.' }),
    note ? el('div', { class: 'hint', 'data-kind': 'warn', text: note }) : null,
    el('div', { class: 'cropfoot' }, [
      el('div', { class: 'row2 tight wrap' }, [
        saveBtn,
        src.bgOrig ? el('button', { type: 'button', text: 'Restore original', title: 'Bring back the picture as it was before removing the background', onclick: () => finish({ kind: 'restore', base }) }) : null,
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
      const items = [...card.querySelectorAll('button, input')].filter((n) => !n.disabled)
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
    }
  }

  let done = null
  const promise = new Promise((resolve) => (done = resolve))
  function finish(value) {
    closed = true
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
  if (method === 'ai' && !pmAI) runAI()
  else paint()
  syncUi()
  if (!busy) applyBtn.focus()
  return promise
}
