import './style.css'
import './i18n.js' // starts translating the page as the UI is built (see i18n.js)
import p5 from 'p5'
import { defaults, GROUPS, PRESETS, FORM_DEFAULT_PRESET, CLEAN_KEYS, ADJUST_KEYS, CYANO_KEYS, randomPreset, randomTransform, sizeToCm, sizeKeyFromCm, cmToPx } from './params.js'
import { generateStructure } from './structure.js'
import { generateReliquary, generateMedusa } from './forms.js'
import { renderStructure } from './render2d.js'
import { sourceFromGray, sourceFromFile, sourceFromUrl, thumbUrl } from './source.js'
import { samplePicture, filamentLayer, composeBase, postProcess, processLayers, floatToImageData, imageDataToCanvas } from './pipeline.js'
import { aiStatus, aiGenerate, aiEdit, REFINE_PROMPT, CYANO_SUFFIX, AI_ENABLED, AI_SOON_SHORT } from './openai.js'
import { createUI } from './ui.js'
import { openBgRemove } from './bgdialog.js'
import { createGuide } from './guide.js'
import { clamp } from './math.js'
import { encodePNG, encodeTIFF, toGray8, toGray16, toInkAlpha8 } from './encode.js'
import { simulatePrint } from './cyanotype.js'
import { createDataPanel } from './datapanel.js'
import { applyMeasures } from './measure.js'
import { frameImages, newFrame, sanitizeFrame, sanitizeFrames, hitFrame, FRAME_LAYOUTS, FRAME_SHAPES } from './frames.js'

const params = defaults()

// ---------------- Undo / redo & settings copy-paste ----------------
// Every parameter change goes through request(). Changes made within 400 ms (a slider drag) form one undo step.
const HISTORY_MAX = 200
const SETTINGS_FORMAT = 'cyano-creator-settings'
const history = { undo: [], redo: [], committed: JSON.stringify(params), timer: 0 }

function commitHistory() {
  clearTimeout(history.timer)
  history.timer = 0
  const now = JSON.stringify(params)
  if (now !== history.committed) {
    history.undo.push(history.committed)
    if (history.undo.length > HISTORY_MAX) history.undo.shift()
    history.redo = []
    history.committed = now
  }
  ui?.setHistory(history.undo.length > 0, history.redo.length > 0)
}

function scheduleHistory() {
  clearTimeout(history.timer)
  history.timer = setTimeout(commitHistory, 400)
}

// Writes known settings (type-checked) and re-renders everything that depends on them.
function loadParams(obj) {
  const d = defaults()
  for (const k of Object.keys(d)) if (k in obj && typeof obj[k] === typeof d[k]) params[k] = obj[k]
  params.size = sizeKeyFromCm(params.printW, params.printH) // keep the format select in line with the cm fields
  params.frames = sanitizeFrames(Array.isArray(obj.frames) ? obj.frames : params.frames)
  ui.refresh()
  fitCanvas()
  updateExportInfo()
  codeDirty = true
  request(isCode() ? 'source' : 'base')
}

function undo() {
  if (exporting) return
  commitHistory()
  const prev = history.undo.pop()
  if (prev === undefined) return ui.setStatus('Nothing to undo')
  history.redo.push(history.committed)
  loadParams(JSON.parse(prev))
  history.committed = JSON.stringify(params)
  commitHistory()
}

function redo() {
  if (exporting) return
  commitHistory()
  const next = history.redo.pop()
  if (next === undefined) return ui.setStatus('Nothing to redo')
  history.undo.push(history.committed)
  loadParams(JSON.parse(next))
  history.committed = JSON.stringify(params)
  commitHistory()
}

// Clipboard API first; execCommand as a fallback for browsers / contexts that refuse the async API.
function writeClipboard(text) {
  const legacy = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (!ok) throw new Error('copy refused')
  }
  return navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).catch(legacy) : Promise.resolve().then(legacy)
}

async function copySettings() {
  const text = JSON.stringify({ format: SETTINGS_FORMAT, version: 1, params }, null, 2)
  try {
    await writeClipboard(text)
    ui.setStatus('Settings copied · ⌘V pastes them here or in another tab of this app')
  } catch (err) {
    console.error('copy settings:', err)
    ui.setStatus('Copy failed: the browser blocked the clipboard')
  }
}

// Returns true when the text was settings from this app.
function pasteSettings(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return false
  }
  if (data?.format !== SETTINGS_FORMAT || !data.params) return false
  commitHistory()
  loadParams(data.params)
  ui.setStatus('Settings pasted · ⌘Z undoes it')
  return true
}

const isTyping = (t) =>
  t instanceof HTMLElement &&
  (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && /^(text|number|search|email|url|password)$/.test(t.type)))
const MAX_EXPORT_PIXELS = 40e6
const DRAFT_SIDE = 560
const CODE_DRAFT_SIDE = 640
const CODE_FULL_SIDE = 1600
const SAMPLE_PRESETS = ['Bone orchid', 'Glass medusa', 'Spined chrysanthemum', 'Bone jellyfish']

const stage = document.getElementById('stage')
const panel = document.getElementById('panel')

// Shown over the preview until a picture is loaded (or a photo frame has one): the user chooses how to start.
const emptyHint = Object.assign(document.createElement('div'), { className: 'emptyhint' })
const clickSlotA = (label) => {
  const box = panel.querySelector('.slot') // picture A is the first slot
  if (label === 'Upload') return box.querySelector('input[type="file"]').click()
  box.querySelector(`button[data-act="${label.toLowerCase()}"]`)?.click() // by data-act, not by text: the text is translated
}
const startRow = document.createElement('div')
startRow.className = 'row2 emptyrow'
for (const label of ['Code', 'Upload', 'Sample']) {
  startRow.append(
    Object.assign(document.createElement('button'), {
      type: 'button',
      textContent: label,
      className: label === 'Code' ? 'primary' : '',
      onclick: () => clickSlotA(label),
    }),
  )
}
// Shapes on the plain black background: no picture needed. Opens the Layers tab and adds a solid shape there,
// in the shape picked next to the button (the Layers tab picker is set to the same one).
const startShape = document.createElement('select')
startShape.className = 'emptyshape'
startShape.setAttribute('aria-label', 'Shape')
startShape.title = 'Shape to start with'
for (const [value, text] of FRAME_SHAPES) startShape.append(Object.assign(document.createElement('option'), { value, textContent: text }))
startRow.append(
  Object.assign(document.createElement('button'), {
    type: 'button',
    textContent: 'Shape on black',
    title: 'Start with a solid shape on the black background (no picture needed)',
    onclick: () => {
      const tabs = panel.querySelectorAll('.tab')
      tabs[tabs.length - 1]?.click() // Layers
      const picker = panel.querySelector('.shape-new')
      if (picker) picker.value = startShape.value // setting the value does not fire its change handler
      panel.querySelector('.solid-add')?.click() // onAdd(shape, 'solid') switches the preview to the black background
    },
  }),
  startShape,
)
// Viewfinder marks around an empty frame (decoration only).
const emptyFrame = Object.assign(document.createElement('div'), { className: 'emptyframe' })
emptyFrame.setAttribute('aria-hidden', 'true')
for (const c of ['tl', 'tr', 'bl', 'br']) emptyFrame.append(Object.assign(document.createElement('span'), { className: `corner ${c}` }))
for (const c of ['pt', 'pl', 'pr']) emptyFrame.append(Object.assign(document.createElement('span'), { className: `plus ${c}`, textContent: '+' }))
emptyHint.append(
  emptyFrame,
  Object.assign(document.createElement('h3'), { className: 'display-title', textContent: 'Start a creation' }),
  Object.assign(document.createElement('p'), {
    textContent: AI_ENABLED
      ? 'Upload a reference, try a sample, draw one with the code generator, describe your idea to AI in the Idea panel, or place shapes on the black background.'
      : 'Upload a reference, try a sample, draw one with the code generator, or place shapes on the black background.',
  }),
  startRow,
)
stage.append(emptyHint)
const updateEmptyState = () => {
  emptyHint.hidden = slots.A.kind !== 'none' || params.frames.length > 0
}

// Physical print size (cm) x resolution -> export pixels. The preview frame only uses the cm aspect.
const frameDims = () => [params.printW, params.printH]
const parseSize = () => [cmToPx(params.printW, params.dpi), cmToPx(params.printH, params.dpi)]
const syncCmFromSize = () => {
  if (params.size === 'custom') return
  let [w, h] = sizeToCm(params.size)
  // A format is the same in portrait and landscape: keep the orientation the user already has.
  const landscape = params.printW > params.printH
  const portrait = params.printW < params.printH
  if ((landscape && w < h) || (portrait && w > h)) [w, h] = [h, w]
  ;[params.printW, params.printH] = [w, h]
  ui?.refresh()
}
const nextFrame = () => new Promise((r) => setTimeout(r, 0))

// ---------------- Sources ----------------
// A: { kind: 'code' | 'ai' | 'upload' | 'sample', src, label, codeSide }   B: same or null
// A picture slot with nothing in it yet. The stage still works on a blank background, so photo frames can be drawn on it.
const blankSource = () => sourceFromGray(new Float32Array(64 * 64), 64, 64, 'nothing loaded')
const emptySlot = () => ({ kind: 'none', src: blankSource(), label: 'nothing loaded', codeSide: 0 })
const slots = { A: emptySlot(), B: null }
let codeDirty = true
let exporting = false
const sampleCursor = { A: 0, B: 1 }
let frameSampleCursor = 2

const FORM_LABEL = { bloom: 'Bloom', reliquary: 'Reliquary', medusa: 'Medusa' }
const isCode = () => slots.A.kind === 'code'

// ---- code generator -> picture ----
const CODE_KEYS = GROUPS.filter((g) => g.section === 'code').flatMap((g) => g.controls.map((c) => c.key))
const CAMERA_KEYS = new Set(['pitch', 'yaw', 'spin', 'zoom', 'perspective', 'lineWidth', 'genExposure', 'membrane', 'fog', 'focus', 'focusDepth'])
const GEOMETRY_KEYS = CODE_KEYS.filter((k) => !CAMERA_KEYS.has(k))
let structCache = { key: '', structure: null }

function generate(p) {
  return p.form === 'reliquary' ? generateReliquary(p) : p.form === 'medusa' ? generateMedusa(p) : generateStructure(p)
}

function getStructure() {
  const key = [params.form, params.seed, ...GEOMETRY_KEYS.map((k) => params[k])].join('|')
  if (structCache.key !== key) structCache = { key, structure: generate(params) }
  return structCache.structure
}

// Render the code generator at the frame aspect, `side` px on the long edge.
function renderCode(side, p = params, structure = null) {
  const ew = p.printW
  const eh = p.printH
  const k = side / Math.max(ew, eh)
  const W = Math.max(64, Math.round(ew * k))
  const H = Math.max(64, Math.round(eh * k))
  const r = renderStructure(structure || getStructure(), p, W, H)
  return sourceFromGray(r.gray, W, H, 'Code: ' + FORM_LABEL[p.form])
}

// Every source starts clean: the plain artwork, no filaments / relief / glow on top. Turn them on in the panels.
function applyLook() {
  Object.assign(params, { strands: 0, photoMix: 1, xDepth: 0, glow: 0 })
}

// Back to the plain default: every transform / filament / tone / cyanotype control returns to its default value.
function resetAdjustments() {
  const d = defaults()
  for (const k of ADJUST_KEYS) params[k] = d[k]
}

function refreshSlotUI(id) {
  const s = slots[id]
  if (!s) return ui.setSlot(id, null, 'none')
  if (s.kind === 'none') return ui.setSlot(id, null, 'nothing loaded')
  ui.setSlot(id, s.src ? thumbUrl(s.src) : null, s.kind === 'code' ? `Code: ${FORM_LABEL[params.form]}${id === 'A' ? ' (live)' : ''}` : s.label)
}

function setSlot(id, slot) {
  slots[id] = slot
  if (id === 'A') {
    ui.setCodeVisible(slot?.kind === 'code')
    if (slot?.kind === 'code') codeDirty = true
  }
  refreshSlotUI(id)
  updateEmptyState()
}

// ---- remove background (bgdialog.js): pictures A / B and the pictures cut into shapes ----
// The cut-out is applied in place and stays editable: the picture keeps the original (`bgOrig`) and the model's mask
// (`bgMatte`), so reopening the dialog is instant and "Restore original" brings the plain picture back.
const NOBG = ' · no background'
const uncutLabel = (label) => String(label || '').replace(NOBG, '')

// Pictures A / B are plain grayscale maps with black = nothing, so the cut-out is baked in: subject over black.
function bakeCut(base, alpha) {
  const gray = new Float32Array(base.gray.length)
  for (let i = 0; i < gray.length; i++) gray[i] = base.gray[i] * alpha[i]
  return gray
}

async function removeBgSlot(id) {
  const s = slots[id]
  if (!s || s.kind === 'none') return
  const live = s.kind === 'code' // the live generator is frozen into a picture when the cut-out is applied
  const src = live ? renderCode(CODE_FULL_SIDE) : s.src
  if (!src) return
  const label0 = live ? 'Code: ' + FORM_LABEL[params.form] : s.label
  const out = await openBgRemove({
    src,
    title: 'Remove background',
    name: uncutLabel(label0),
    note: live ? 'The code generator will be frozen into a picture. Press Code to bring the live generator back.' : '',
  })
  if (!out) return
  const label = uncutLabel(label0) + (out.kind === 'apply' ? NOBG : '')
  const pic =
    out.kind === 'apply'
      ? { ...out.base, gray: bakeCut(out.base, out.alpha), label, bgOrig: out.base, bgMatte: out.matte, bgState: out.state }
      : { ...out.base, label }
  setSlot(id, { ...s, kind: live ? 'upload' : s.kind, src: pic, label })
  ui.refresh()
  request('base')
  ui.setStatus(out.kind === 'apply' ? 'Background removed' : 'Original picture restored')
}

// In a shape the cut-out is a real mask: what was background lets the layers below show through.
async function removeBgShapePicture(frameId) {
  const cur = frameImages.get(frameId)
  if (!cur) return
  const out = await openBgRemove({ src: cur, title: 'Remove background', name: uncutLabel(cur.label) })
  if (!out) return
  const label = uncutLabel(cur.label) + (out.kind === 'apply' ? NOBG : '')
  frameImages.set(
    frameId,
    out.kind === 'apply'
      ? { ...out.base, alpha: out.alpha, label, bgOrig: out.base, bgMatte: out.matte, bgState: out.state }
      : { ...out.base, label },
  )
  ui.rebuildFrames()
  request('base')
  ui.setStatus(out.kind === 'apply' ? 'Background removed' : 'Original picture restored')
}

// Start with nothing loaded: the user picks Upload, Sample or Code. Params get the Lotus look that Code uses.
function startEmpty() {
  Object.assign(params, PRESETS['Lotus bloom'])
  applyLook()
  setSlot('A', emptySlot())
  ui.refresh()
  fitCanvas()
  updateExportInfo()
  request('base')
}

function applyPreset(name) {
  Object.assign(params, PRESETS[name]) // presets never change the print size (cm), that is chosen by the user
  applyLook()
  setSlot('A', { kind: 'code', src: null, label: '', codeSide: 0 })
  ui.refresh()
  fitCanvas()
  updateExportInfo()
  request('source')
}

// ---------------- UI ----------------
const ui = createUI(panel, params, {
  onParam(key, stageName) {
    if (key === 'size') {
      if (params.size === 'custom') return updateExportInfo()
      syncCmFromSize()
    } else if (key === 'printW' || key === 'printH') {
      ui.set('size', sizeKeyFromCm(params.printW, params.printH))
    }
    if (key === 'size' || key === 'printW' || key === 'printH') {
      codeDirty = true
      fitCanvas()
      updateExportInfo()
      ui.rebuildFrames() // frame sliders are sized from the print size
      return request('source')
    }
    if (key === 'output' || key === 'dpi' || key === 'bitDepth') return updateExportInfo()
    if (stageName === 'info') return
    if (stageName === 'source' && !isCode()) stageName = 'base'
    request(stageName)
  },
  onForm(form) {
    params.form = form
    applyPreset(FORM_DEFAULT_PRESET[form])
  },
  onPreset: applyPreset,
  onNewSeed() {
    ui.set('seed', Math.floor(Math.random() * 9999) + 1)
    request(isCode() ? 'source' : 'base')
  },
  onRandomize: randomize,
  async onImage(id, action, file) {
    try {
      if (action === 'bg') return await removeBgSlot(id)
      if (action === 'file') {
        const src = await sourceFromFile(file)
        setSlot(id, { kind: 'upload', src, label: file.name })
        if (id === 'A') resetAdjustments()
      } else if (action === 'sample') {
        const name = SAMPLE_PRESETS[sampleCursor[id]++ % SAMPLE_PRESETS.length]
        const p = { ...defaults(), ...PRESETS[name], printW: params.printW, printH: params.printH }
        const src = renderCode(1024, p, generate(p))
        setSlot(id, { kind: 'sample', src, label: 'Sample: ' + name })
        if (id === 'A') resetAdjustments()
      } else if (action === 'code') {
        if (id === 'A') {
          setSlot('A', { kind: 'code', src: null, label: '', codeSide: 0 })
          resetAdjustments()
        } else {
          setSlot('B', { kind: 'code', src: renderCode(1024), label: 'Code: ' + FORM_LABEL[params.form] })
        }
      } else {
        setSlot(id, null)
      }
      ui.refresh()
      request('base')
    } catch (err) {
      console.error(err)
      ui.setAIMessage('Could not read that image: ' + err.message, 'err')
    }
  },
  async onAI(action, id, { prompt, quality, cyano }) {
    if (!AI_ENABLED) return ui.setAIMessage(AI_SOON_SHORT, 'soon') // coming soon: nothing is sent
    prompt = (prompt || '').trim()
    if (action === 'refine' && slots.A.kind === 'none') return ui.setAIMessage('Nothing to vary yet: generate or load a picture first.', 'warn')
    if (action === 'refine' && !prompt) prompt = REFINE_PROMPT
    if (!prompt) return ui.setAIMessage('Write a prompt first (or pick one of the ideas).', 'warn')
    if (cyano && action === 'generate') prompt += CYANO_SUFFIX
    const [ew, eh] = frameDims()
    const size = Math.abs(ew / eh - 1) < 0.15 ? '1024x1024' : ew > eh ? '1536x1024' : '1024x1536'
    ui.setAIBusy(true, action === 'refine' ? 'Sending the current result to OpenAI… (can take a minute)' : 'Generating with OpenAI… (can take a minute)')
    try {
      const url =
        action === 'generate'
          ? await aiGenerate(prompt, size, quality)
          : await aiEdit(prompt, (await renderResult(...fitSize(1024), 'mono')).toDataURL('image/png'), size, quality)
      const src = await sourceFromUrl(url, 'AI', { edgeFade: false })
      setSlot(id, { kind: 'ai', src, label: 'AI: ' + prompt.slice(0, 30) + '…' })
      if (id === 'A') resetAdjustments()
      ui.refresh()
      request('base')
      ui.setAIBusy(false, `Done. Loaded as picture ${id}. Shape it with the controls below.`)
    } catch (err) {
      console.error(err)
      ui.setAIBusy(false)
      ui.setAIMessage(err.message, 'err')
    }
  },
  frames: {
    onChange: () => request('base'),
    onSelect: () => showGuide(true), // picked in the list: show its guide on the preview
    onAdd(shape, fill = 'photo') {
      const n = params.frames.length
      const f = newFrame(params, shape, { x: ((n % 5) - 2) * 2, y: ((n % 5) - 2) * 1.5, fill })
      params.frames.push(f)
      // Solid shapes on an empty canvas belong on the black background: show the Original view, where the background is black.
      if (fill === 'solid' && slots.A.kind === 'none') ui.set('preview', 'mono')
      ui.openFrame(f.id)
      ui.rebuildFrames()
      showGuide(true) // the new shape comes selected, with its handles
      request('base')
      ui.setStatus(
        fill === 'solid'
          ? 'Solid shape added on the black background · pick it in the list to change its tone, size or position'
          : 'Photo shape added · give it a picture with Upload, Sample or Code (Layers tab)',
      )
    },
    onLayout(name) {
      const old = params.frames
      const cfgs = FRAME_LAYOUTS[name](params.printW, params.printH)
      params.frames = cfgs.map((c, i) => (old[i] ? sanitizeFrame({ ...old[i], ...c }) : newFrame(params, c.shape, c)))
      ui.rebuildFrames()
      request('base')
      ui.setStatus(`Layout "${name}" · pick each shape in the list (Shapes & photos) to set its tone or picture`)
    },
    onClear() {
      params.frames = []
      ui.rebuildFrames()
      request('base')
    },
    onRemove(id) {
      params.frames = params.frames.filter((f) => f.id !== id)
      ui.rebuildFrames()
      request('base')
    },
    onDuplicate(id) {
      const i = params.frames.findIndex((f) => f.id === id)
      if (i < 0) return
      const src = params.frames[i]
      const copy = sanitizeFrame({ ...src, id: undefined, x: src.x + 1.5, y: src.y + 1.5 })
      if (frameImages.has(id)) frameImages.set(copy.id, frameImages.get(id))
      params.frames.splice(i + 1, 0, copy)
      ui.openFrame(copy.id)
      ui.rebuildFrames()
      showGuide(true)
      request('base')
    },
    async onImage(id, action, file) {
      try {
        let src
        if (action === 'bg') return await removeBgShapePicture(id)
        if (action === 'file') src = await sourceFromFile(file, { edgeFade: false })
        else if (action === 'sample') {
          const name = SAMPLE_PRESETS[frameSampleCursor++ % SAMPLE_PRESETS.length]
          const p = { ...defaults(), ...PRESETS[name], printW: params.printW, printH: params.printH }
          src = { ...renderCode(1024, p, generate(p)), label: 'Sample: ' + name }
        } else src = renderCode(1024)
        frameImages.set(id, src)
        ui.rebuildFrames()
        request('base')
      } catch (err) {
        console.error(err)
        ui.setStatus('Could not read that image: ' + err.message)
      }
    },
  },
  onExport: (format) => exportImage(format),
  onCyanoReset() {
    const d = defaults()
    for (const k of CYANO_KEYS) params[k] = d[k]
    ui.refresh()
    request('post')
  },
  onUndo: undo,
  onRedo: redo,
  onCopySettings: copySettings,
  async onPasteSettings() {
    try {
      if (!pasteSettings(await navigator.clipboard.readText())) ui.setStatus('The clipboard has no Cyano Creator settings. Copy some first.')
    } catch {
      ui.setStatus('Paste blocked by the browser: click the page, then press ⌘V')
    }
  },
  onResetAll() {
    resetAdjustments()
    params.frames = []
    ui.refresh()
    updateExportInfo()
    request('base')
    ui.setStatus('Everything back to default · ⌘Z undoes it')
  },
  onCleanSetup() {
    const d = defaults()
    for (const k of CLEAN_KEYS) params[k] = d[k]
    params.preview = 'negative'
    params.output = 'negative'
    ui.refresh()
    updateExportInfo()
    request('base')
  },
})

aiStatus().then((st) => ui.setAI(st))

// Optional readings drawn over the picture. They never change its shape. See measure.js.
let readings = null
const afterUpload = panel.querySelector('[data-sect="frames"]') || panel.firstElementChild
afterUpload.after(
  createDataPanel({
    onReadings(r) {
      readings = r
      if (r && params.measure < 0.01) ui.set('measure', 0.8) // off by default; loading data turns it on
      request('base')
    },
  }),
)

function randomize() {
  if (isCode()) {
    Object.assign(params, randomPreset(Math.random, params.form))
    ui.refresh()
    request('source')
  } else {
    Object.assign(params, randomTransform(Math.random))
    ui.refresh()
    request('base')
  }
}

function updateExportInfo() {
  const [w, h] = parseSize()
  const dpi = Number(params.dpi)
  const tooBig = w * h > MAX_EXPORT_PIXELS
  const what =
    params.output === 'negative' ? 'digital negative' : params.output === 'simulation' ? 'cyanotype simulation (RGB)' : 'original artwork'
  const depth = params.output === 'simulation' ? '8-bit RGB' : `${params.bitDepth}-bit gray`
  // (the transparent PNG is always 8-bit gray + alpha)
  ui.setExportInfo(
    `${params.printW} × ${params.printH} cm at ${dpi} dpi → ${w} × ${h} px · ${((w * h) / 1e6).toFixed(1)} MP · ${what}, ${depth}` +
      (tooBig ? ` — over the ${MAX_EXPORT_PIXELS / 1e6} MP limit: reduce the size or the dpi` : ''),
  )
  ui.setExportWarning(tooBig)
}

window.addEventListener('keydown', (e) => {
  if (e.altKey) return
  const typing = isTyping(e.target)
  if ((e.metaKey || e.ctrlKey) && !typing) {
    const k = e.key.toLowerCase()
    if (k === 'z') {
      e.preventDefault()
      return e.shiftKey ? redo() : undo()
    }
    if (k === 'y' && e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      return redo()
    }
    if (k === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault()
      return copySettings()
    }
    return
  }
  if (e.metaKey || e.ctrlKey || typing) return
  if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
  if (e.key === 'r' || e.key === 'R') randomize()
  else if (e.key === 'e' || e.key === 'E') exportImage('png')
  else if (e.key === 'h' || e.key === 'H') setHand(!hand)
  else if ((e.key === 'o' || e.key === 'O') && params.frames.length) setOverlayTool(!ovMode)
  else if (e.key === 'Escape' && guide?.isVisible()) showGuide(false) // deselect
  else if (e.key === '1' || e.key === '2' || e.key === '3') {
    ui.set('preview', ['mono', 'negative', 'cyanotype'][Number(e.key) - 1])
    request('post')
  }
})

window.addEventListener('paste', (e) => {
  if (isTyping(e.target)) return
  const text = e.clipboardData?.getData('text/plain')
  if (text && pasteSettings(text)) e.preventDefault()
})

// ---------------- Rendering ----------------
// Frame size (W, H) for a given long side, in the export aspect.
function fitSize(longSide) {
  const [ew, eh] = frameDims()
  const k = longSide / Math.max(ew, eh)
  return [Math.max(64, Math.round(ew * k)), Math.max(64, Math.round(eh * k))]
}

const LEVEL = { post: 0, base: 1, source: 2 }
let needLevel = -1
let raf = 0
let fullTimer = 0
let cache = null // { acc, W, H, draft }
let view = null // { canvas, ms, draft }
let sketch = null

function request(stageName) {
  scheduleHistory()
  const lv = LEVEL[stageName] ?? 1
  if (lv === LEVEL.source && isCode()) codeDirty = true
  needLevel = Math.max(needLevel, lv === LEVEL.source && !isCode() ? LEVEL.base : lv)
  clearTimeout(fullTimer)
  if (!raf) raf = requestAnimationFrame(tick)
}

function previewMode() {
  return params.preview === 'cyanotype' ? 'cyanotype' : params.preview === 'negative' ? 'negative' : 'mono'
}

function ensureCodeSource(side) {
  if (!isCode()) return
  const A = slots.A
  if (codeDirty || !A.src || A.codeSide < side) {
    A.src = renderCode(side)
    A.codeSide = side
    codeDirty = false
    A.thumbPending = true
  }
}

function computeBase(draft) {
  const t0 = performance.now()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const side = draft ? DRAFT_SIDE : clamp(Math.round(Math.max(stage.clientWidth, stage.clientHeight) * dpr), 700, 1600)
  ensureCodeSource(draft ? CODE_DRAFT_SIDE : CODE_FULL_SIDE)
  const [W, H] = fitSize(side)
  const { G, sampler, aspect } = samplePicture(params, slots.A.src, slots.B?.src || null, W, H)
  const fil = filamentLayer(params, sampler, aspect, W, H)
  const acc = composeBase(params, G, fil, W, H)
  applyMeasures(acc, G, params, readings, W, H)
  cache = { acc, W, H, draft }
  return performance.now() - t0
}

function present() {
  const t0 = performance.now()
  updateEmptyState()
  updateOverlayTool()
  updateGuide()
  const img = postProcess(params, cache.acc, cache.W, cache.H, previewMode())
  view = { canvas: imageDataToCanvas(img), draft: cache.draft }
  sketch?.redraw()
  const A = slots.A
  if (A.thumbPending && !cache.draft) {
    A.thumbPending = false
    refreshSlotUI('A')
  }
  ui.setStatus(
    `${isCode() ? 'Code source' : slots.A.label} · preview ${cache.W}×${cache.H}${cache.draft ? ' (draft)' : ''} · post ${(performance.now() - t0).toFixed(0)} ms`,
  )
}

function tick() {
  raf = 0
  if (exporting) {
    needLevel = -1
    return
  }
  const lv = needLevel
  needLevel = -1
  if (lv < 0) return
  try {
    if (lv === LEVEL.post && cache) present()
    else {
      computeBase(true)
      present()
    }
  } catch (err) {
    console.error(err)
    ui.setStatus('Render error: ' + err.message)
  }
  fullTimer = setTimeout(upgrade, 320)
}

function upgrade() {
  if (exporting) return
  const codeStale = isCode() && slots.A.codeSide < CODE_FULL_SIDE
  if (cache && !cache.draft && !codeStale) return
  try {
    const ms = computeBase(false)
    present()
    ui.setStatus(`${isCode() ? 'Code source' : slots.A.label} · preview ${cache.W}×${cache.H} · built in ${ms.toFixed(0)} ms`)
  } catch (err) {
    console.error(err)
    ui.setStatus('Render error: ' + err.message)
  }
}

// Full pipeline at an arbitrary frame size (export, AI refine, tests) -> Float32 map for `mode`
// ('mono' = original artwork, 'negative' = digital negative, 'cyanotype' = negative that gets simulated).
async function renderFloat(W, H, mode, onStep) {
  const step = async (frac, label) => {
    if (onStep) await onStep(frac, label)
  }
  await step(0.05, 'Rendering source at output resolution…')
  let A = slots.A.src
  if (isCode()) {
    A = renderCode(Math.max(512, Math.min(8192, Math.max(W, H))))
  }
  await step(0.25, 'Transforming…')
  let { G, sampler, aspect } = samplePicture(params, A, slots.B?.src || null, W, H)
  await step(0.5, 'Filaments…')
  let fil = filamentLayer(params, sampler, aspect, W, H)
  await step(0.65, 'Compositing…')
  let acc = composeBase(params, G, fil, W, H)
  applyMeasures(acc, G, params, readings, W, H)
  G = fil = sampler = null
  await step(0.8, mode === 'mono' ? 'Tone & print…' : 'Cyanotype processing…')
  const out = processLayers(params, acc, W, H, mode)
  acc = null
  return out
}

async function renderResult(W, H, mode, onStep) {
  return imageDataToCanvas(floatToImageData(await renderFloat(W, H, mode, onStep), W, H, mode))
}

const OUTPUT_MODE = { negative: 'negative', positive: 'mono', simulation: 'cyanotype' }

async function exportImage(format = 'png') {
  if (exporting) return
  if (slots.A.kind === 'none' && !params.frames.length) {
    return alert('Nothing to export yet: upload a picture or use the Code generator first.')
  }
  const [W, H] = parseSize()
  if (W * H > MAX_EXPORT_PIXELS) {
    alert(`Export is limited to ${MAX_EXPORT_PIXELS / 1e6} megapixels (${W} × ${H} px requested). Reduce the print size or the dpi.`)
    return
  }
  exporting = true
  const dpi = Number(params.dpi)
  // 'png-alpha': PNG with the main background removed (transparent). The cyanotype simulation has no single background
  // to remove, so that content falls back to the original artwork.
  const transparent = format === 'png-alpha'
  if (transparent) format = 'png'
  const mode = transparent ? (params.output === 'negative' ? 'negative' : 'mono') : OUTPUT_MODE[params.output] || 'negative'
  try {
    let f = await renderFloat(W, H, mode, async (frac, label) => {
      ui.setProgress(frac, label)
      await nextFrame()
    })
    ui.setProgress(0.88, `Encoding ${format.toUpperCase()}…`)
    await nextFrame()

    // Pixels only: no UI, borders or watermark.
    let img
    if (transparent) {
      img = { data: toInkAlpha8(f, { invert: mode === 'negative', cut: Number(params.pngCut) || 0 }), channels: 2, depth: 8 }
    } else if (mode === 'cyanotype') {
      const rgb = new Uint8Array(W * H * 3)
      simulatePrint(f, rgb, 3)
      img = { data: rgb, channels: 3, depth: 8 }
    } else if (params.bitDepth === '16') {
      img = { data: toGray16(f), channels: 1, depth: 16 }
    } else {
      img = { data: toGray8(f), channels: 1, depth: 8 }
    }
    f = null
    const spec = { ...img, width: W, height: H, dpi }
    const blob = format === 'tiff' ? encodeTIFF(spec) : await encodePNG(spec)
    const tag = transparent
      ? (mode === 'negative' ? 'digital-negative' : 'original') + '-transparent'
      : params.output === 'negative' ? 'digital-negative' : params.output === 'simulation' ? 'cyanotype-simulation' : 'original'
    download(blob, `cyanotype-seed${params.seed}-${tag}-${params.printW}x${params.printH}cm-${dpi}dpi-${W}x${H}.${format}`)
  } catch (err) {
    console.error(err)
    alert('Export failed: ' + err.message)
  } finally {
    exporting = false
    ui.setProgress(null)
    request('post')
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ---------------- p5 canvas host (static drawing, no animation loop) ----------------
function fitCanvas() {
  if (!sketch) return
  const [ew, eh] = frameDims()
  const aw = Math.max(200, stage.clientWidth - 32)
  const ah = Math.max(200, stage.clientHeight - 32)
  const k = Math.min(aw / ew, ah / eh)
  const w = Math.max(100, Math.floor(ew * k))
  const h = Math.max(100, Math.floor(eh * k))
  if (w !== sketch.width || h !== sketch.height) {
    sketch.resizeCanvas(w, h)
    sketch.redraw()
  }
  requestAnimationFrame(updateGuide) // the guide sits over the canvas, wherever the layout put it
}

// ---- Hand tool: drag on the preview to move the picture (xPanX / xPanY). Works for pictures and code sources. ----
let hand = false

function setHand(on) {
  hand = on
  if (on && ovMode) setOverlayTool(false)
  handBtn.classList.toggle('on', on)
  handBtn.setAttribute('aria-pressed', String(on))
  stage.classList.toggle('hand', on || ovMode)
}

// ---- Overlay tool: drag the preview to move the selected overlay photo, scroll to make it bigger or smaller. ----
let ovMode = false
const selectedOverlay = () => params.frames.find((f) => f.id === ui.selectedFrame())

function setOverlayTool(on) {
  ovMode = on
  if (on && hand) setHand(false)
  overlayBtn.classList.toggle('on', on)
  overlayBtn.setAttribute('aria-pressed', String(on))
  stage.classList.toggle('hand', on || hand)
}

// ---- Selection guide (guide.js): box + handles around the selected shape, to resize / stretch / rotate it ----
let guide = null
const guidedFrame = () => {
  const f = selectedOverlay()
  return f && f.visible !== false && (f.fill === 'solid' || frameImages.has(f.id)) ? f : null // only shapes that are drawn
}
const updateGuide = () => guide?.update()
function showGuide(on) {
  guide?.setVisible(on)
}

// The tool only makes sense while there is an overlay to move.
function updateOverlayTool() {
  overlayBtn.hidden = !params.frames.length
  if (!params.frames.length && ovMode) setOverlayTool(false)
}

const handBtn = Object.assign(document.createElement('button'), {
  type: 'button',
  className: 'handbtn',
  textContent: '✋ Hand',
  title: 'Hand tool (H): drag a shape to move it, or drag the background to move the picture',
})
handBtn.addEventListener('click', () => setHand(!hand))
const overlayBtn = Object.assign(document.createElement('button'), {
  type: 'button',
  className: 'overlaybtn',
  textContent: '▣ Overlay',
  title: 'Overlay tool (O): drag the preview to move the selected overlay, scroll to resize it',
  hidden: true,
})
overlayBtn.addEventListener('click', () => setOverlayTool(!ovMode))
const centerBtn = Object.assign(document.createElement('button'), {
  type: 'button',
  textContent: 'Center',
  title: 'Put the picture back in the centre of the frame',
})
centerBtn.addEventListener('click', () => {
  ui.set('xPanX', 0)
  ui.set('xPanY', 0)
  request('base')
})
const stageTools = document.createElement('div')
stageTools.className = 'stagetools'
stageTools.append(handBtn, overlayBtn, centerBtn)
stage.append(stageTools)

const startSketch = () =>
  new p5((s) => {
    s.setup = () => {
      s.pixelDensity(1)
      s.noLoop()
      const [ew, eh] = frameDims()
      const k = Math.min((stage.clientWidth - 32) / ew, (stage.clientHeight - 32) / eh)
      const cnv = s.createCanvas(Math.max(100, Math.floor(ew * k)), Math.max(100, Math.floor(eh * k)))
      cnv.parent(stage)
      sketch = s

      new ResizeObserver(() => {
        fitCanvas()
        request('post')
      }).observe(stage)

      // Drag / wheel act on the current source: camera for code, parallax and zoom for pictures.
      let drag = null
      let grab = null // the overlay being dragged with the Hand / Overlay tool
      guide = createGuide({
        stage,
        canvas: cnv.elt,
        params,
        frame: guidedFrame,
        onChange: () => {
          ui.syncFrames() // the editor's sliders follow
          request('base')
        },
        onStart: () => stage.classList.add('panning'),
        onEnd: () => stage.classList.remove('panning'),
      })
      let downAt = null // where a press began on empty background (a click there hides the guide)
      cnv.elt.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY }
        grab = null
        downAt = null
        cnv.elt.setPointerCapture(e.pointerId)
        // Pressing a shape (top-most first) selects it and shows its guide; dragging then moves it, in every tool.
        // Pressing the background: the Hand moves the picture, the Overlay tool keeps the selected shape, otherwise the camera.
        const r = cnv.elt.getBoundingClientRect()
        const k = params.printH / r.height // cm per screen pixel
        const hit = hitFrame(params.frames, (e.clientX - r.left - r.width / 2) * k, (e.clientY - r.top - r.height / 2) * k)
        if (hit) {
          grab = hit
          if (ui.selectedFrame() !== hit.id) {
            ui.openFrame(hit.id)
            ui.rebuildFrames()
          }
          showGuide(true)
        } else {
          if (ovMode) grab = selectedOverlay() || null // Overlay tool: keep moving the selected one
          downAt = { x: e.clientX, y: e.clientY }
        }
        if (hand || ovMode || grab) stage.classList.add('panning')
      })
      cnv.elt.addEventListener('pointermove', (e) => {
        if (!drag) return
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        drag = { x: e.clientX, y: e.clientY }
        if (grab) {
          const f = grab
          const k = params.printH / cnv.elt.clientHeight // cm per screen pixel, so the shape sticks to the cursor
          f.x = clamp(Math.round((f.x + dx * k) * 100) / 100, -params.printW, params.printW)
          f.y = clamp(Math.round((f.y + dy * k) * 100) / 100, -params.printH, params.printH)
          ui.syncFrames()
          updateGuide()
          request('base')
        } else if (ovMode) {
          // Overlay tool with nothing to move
        } else if (hand) {
          // Frame space spans 2 units over the canvas height, so the picture sticks to the cursor.
          const k = 2 / cnv.elt.clientHeight
          ui.set('xPanX', clamp(params.xPanX + dx * k, -2, 2))
          ui.set('xPanY', clamp(params.xPanY + dy * k, -2, 2))
          request('base')
        } else if (isCode()) {
          ui.set('yaw', ((((params.yaw + dx * 0.4 + 180) % 360) + 360) % 360) - 180)
          ui.set('pitch', clamp(params.pitch + dy * 0.4, -90, 90))
          request('source')
        } else {
          ui.set('xYaw', clamp(params.xYaw + dx * 0.3, -60, 60))
          ui.set('xTilt', clamp(params.xTilt + dy * 0.3, -60, 60))
          request('base')
        }
      })
      const end = (e) => {
        // A plain click on the empty background (no drag) deselects: the guide goes away.
        if (downAt && e?.type === 'pointerup' && !hand && !ovMode && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4) showGuide(false)
        downAt = null
        drag = null
        grab = null
        stage.classList.remove('panning')
      }
      cnv.elt.addEventListener('pointerup', end)
      cnv.elt.addEventListener('pointercancel', end)
      cnv.elt.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault()
          const ov = ovMode && selectedOverlay()
          if (ov) {
            ov.scale = clamp(Math.round(ov.scale * Math.exp(-e.deltaY * 0.001) * 1000) / 1000, 0.05, 3)
            ui.syncFrames()
            updateGuide()
            request('base')
          } else if (isCode()) {
            ui.set('zoom', clamp(params.zoom * Math.exp(-e.deltaY * 0.001), 0.4, 2.5))
            request('source')
          } else {
            ui.set('xZoom', clamp(params.xZoom * Math.exp(-e.deltaY * 0.001), 0.4, 3))
            request('base')
          }
        },
        { passive: false },
      )

      startEmpty()
    }

    s.draw = () => {
      s.background(0)
      if (!view) return
      const ctx = s.drawingContext
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(view.canvas, 0, 0, s.width, s.height)
    }
  }, stage)

p5.disableFriendlyErrors = true
startSketch()
updateExportInfo()

// Handy for debugging / automated checks.
window.__bloom = {
  params,
  ui,
  presets: PRESETS,
  slots,
  apply(obj) {
    Object.assign(params, obj)
    ui.refresh()
    codeDirty = true
    request(isCode() ? 'source' : 'base')
  },
  preset: applyPreset,
  async loadUrl(id, url, label = 'test') {
    setSlot(id, { kind: 'upload', src: await sourceFromUrl(url, label, { edgeFade: true }), label })
    if (id === 'A') resetAdjustments()
    ui.refresh()
    request('base')
  },
  async snapshot(W, H, mode = 'mono') {
    return (await renderResult(W, H, mode)).toDataURL('image/png')
  },
  exportImage,
  view: () => view?.canvas.toDataURL('image/png'),
}
