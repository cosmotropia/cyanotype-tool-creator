// Optional: paste numbers and they are drawn over the picture as readings. See measure.js.
// Nothing here changes the picture's shape.

import { analyze, demoCsv } from './dataflow.js'

const CAP = 8000

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

/** onReadings(null | { values: Float32Array, label, features }) */
export function createDataPanel({ onReadings }) {
  const area = el('textarea', {
    rows: 5,
    'aria-label': 'Readings',
    placeholder: 'time,ax,ay,az\n0.00,0.12,-0.98,0.05\n…\n\nCSV, TSV, ;-separated, JSON or plain numbers.\nThese are written on the picture; they never reshape it.',
  })
  const msg = el('div', { class: 'hint ai-msg' })
  const file = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.json', hidden: '' })

  const setMsg = (text, kind = 'ok') => {
    msg.textContent = text
    msg.dataset.kind = kind
  }

  function use(text) {
    try {
      const a = analyze(text)
      let flat = a.cols.flat()
      if (flat.length > CAP) {
        const stride = Math.ceil(flat.length / CAP)
        flat = flat.filter((_, i) => i % stride === 0)
      }
      onReadings({ values: Float32Array.from(flat), label: a.labels.join(' · '), features: a.features })
      setMsg(`${a.n} samples · ${a.labels.join(', ')} · drawn on the picture`)
    } catch (err) {
      setMsg(err.message, 'err')
    }
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    area.value = await f.text()
    use(area.value)
  })

  return el('div', { class: 'block datablock' }, [
    el('h2', { text: '1b · Readings (optional)' }),
    el('div', {
      class: 'hint',
      text: 'Paste sensor data or a trajectory and it is written over the picture as numbers, with dimension lines around the subject. The picture stays as it is. Amount, density and the grid are in Measurements below.',
    }),
    area,
    el('div', { class: 'row2 wrap' }, [
      el('button', { type: 'button', class: 'primary', text: 'Show on picture', onclick: () => use(area.value) }),
      el('button', { type: 'button', text: 'Load file', title: '.csv .tsv .txt .json', onclick: () => file.click() }),
      el('button', { type: 'button', text: 'Demo: sensor', onclick: () => { area.value = demoCsv('sensor'); use(area.value) } }),
      el('button', { type: 'button', text: 'Demo: trajectory', onclick: () => { area.value = demoCsv('trajectory'); use(area.value) } }),
      el('button', { type: 'button', text: 'Clear', onclick: () => { onReadings(null); setMsg('Readings cleared. The field shows distance from the centre.') } }),
    ]),
    file,
    msg,
  ])
}
