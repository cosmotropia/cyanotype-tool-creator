import { GROUPS, SECTIONS, SELECTS, PRESETS, FORMS } from './params.js'
import { isUploadableImage } from './source.js'
import { AI_PROMPTS } from './openai.js'
import { createFramesPanel } from './framesui.js'

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

// Decimals shown for a control, from its step.
const decimals = (c) => (c.step >= 1 ? 0 : c.step >= 0.1 ? 1 : c.step >= 0.01 ? 2 : 3)

const STAGE_OF = Object.fromEntries(Object.entries(SECTIONS).map(([k, s]) => [k, s.stage]))

export function createUI(root, params, h) {
  const widgets = {} // key -> { sync() }
  const tagForms = (node, forms) => {
    if (forms) node.dataset.forms = forms.join(',')
    return node
  }

  function slider(c, stage) {
    const show = () => Number(params[c.key]).toFixed(decimals(c))
    const snap = (v) => +(c.min + Math.round((v - c.min) / c.step) * c.step).toFixed(decimals(c)) // same grid as the slider
    // Typed value: Enter / blur / arrow keys. Clamped to the control's range, then applied like the slider.
    const num = el('input', {
      type: 'number', class: 'valnum', min: c.min, max: c.max, step: c.step, value: show(),
      'aria-label': c.label + ' value', title: 'Type a value and press Enter',
    })
    const input = el('input', {
      type: 'range', min: c.min, max: c.max, step: c.step, value: params[c.key], 'aria-label': c.label,
    })
    const apply = (v) => {
      params[c.key] = v
      input.value = v
      num.value = show()
      h.onParam(c.key, stage)
    }
    num.addEventListener('change', () => {
      const v = parseFloat(num.value)
      if (!Number.isFinite(v)) return (num.value = show()) // not a number: restore
      apply(snap(Math.min(c.max, Math.max(c.min, v))))
    })
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') num.blur() // commits through 'change'
      if (e.key === 'Escape') num.value = show()
    })
    input.addEventListener('input', () => {
      params[c.key] = parseFloat(input.value)
      num.value = show()
      h.onParam(c.key, stage)
    })
    input.addEventListener('dblclick', () => {
      params[c.key] = c.def
      widgets[c.key].sync()
      h.onParam(c.key, stage)
    })
    widgets[c.key] = {
      sync() {
        input.value = params[c.key]
        num.value = show()
      },
    }
    return tagForms(
      el('label', { class: 'ctl', title: (c.hint ? c.hint + ' — ' : '') + 'double-click the slider to reset' }, [
        el('span', { class: 'row' }, [
          el('span', { text: c.label }),
          el('span', { class: 'valwrap' }, [num, c.unit ? el('span', { class: 'unit', text: c.unit }) : null]),
        ]),
        input,
      ]),
      c.forms,
    )
  }

  function select(key, stage) {
    const s = SELECTS[key]
    const sel = el('select', {}, s.options.map(([v, t]) => el('option', { value: v, text: t })))
    sel.value = params[key]
    sel.addEventListener('change', () => {
      params[key] = sel.value
      h.onParam(key, stage)
    })
    widgets[key] = { sync: () => (sel.value = params[key]) }
    return tagForms(el('label', { class: 'ctl' }, [el('span', { class: 'row', text: s.label }), sel]), s.forms)
  }

  function toggle(t, stage) {
    const cb = el('input', { type: 'checkbox' })
    cb.checked = params[t.key]
    cb.addEventListener('change', () => {
      params[t.key] = cb.checked
      h.onParam(t.key, stage)
    })
    widgets[t.key] = { sync: () => (cb.checked = params[t.key]) }
    return el('label', { class: 'toggle' }, [cb, el('span', { text: t.label })])
  }

  // Segmented button row for a select (used for the three preview modes).
  function segmented(key, stage) {
    const s = SELECTS[key]
    const btns = s.options.map(([v, label, hint]) =>
      el('button', {
        type: 'button', class: 'seg', 'data-v': v, title: hint || label, text: label,
        onclick() {
          params[key] = v
          widgets[key].sync()
          h.onParam(key, stage)
        },
      }),
    )
    widgets[key] = { sync: () => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === params[key])) }
    widgets[key].sync()
    return el('div', { class: 'segmented', role: 'group', 'aria-label': s.label }, btns)
  }

  function numberField(key, label, min, max, step, stage) {
    const input = el('input', { type: 'number', min, max, step, value: params[key], 'aria-label': label })
    input.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, parseFloat(input.value) || min))
      params[key] = v
      input.value = v
      h.onParam(key, stage)
    })
    widgets[key] = { sync: () => (input.value = params[key]) }
    return el('label', { class: 'numfield' }, [el('span', { class: 'lbl', text: label }), input])
  }

  function group(title, open, children) {
    const d = el('details', {}, [el('summary', { text: title }), el('div', { class: 'body' }, children)])
    if (open) d.open = true
    return d
  }

  // ===================== 1. Create =====================
  const aiMsg = el('div', { class: 'hint ai-msg' })
  const aiPromptSel = el('select', { 'aria-label': 'Prompt idea' }, [el('option', { value: '', text: 'Prompt ideas…' })].concat(
    Object.keys(AI_PROMPTS).map((n) => el('option', { value: n, text: n })),
  ))
  const aiText = el('textarea', { rows: 5, placeholder: 'Describe the image you want to start from (e.g. a skeletal flower on a vertebral spine, glass jellyfish with beaded tentacles…)' })
  aiPromptSel.addEventListener('change', () => {
    if (aiPromptSel.value) aiText.value = AI_PROMPTS[aiPromptSel.value]
    aiPromptSel.value = ''
  })
  const cyanoCb = el('input', { type: 'checkbox' })
  cyanoCb.checked = true
  const aiQuality = el('select', { 'aria-label': 'Quality' }, [
    el('option', { value: 'low', text: 'Quality: low (fast)' }),
    el('option', { value: 'medium', text: 'Quality: medium' }),
    el('option', { value: 'high', text: 'Quality: high (slow)' }),
  ])
  aiQuality.value = 'medium'
  let aiConfigured = false
  const aiOpts = () => ({ prompt: aiText.value, quality: aiQuality.value, cyano: cyanoCb.checked })
  const aiButtons = [
    el('button', { type: 'button', class: 'primary', text: 'Generate → A', onclick: () => h.onAI('generate', 'A', aiOpts()) }),
    el('button', { type: 'button', text: 'Generate → B', onclick: () => h.onAI('generate', 'B', aiOpts()) }),
    el('button', { type: 'button', text: 'Vary current result → A', title: 'Sends the current result to OpenAI as a starting point', onclick: () => h.onAI('refine', 'A', aiOpts()) }),
  ]

  const slots = {}
  function imageSlot(id, label, codeLabel) {
    const thumb = el('img', { class: 'thumb', alt: `Picture ${id}`, width: 56, height: 56 })
    const name = el('span', { class: 'slotname', text: 'none' })
    const file = el('input', { type: 'file', accept: 'image/*,.heic,.heif,image/heic,image/heif', hidden: '' })
    file.addEventListener('change', () => {
      if (file.files?.[0]) h.onImage(id, 'file', file.files[0])
      file.value = ''
    })
    const buttons = [
      el('button', { type: 'button', text: 'Upload', title: 'JPEG, PNG, WebP, HEIC…', onclick: () => file.click() }),
      el('button', { type: 'button', text: 'Sample', onclick: () => h.onImage(id, 'sample') }),
      el('button', { type: 'button', text: codeLabel, title: id === 'A' ? 'Use the code generator as the source' : 'Snapshot of the code generator', onclick: () => h.onImage(id, 'code') }),
    ]
    if (id === 'B') buttons.push(el('button', { type: 'button', text: 'Clear', onclick: () => h.onImage(id, 'clear') }))
    const box = el('div', { class: 'slot' }, [
      thumb,
      el('div', { class: 'slotcol' }, [el('span', { class: 'slottitle', text: label }), name, el('div', { class: 'row2 tight wrap' }, buttons)]),
      file,
    ])
    box.addEventListener('dragover', (e) => {
      e.preventDefault()
      box.classList.add('drop')
    })
    box.addEventListener('dragleave', () => box.classList.remove('drop'))
    box.addEventListener('drop', (e) => {
      e.preventDefault()
      box.classList.remove('drop')
      const f = e.dataTransfer?.files?.[0]
      if (isUploadableImage(f)) h.onImage(id, 'file', f)
    })
    slots[id] = { thumb, name }
    return box
  }

  const seedInput = el('input', { type: 'number', min: 0, max: 99999, step: 1, value: params.seed, 'aria-label': 'Seed' })
  seedInput.addEventListener('change', () => {
    params.seed = Math.max(0, Math.floor(Number(seedInput.value) || 0))
    h.onParam('seed', 'source')
  })
  widgets.seed = { sync: () => (seedInput.value = params.seed) }

  const createBlock = el('div', { class: 'block create' }, [
    el('h2', { text: '1 · Start from a picture' }),
    el('div', { class: 'hint', text: 'Describe it and let AI draw it, upload your own, or use the code generators. Then shape it with the controls below.' }),
    aiPromptSel,
    aiText,
    el('label', { class: 'toggle' }, [cyanoCb, el('span', { text: 'Cyanotype-friendly wording (black & white, white subject on black)' })]),
    aiQuality,
    el('div', { class: 'row2 wrap' }, aiButtons),
    aiMsg,
    imageSlot('A', 'Picture A (main)', 'Code'),
    imageSlot('B', 'Picture B (optional, morph)', 'Code'),
    el('div', { class: 'row2' }, [
      el('button', { type: 'button', text: 'Reset all controls', title: 'Return every transform, filament, tone and cyanotype control to its default (the picture itself stays)', onclick: () => h.onResetAll() }),
    ]),
    el('div', { class: 'row2' }, [
      el('span', { class: 'lbl', text: 'Seed' }),
      seedInput,
      el('button', { type: 'button', text: 'New seed', onclick: () => h.onNewSeed() }),
      el('button', { type: 'button', text: 'Randomize', onclick: () => h.onRandomize() }),
    ]),
  ])

  // ===================== 2-4. Control sections =====================
  const sectionEls = {}
  for (const [id, sec] of Object.entries(SECTIONS)) {
    const wrap = el('div', { class: 'sect' }, [el('h2', { text: sec.title }), el('div', { class: 'hint', text: sec.hint })])
    sectionEls[id] = wrap
  }

  // Code generator header: generator + presets
  const formSel = el('select', { 'aria-label': 'Generator' }, FORMS.map(([v, t]) => el('option', { value: v, text: t })))
  formSel.value = params.form
  formSel.addEventListener('change', () => h.onForm(formSel.value))
  widgets.form = { sync: () => (formSel.value = params.form) }
  const presetSel = el('select', { 'aria-label': 'Presets' }, [el('option', { value: '', text: 'Presets…' })])
  for (const [fv, ft] of FORMS) {
    const og = el('optgroup', { label: ft.split(' — ')[0] })
    for (const [name, pr] of Object.entries(PRESETS)) if (pr.form === fv) og.append(el('option', { value: name, text: name }))
    presetSel.append(og)
  }
  presetSel.addEventListener('change', () => {
    if (presetSel.value) h.onPreset(presetSel.value)
    presetSel.value = ''
  })
  sectionEls.code.append(el('div', { class: 'block flat' }, [formSel, presetSel]))

  sectionEls.cyano.append(
    el('div', { class: 'block flat' }, [
      segmented('preview', 'post'),
      el('div', { class: 'hint', text: 'Digital negative = what you print on transparent film. Cyanotype simulation is only a preview of the final print.' }),
    ]),
  )

  for (const g of GROUPS) {
    const stage = STAGE_OF[g.section]
    const kids = g.controls.map((c) => slider(c, stage))
    for (const key of g.selects || []) kids.push(select(key, stage))
    for (const t of g.toggles || []) kids.push(toggle(t, stage))
    sectionEls[g.section].append(group(g.title, g.open, kids))
  }

  const framesPanel = createFramesPanel(params, h.frames)
  sectionEls.frames.append(framesPanel.el)
  sectionEls.frames.dataset.sect = 'frames'

  sectionEls.cyano.append(
    el('div', { class: 'block flat' }, [
      el('div', { class: 'row2 wrap' }, [
        el('button', { type: 'button', text: 'Reset cyanotype settings', title: 'Back to a neutral digital negative (does not touch the artwork)', onclick: () => h.onCyanoReset() }),
        el('button', { type: 'button', text: 'Clean setup', title: 'Remove every filter (filaments, glow, relief, curves, vignette, grain…) and show the plain digital negative', onclick: () => h.onCleanSetup() }),
      ]),
    ]),
  )

  const undoBtn = el('button', { type: 'button', text: '↶ Undo', title: 'Undo (⌘Z)', onclick: () => h.onUndo() })
  const redoBtn = el('button', { type: 'button', text: '↷ Redo', title: 'Redo (⇧⌘Z)', onclick: () => h.onRedo() })
  undoBtn.disabled = true
  redoBtn.disabled = true
  sectionEls.cyano.append(
    el('div', { class: 'block flat' }, [
      el('div', { class: 'row2 wrap' }, [
        undoBtn,
        redoBtn,
        el('button', { type: 'button', text: 'Copy settings', title: 'Copy every setting (⌘C) so you can paste it back later', onclick: () => h.onCopySettings() }),
        el('button', { type: 'button', text: 'Paste settings', title: 'Paste settings copied from this app (⌘V)', onclick: () => h.onPasteSettings() }),
      ]),
    ]),
  )

  // ===================== 5. Export =====================
  const status = el('div', { class: 'status' })
  const progress = el('progress', { max: 1, value: 0, hidden: '' })
  const exportBtn = el('button', { type: 'button', class: 'primary', text: 'Export PNG', onclick: () => h.onExport('png') })
  const exportTiffBtn = el('button', { type: 'button', class: 'primary', text: 'Export TIFF', onclick: () => h.onExport('tiff') })
  const exportInfo = el('div', { class: 'hint' })
  const progressLabel = el('div', { class: 'hint', hidden: '' })
  const exportBlock = el('div', { class: 'block' }, [
    el('h2', { text: 'Print export' }),
    select('output', 'info'),
    select('size', 'info'),
    el('div', { class: 'row2' }, [numberField('printW', 'Width (cm)', 2, 300, 0.1, 'info'), numberField('printH', 'Height (cm)', 2, 300, 0.1, 'info')]),
    select('dpi', 'info'),
    select('bitDepth', 'info'),
    el('div', { class: 'row2' }, [exportBtn, exportTiffBtn]),
    progress,
    progressLabel,
    exportInfo,
  ])

  root.append(
    createBlock,
    sectionEls.frames,
    sectionEls.cyano,
    sectionEls.code,
    sectionEls.transform,
    sectionEls.effects,
    sectionEls.filaments,
    sectionEls.measure,
    sectionEls.tone,
    exportBlock,
    el('div', { class: 'hint keys' }, ['Double-click a slider to reset · R: randomize · E: export · H: hand (move picture) · O: overlay tool (move / resize the selected overlay) · ⌘Z undo · ⇧⌘Z redo · ⌘C / ⌘V copy / paste settings']),
    status,
  )

  function applyForm(form) {
    for (const node of root.querySelectorAll('[data-forms]')) {
      node.hidden = !node.dataset.forms.split(',').includes(form)
    }
    for (const d of root.querySelectorAll('details')) {
      const kids = [...d.querySelectorAll('.body > *')]
      d.hidden = kids.length > 0 && kids.every((k) => k.hidden)
    }
  }
  applyForm(params.form)

  return {
    set(key, value) {
      params[key] = value
      widgets[key]?.sync()
    },
    refresh() {
      for (const w of Object.values(widgets)) w.sync()
      framesPanel.rebuild()
      applyForm(params.form)
    },
    rebuildFrames: framesPanel.rebuild,
    openFrame: framesPanel.open,
    selectedFrame: framesPanel.selectedId,
    syncFrames: framesPanel.sync,
    applyForm,
    setCodeVisible(visible) {
      sectionEls.code.hidden = !visible
    },
    setStatus(t) {
      status.textContent = t
    },
    setExportInfo(t) {
      exportInfo.textContent = t
    },
    setSlot(id, thumbUrl, label) {
      const s = slots[id]
      if (thumbUrl) s.thumb.src = thumbUrl
      else s.thumb.removeAttribute('src')
      s.name.textContent = label
    },
    setAI({ configured, available, model }) {
      aiConfigured = configured
      for (const b of aiButtons) b.disabled = !configured
      aiMsg.textContent = !available
        ? 'AI proxy not reachable. Start the app with `npm run dev` (or `npm run preview`) so the local server can call OpenAI.'
        : configured
          ? `OpenAI connected · model ${model}`
          : 'No OPENAI_API_KEY found: add it to .env and restart the dev server. Upload and code sources work without it.'
      aiMsg.dataset.kind = configured ? 'ok' : 'warn'
    },
    setAIBusy(busy, text) {
      for (const b of aiButtons) b.disabled = busy || !aiConfigured
      if (text) {
        aiMsg.textContent = text
        aiMsg.dataset.kind = busy ? 'busy' : 'ok'
      }
    },
    setAIMessage(text, kind = 'ok') {
      aiMsg.textContent = text
      aiMsg.dataset.kind = kind
    },
    setProgress(frac, label) {
      const busy = frac != null
      progress.hidden = !busy
      progressLabel.hidden = !busy
      exportBtn.disabled = busy
      exportTiffBtn.disabled = busy
      if (busy) {
        progress.value = frac
        progressLabel.textContent = label || 'Exporting…'
      }
    },
    setHistory(canUndo, canRedo) {
      undoBtn.disabled = !canUndo
      redoBtn.disabled = !canRedo
    },
    setExportWarning(on) {
      exportInfo.dataset.kind = on ? 'warn' : ''
    },
  }
}
