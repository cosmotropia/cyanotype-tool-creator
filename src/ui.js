import { GROUPS, SECTIONS, SELECTS, PRESETS, FORMS, PNG_CUT } from './params.js'
import { isUploadableImage } from './source.js'
import { AI_PROMPTS, AI_ENABLED, AI_SOON_TEXT, AI_SOON_SHORT } from './openai.js'
import { createFramesPanel } from './framesui.js'
import { LANGUAGES, getLang, setLang, onLangChange, t } from './i18n.js'

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

// Small stroke icons (static markup, no user input).
const ICONS = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  portrait: '<rect x="7" y="3" width="10" height="18" rx="1.5"/>',
  landscape: '<rect x="3" y="7" width="18" height="10" rx="1.5"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
}
function ico(name) {
  const s = document.createElement('span')
  s.className = 'ico'
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return s
}

// A collapsible section with a chevron header (used for Idea, Parameters, Reference).
function fold(title, open, children) {
  const body = el('div', { class: 'foldbody' }, children)
  const head = el('button', { type: 'button', class: 'foldhead' }, [el('span', { text: title }), ico('chevron')])
  const wrap = el('section', { class: 'fold' }, [head, body])
  const set = (on) => {
    body.hidden = !on
    head.setAttribute('aria-expanded', String(on))
    wrap.classList.toggle('open', on)
  }
  head.addEventListener('click', () => set(body.hidden))
  set(open)
  return wrap
}

// Dropdown for the top bar. Closes on outside click, Escape, or after picking an item.
const openMenus = new Set()
const closeMenus = () => openMenus.forEach((close) => close())
document.addEventListener('click', closeMenus)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus()
})
function menu(iconName, label, items, iconOnly = false) {
  const panel = el('div', { class: 'menupanel', role: 'menu', hidden: '' }, items)
  const btn = el('button', { type: 'button', class: 'topbtn', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': label, title: label }, [
    ico(iconName),
    iconOnly ? null : el('span', { text: label }),
  ])
  const close = () => {
    panel.hidden = true
    btn.setAttribute('aria-expanded', 'false')
  }
  openMenus.add(close)
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const wasOpen = !panel.hidden
    closeMenus()
    if (!wasOpen) {
      panel.hidden = false
      btn.setAttribute('aria-expanded', 'true')
    }
  })
  panel.addEventListener('click', (e) => {
    e.stopPropagation()
    if (e.target.closest('button')) close()
  })
  return el('div', { class: 'menu' }, [btn, panel])
}

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
    if (aiPromptSel.value) aiText.value = t(AI_PROMPTS[aiPromptSel.value]) // the idea, written in the current language
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
  // Coming soon: the AI controls stay visible but locked until VITE_AI_ENABLED=true (see openai.js).
  const aiControls = [aiPromptSel, aiText, cyanoCb, aiQuality, ...aiButtons]
  if (!AI_ENABLED) for (const c of aiControls) c.disabled = true

  const slots = {}
  const slotFiles = {} // id -> the slot's hidden file input (the top bar's "Open" uses picture A's)
  function imageSlot(id, label, codeLabel) {
    const thumb = el('img', { class: 'thumb', alt: `Picture ${id}`, width: 56, height: 56 })
    const name = el('span', { class: 'slotname', text: 'none' })
    const file = el('input', { type: 'file', accept: 'image/*,.heic,.heif,image/heic,image/heif', hidden: '' })
    slotFiles[id] = file
    file.addEventListener('change', () => {
      if (file.files?.[0]) h.onImage(id, 'file', file.files[0])
      file.value = ''
    })
    const buttons = [
      el('button', { type: 'button', 'data-act': 'upload', text: 'Upload', title: 'JPEG, PNG, WebP, HEIC…', onclick: () => file.click() }),
      el('button', { type: 'button', 'data-act': 'sample', text: 'Sample', onclick: () => h.onImage(id, 'sample') }),
      el('button', { type: 'button', 'data-act': 'code', text: codeLabel, title: id === 'A' ? 'Use the code generator as the source' : 'Snapshot of the code generator', onclick: () => h.onImage(id, 'code') }),
    ]
    // Remove background: cut the subject out, applied to this picture in place (can also be saved as a transparent PNG).
    const bgBtn = el('button', {
      type: 'button',
      'data-act': 'bg',
      text: 'Remove background',
      title: 'Remove the background of this picture and keep the subject (you can also save it as a transparent PNG)',
      onclick: () => h.onImage(id, 'bg'),
    })
    bgBtn.disabled = true
    buttons.push(bgBtn)
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
    slots[id] = { thumb, name, bg: bgBtn }
    return box
  }

  const seedInput = el('input', { type: 'number', min: 0, max: 99999, step: 1, value: params.seed, 'aria-label': 'Seed' })
  seedInput.addEventListener('change', () => {
    params.seed = Math.max(0, Math.floor(Number(seedInput.value) || 0))
    h.onParam('seed', 'source')
  })
  widgets.seed = { sync: () => (seedInput.value = params.seed) }

  // Idea: the AI prompt. Reference (optional): picture A and B. Seed. The Generate buttons sit in a dock under all of it.
  const ideaFold = fold('Idea', true, [
    el('div', { class: 'hint', text: AI_ENABLED ? 'Describe it and let AI draw it, upload your own, or use the code generators. Then shape it with the controls below.' : AI_SOON_TEXT }),
    aiPromptSel,
    aiText,
    el('label', { class: 'toggle' }, [cyanoCb, el('span', { text: 'Cyanotype-friendly wording (black & white, white subject on black)' })]),
    aiQuality,
  ])
  // Open by default so Picture B is visible from the start. The mix slider lives in Parameters → Curvature & deformation.
  const referenceFold = fold('Pictures & mix (A + B)', true, [
    el('div', {
      class: 'hint',
      text: 'Picture A is the main picture. Upload a second one as Picture B, then drag "Morph A ↔ B" in Parameters → Curvature & deformation: 0 = only A, 1 = only B, in between = a mix of both.',
    }),
    imageSlot('A', 'Picture A · main', 'Code'),
    imageSlot('B', 'Picture B · to mix with A', 'Code'),
  ])
  const seedBlock = el('div', { class: 'block' }, [
    el('div', { class: 'seedrow' }, [
      el('span', { class: 'lbl', text: 'Seed' }),
      seedInput,
      el('button', { type: 'button', text: 'New seed', onclick: () => h.onNewSeed() }),
      el('button', { type: 'button', text: 'Randomize', onclick: () => h.onRandomize() }),
    ]),
  ])
  aiButtons[0].classList.add('generate')
  aiButtons[0].prepend(ico('spark'))
  if (!AI_ENABLED) {
    ideaFold.querySelector('.foldhead').append(el('span', { class: 'soonbadge', text: 'Coming soon' }))
    ideaFold.classList.add('ai-locked')
    aiMsg.textContent = AI_SOON_SHORT
    aiMsg.dataset.kind = 'soon'
  }
  const dock = el('div', { class: 'dock' }, [aiMsg, aiButtons[0], el('div', { class: 'row2 wrap' }, [aiButtons[1], aiButtons[2]])])

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

  // Undo / Redo live in the top bar now (see "Top bar" below).
  const undoBtn = el('button', { type: 'button', class: 'topbtn', 'aria-label': 'Undo', title: 'Undo (⌘Z)', onclick: () => h.onUndo() }, [ico('undo')])
  const redoBtn = el('button', { type: 'button', class: 'topbtn', 'aria-label': 'Redo', title: 'Redo (⇧⌘Z)', onclick: () => h.onRedo() }, [ico('redo')])
  undoBtn.disabled = true
  redoBtn.disabled = true

  // ===================== 5. Export =====================
  const status = el('div', { class: 'status' })
  const progress = el('progress', { max: 1, value: 0, hidden: '' })
  const exportBtn = el('button', {
    type: 'button',
    class: 'primary',
    text: 'Export cyanotype',
    title: 'Saves the print (follows “Export content”: digital negative, original artwork or cyanotype simulation) as a PNG',
    onclick: () => h.onExport('png'),
  })
  const exportTiffBtn = el('button', {
    type: 'button',
    class: 'primary',
    text: 'Export TIFF',
    title: 'The same print as a TIFF',
    onclick: () => h.onExport('tiff'),
  })
  const TRANSPARENT_TIP = 'PNG with the main background removed: the black of the artwork (the white of the digital negative) becomes transparent'
  const exportAlphaBtn = el('button', { type: 'button', class: 'primary', text: 'Export transparent PNG', title: TRANSPARENT_TIP, onclick: () => h.onExport('png-alpha') })
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
    el('div', { class: 'row2' }, [exportAlphaBtn]),
    slider(PNG_CUT, 'info'),
    el('div', { class: 'hint', text: 'Transparent PNG: the background is removed, so dark areas of a picture become see-through too. It follows “Export content” (the cyanotype simulation exports the original artwork).' }),
    progress,
    progressLabel,
    exportInfo,
  ])

  // ===================== Layout: tabs =====================
  // Create: idea, parameters (code generator + transform), reference pictures, seed, Generate.
  // Cyanotype: preview mode, adjustments, tone & print export. Layers: overlays, readings, effects, filaments, measurements.
  const paramsFold = fold('Parameters', true, [sectionEls.code, sectionEls.transform])
  const TABS = [['create', 'Create'], ['cyanotype', 'Cyanotype'], ['layers', 'Layers']]
  const pane = (id, kids) => el('div', { class: 'tabpane', role: 'tabpanel', 'data-tab': id, 'aria-label': Object.fromEntries(TABS)[id] }, kids)
  const panes = {
    create: pane('create', [ideaFold, paramsFold, referenceFold, seedBlock, dock]),
    cyanotype: pane('cyanotype', [sectionEls.cyano, sectionEls.tone, exportBlock]),
    layers: pane('layers', [sectionEls.frames, sectionEls.effects, sectionEls.filaments, sectionEls.measure]),
  }
  const tabBtns = {}
  function selectTab(id, focus = false) {
    for (const [k] of TABS) {
      panes[k].hidden = k !== id
      tabBtns[k].setAttribute('aria-selected', String(k === id))
      tabBtns[k].tabIndex = k === id ? 0 : -1
    }
    root.scrollTop = 0
    if (focus) tabBtns[id].focus()
  }
  const tablist = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Panels' })
  for (const [id, label] of TABS) {
    tabBtns[id] = el('button', { type: 'button', class: 'tab', role: 'tab', text: label, onclick: () => selectTab(id) })
    tablist.append(tabBtns[id])
  }
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.findIndex(([k]) => tabBtns[k].getAttribute('aria-selected') === 'true')
    if (e.key === 'ArrowRight') selectTab(TABS[(i + 1) % TABS.length][0], true)
    else if (e.key === 'ArrowLeft') selectTab(TABS[(i + TABS.length - 1) % TABS.length][0], true)
  })
  root.before(tablist)
  root.append(panes.create, panes.cyanotype, panes.layers)
  selectTab('create')

  // ===================== Layout: top bar =====================
  // Same actions as before, gathered in one place: undo / redo, open a picture, export, settings.
  const doc = root.ownerDocument
  const topbar = doc.getElementById('topbar')
  const topActions = doc.getElementById('topactions')
  const stageEl = doc.getElementById('stage')
  const topProgress = el('div', { class: 'toprogress', hidden: '' }, [el('i')])
  const menuPng = el('button', { type: 'button', class: 'menuitem', role: 'menuitem', onclick: () => h.onExport('png') }, [el('span', { text: 'Export PNG' }), el('kbd', { text: 'E' })])
  const menuAlpha = el('button', { type: 'button', class: 'menuitem', role: 'menuitem', title: TRANSPARENT_TIP, onclick: () => h.onExport('png-alpha') }, [el('span', { text: 'Export transparent PNG' })])
  const menuTiff = el('button', { type: 'button', class: 'menuitem', role: 'menuitem', onclick: () => h.onExport('tiff') }, [el('span', { text: 'Export TIFF' })])
  const menuPrint = el('button', {
    type: 'button',
    class: 'menuitem',
    role: 'menuitem',
    onclick() {
      selectTab('cyanotype')
      exportBlock.scrollIntoView({ block: 'start' })
    },
  }, [el('span', { text: 'Print size & format…' })])
  const exportBtns = [exportBtn, exportTiffBtn, exportAlphaBtn, menuPng, menuAlpha, menuTiff]
  const openBtn = el('button', { type: 'button', class: 'topbtn', title: 'Open a picture as picture A (JPEG, PNG, WebP, HEIC…)', onclick: () => slotFiles.A.click() }, [ico('open'), el('span', { text: 'Open' })])
  const settingsMenu = menu('sliders', 'Settings', [
    el('button', { type: 'button', class: 'menuitem', role: 'menuitem', title: 'Copy every setting (⌘C) so you can paste it back later', onclick: () => h.onCopySettings() }, [el('span', { text: 'Copy settings' }), el('kbd', { text: '⌘C' })]),
    el('button', { type: 'button', class: 'menuitem', role: 'menuitem', title: 'Paste settings copied from this app (⌘V)', onclick: () => h.onPasteSettings() }, [el('span', { text: 'Paste settings' }), el('kbd', { text: '⌘V' })]),
    el('button', { type: 'button', class: 'menuitem', role: 'menuitem', title: 'Return every transform, filament, tone and cyanotype control to its default (the picture itself stays)', onclick: () => h.onResetAll() }, [el('span', { text: 'Reset all controls' })]),
    el('div', { class: 'menusep' }),
    el('div', { class: 'menuhint', text: 'Double-click a slider to reset · R: randomize · E: export · H: hand (move picture) · O: overlay tool (move / resize the selected overlay) · ⌘Z undo · ⇧⌘Z redo · ⌘C / ⌘V copy / paste settings' }),
  ], true)
  // Language: the page follows the browser language the first time and then remembers the choice (see i18n.js).
  const langItems = LANGUAGES.map(([code, name]) =>
    el('button', { type: 'button', class: 'menuitem', role: 'menuitemradio', lang: code, 'data-lang': code, onclick: () => setLang(code) }, [
      el('span', { text: name, translate: 'no' }),
      el('span', { class: 'check', 'aria-hidden': 'true', text: '✓' }),
    ]),
  )
  const langMenu = menu('globe', 'Language', langItems, true)
  const langCode = el('span', { class: 'langcode', translate: 'no' })
  langMenu.querySelector('button.topbtn').append(langCode)
  const syncLang = () => {
    const cur = getLang()
    langCode.textContent = cur.toUpperCase()
    for (const b of langItems) b.setAttribute('aria-checked', String(b.dataset.lang === cur))
  }
  syncLang()
  onLangChange(syncLang)

  topActions?.append(
    undoBtn,
    redoBtn,
    el('span', { class: 'topdivider', 'aria-hidden': 'true' }),
    openBtn,
    menu('download', 'Export', [menuPng, menuAlpha, menuTiff, el('div', { class: 'menusep' }), menuPrint]),
    langMenu,
    settingsMenu,
  )
  topbar?.append(topProgress)
  ;(doc.getElementById('workspace') || stageEl || root).append(status)

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

  // ===================== Format bar over the preview =====================
  // Page format, size in cm and portrait / landscape, right on the preview. Same params as the Print export block
  // (printW / printH / size), so the preview frame and the exported file always have the chosen space.
  const addSync = (key, fn) => {
    const prev = widgets[key]?.sync
    widgets[key] = { sync: () => (prev?.(), fn()) }
  }
  const barSel = el('select', { 'aria-label': 'Format preset' }, SELECTS.size.options.map(([v, label]) => el('option', { value: v, text: label })))
  barSel.addEventListener('change', () => {
    params.size = barSel.value
    h.onParam('size', 'info')
  })
  addSync('size', () => (barSel.value = params.size))
  const barNum = (key, label) => {
    const input = el('input', { type: 'number', min: 2, max: 300, step: 0.1, value: params[key], 'aria-label': label, title: label })
    input.addEventListener('change', () => {
      params[key] = Math.min(300, Math.max(2, parseFloat(input.value) || 2))
      input.value = params[key]
      h.onParam(key, 'info')
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
    })
    addSync(key, () => (input.value = params[key]))
    return input
  }
  const barW = barNum('printW', 'Width (cm)')
  const barH = barNum('printH', 'Height (cm)')
  const swapSizes = () => {
    ;[params.printW, params.printH] = [params.printH, params.printW]
    widgets.printW.sync()
    widgets.printH.sync()
    h.onParam('printW', 'info')
  }
  const orientBtn = (kind, label, title) =>
    el('button', { type: 'button', class: 'orient', 'data-o': kind, 'aria-label': label, title, onclick: () => {
      if (!orientBtns[kind].classList.contains('on')) swapSizes()
    } }, [ico(kind)])
  const orientBtns = {
    portrait: orientBtn('portrait', 'Portrait', 'Portrait (vertical)'),
    landscape: orientBtn('landscape', 'Landscape', 'Landscape (horizontal)'),
  }
  const syncOrient = () => {
    orientBtns.portrait.classList.toggle('on', params.printH > params.printW)
    orientBtns.landscape.classList.toggle('on', params.printW > params.printH)
  }
  addSync('printW', syncOrient)
  addSync('printH', syncOrient)
  syncOrient()
  stageEl?.append(
    el('div', { class: 'formatbar', role: 'group', 'aria-label': 'Format' }, [
      barSel,
      el('span', { class: 'dims' }, [barW, el('span', { class: 'x', text: '×' }), barH, el('span', { class: 'cm', text: 'cm' })]),
      el('span', { class: 'orients' }, [orientBtns.portrait, orientBtns.landscape]),
    ]),
  )

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
      s.bg.disabled = !thumbUrl // nothing to cut out until the slot holds a picture
      s.name.textContent = label
    },
    setAI({ configured, available, model }) {
      aiConfigured = configured && AI_ENABLED
      for (const b of aiButtons) b.disabled = !aiConfigured
      if (!AI_ENABLED) return // the coming-soon note set at build time stays
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
      topProgress.hidden = !busy
      for (const b of exportBtns) b.disabled = busy
      if (busy) {
        progress.value = frac
        progressLabel.textContent = label || 'Exporting…'
        topProgress.firstChild.style.width = `${Math.round(frac * 100)}%`
        status.textContent = label || 'Exporting…' // visible from every tab
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
