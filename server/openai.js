// Tiny dev/preview middleware that proxies image requests to OpenAI.
//
// The API key is read on the server from `.env` (OPENAI_API_KEY) and is never sent to the browser.
// Endpoints:
//   GET  /api/openai/status    -> { configured, model }
//   POST /api/openai/generate  -> { prompt, size?, quality? }            => { image: "data:image/png;base64,..." }
//   POST /api/openai/edit      -> { prompt, image (data URL), size?, quality? } => { image: ... }

import { loadEnv } from 'vite'

const API = 'https://api.openai.com/v1'
const MAX_BODY = 30 * 1024 * 1024

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function callOpenAI(url, init, key) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 240_000)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { ...(init.headers || {}), Authorization: `Bearer ${key}` } })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = json?.error?.message || `OpenAI returned HTTP ${r.status}`
      const err = new Error(msg)
      err.status = r.status
      throw err
    }
    const b64 = json?.data?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI response contained no image data')
    return `data:image/png;base64,${b64}`
  } finally {
    clearTimeout(timer)
  }
}

export function openaiProxy() {
  let env = {}

  const handler = async (req, res, next) => {
    if (!req.url || !req.url.startsWith('/api/openai/')) return next()
    const route = req.url.split('?')[0]
    const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY
    const model = env.OPENAI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'

    try {
      if (route === '/api/openai/status' && req.method === 'GET') {
        return send(res, 200, { configured: Boolean(key), model })
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
      if (!key) {
        return send(res, 400, { error: 'OPENAI_API_KEY is not set. Add it to biomechanical-art/.env and restart the dev server.' })
      }
      const body = await readJson(req)
      const prompt = String(body.prompt || '').trim()
      if (!prompt) return send(res, 400, { error: 'Prompt is empty' })
      const size = ['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(body.size) ? body.size : '1024x1024'
      const quality = ['low', 'medium', 'high', 'auto'].includes(body.quality) ? body.quality : 'medium'

      if (route === '/api/openai/generate') {
        const payload = { model, prompt, size, quality, n: 1 }
        if (model.startsWith('dall-e')) {
          delete payload.quality
          payload.response_format = 'b64_json'
        }
        const image = await callOpenAI(
          `${API}/images/generations`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
          key,
        )
        return send(res, 200, { image })
      }

      if (route === '/api/openai/edit') {
        const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(body.image || ''))
        if (!m) return send(res, 400, { error: 'Missing or invalid input image (expected a PNG/JPEG/WebP data URL)' })
        const bytes = Buffer.from(m[2], 'base64')
        const form = new FormData()
        form.append('model', model)
        form.append('prompt', prompt)
        form.append('size', size)
        form.append('quality', quality)
        form.append('n', '1')
        form.append('image', new Blob([bytes], { type: `image/${m[1]}` }), `input.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
        const image = await callOpenAI(`${API}/images/edits`, { method: 'POST', body: form }, key)
        return send(res, 200, { image })
      }

      return send(res, 404, { error: 'Unknown route' })
    } catch (err) {
      // Never echo anything that could contain the key; OpenAI messages don't, ours don't either.
      const status = err.name === 'AbortError' ? 504 : err.status && err.status < 600 ? err.status : 500
      return send(res, status, { error: err.name === 'AbortError' ? 'OpenAI request timed out' : err.message })
    }
  }

  return {
    name: 'openai-proxy',
    configResolved(config) {
      env = loadEnv(config.mode, config.root, '')
    },
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
