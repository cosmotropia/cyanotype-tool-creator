// Browser-side helpers for the optional OpenAI proxy (see server/openai.js).
// The API key never reaches the browser; these calls go to the local dev server.
//
// AI is "coming soon" until you switch it on: set VITE_AI_ENABLED=true in .env (and restart the dev server).
// Off by default, so nothing calls OpenAI until you choose to. The same flag is read by the server (server/openai.js).
export const AI_ENABLED = String(import.meta.env.VITE_AI_ENABLED ?? '').trim().toLowerCase() === 'true'

// Shown in place of the AI controls while they are off.
export const AI_SOON_TEXT =
  'AI is coming soon. For now, upload your own picture or use the code generators, then shape it with the controls below.'
export const AI_SOON_SHORT = 'Coming soon: AI generation is not enabled yet.'

const STYLE =
  'isolated and centered on a pure black background, studio macro photography, strong rim lighting, ' +
  'high contrast, ivory-white bone and translucent membranes, no text, no watermark'

export const AI_PROMPTS = {
  'Bone orchid on a vertebral spine': `A surreal flower with five large translucent fan-shaped petals, fine radial pleats and beaded scalloped edges, growing from a long curved vertebral spine with delicate curved ribs, ${STYLE}`,
  'Glass jellyfish with beaded tentacles': `A translucent glass jellyfish with a spined dome bell covered in tiny pores and droplets, long curved tentacles strung with glistening beads, ${STYLE}`,
  'Skeletal jellyfish of vertebrae': `A jellyfish whose long tentacles are articulated chains of small vertebrae with knuckle joints, bell made of curved ribs and fangs, ${STYLE}`,
  'Skeletal chrysanthemum': `A chrysanthemum whose long curling petals are made of pale bone, with a tightly packed bone-white core, on a delicate segmented spine, ${STYLE}`,
}

// Appended when "cyanotype-friendly wording" is on: steers the model toward a clean tonal range for printing.
export const CYANO_SUFFIX =
  ' Rendered as a high-contrast black and white image: luminous white-ivory subject on a pure black background, ' +
  'fine crisp detail, rich tonal range, no color, no text, no frame, no background clutter.'

export const REFINE_PROMPT =
  'Reinterpret this image as a photographic macro of a real biological specimen ' +
  'made of ivory bone and translucent membrane. Keep the composition and silhouette. Pure black background, no text.'

async function post(path, payload) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json.error || `Request failed (HTTP ${r.status})`)
  return json.image
}

export async function aiStatus() {
  if (!AI_ENABLED) return { configured: false, available: false, enabled: false } // no request while coming soon
  try {
    const r = await fetch('/api/openai/status')
    if (!r.ok) return { configured: false, available: false }
    return { ...(await r.json()), available: true }
  } catch {
    return { configured: false, available: false }
  }
}

export const aiGenerate = (prompt, size = '1024x1024', quality = 'medium') => post('/api/openai/generate', { prompt, size, quality })
export const aiEdit = (prompt, image, size = '1024x1024', quality = 'medium') => post('/api/openai/edit', { prompt, image, size, quality })
