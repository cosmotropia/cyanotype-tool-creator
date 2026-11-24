// Source pictures: AI-generated, uploaded, or rendered by the code generators.
// Each source is a grayscale float map (row-major, values 0..1) plus a label.

import { clamp, smoothstep } from './math.js'

const MAX_SIDE = 2048

function robustLevels(gray, lowPct = 0.03, highPct = 0.995) {
  const sorted = Float32Array.from(gray).sort()
  const lo = sorted[Math.floor(gray.length * lowPct)]
  const hi = sorted[Math.min(gray.length - 1, Math.floor(gray.length * highPct))]
  const span = Math.max(0.05, hi - lo)
  for (let i = 0; i < gray.length; i++) gray[i] = clamp((gray[i] - lo) / span, 0, 1)
}

/** Any canvas image source -> source object. */
export function sourceFromImage(img, sw, sh, label, { edgeFade = false, levels = true } = {}) {
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh))
  const w = Math.max(8, Math.round(sw * k))
  const h = Math.max(8, Math.round(sh * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const gray = new Float32Array(w * h)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255
  }
  if (levels) robustLevels(gray)
  if (edgeFade) {
    // Fade the picture's own border so frames, rounded corners and screenshot edges don't become filaments.
    const fx = Math.max(2, w * 0.03)
    const fy = Math.max(2, h * 0.03)
    for (let j = 0; j < h; j++) {
      const wy = smoothstep(0, fy, j + 0.5) * smoothstep(0, fy, h - (j + 0.5))
      for (let i = 0; i < w; i++) {
        gray[j * w + i] *= smoothstep(0, fx, i + 0.5) * smoothstep(0, fx, w - (i + 0.5)) * wy
      }
    }
  }
  return { gray, w, h, label }
}

export const sourceFromGray = (gray, w, h, label) => ({ gray, w, h, label })

// HEIC/HEIF (iPhone) is not decoded by most browsers. Safari can; everywhere else we fall back to libheif.
const HEIC = /\.hei[cf]$/i
const HEIC_TYPE = /image\/hei[cf]/i

export function isHeicFile(file) {
  return HEIC.test(file?.name || '') || HEIC_TYPE.test(file?.type || '')
}

/** True for the file picker and for drag & drop, including HEIC files whose MIME type comes back empty. */
export function isUploadableImage(file) {
  if (!file) return false
  return file.type.startsWith('image/') || isHeicFile(file)
}

async function bitmapFromFile(file) {
  try {
    return await createImageBitmap(file)
  } catch (err) {
    if (!isHeicFile(file)) throw err
    const { heicTo } = await import('heic-to')
    try {
      return await heicTo({ blob: file, type: 'bitmap' })
    } catch (err2) {
      throw new Error('Could not decode this HEIC (' + (err2?.message || err2) + ')')
    }
  }
}

export async function sourceFromFile(file, opts = { edgeFade: true }) {
  const bmp = await bitmapFromFile(file)
  const s = sourceFromImage(bmp, bmp.width, bmp.height, file.name, opts)
  bmp.close?.()
  return s
}

export async function sourceFromUrl(url, label, opts) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return sourceFromImage(img, img.naturalWidth, img.naturalHeight, label, opts)
}

export function thumbUrl(src, size = 72) {
  const c = document.createElement('canvas')
  c.width = src.w
  c.height = src.h
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(src.w, src.h)
  for (let i = 0; i < src.gray.length; i++) {
    const v = Math.round(clamp(src.gray[i], 0, 1) * 255)
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const t = document.createElement('canvas')
  const k = size / Math.max(src.w, src.h)
  t.width = Math.round(src.w * k)
  t.height = Math.round(src.h * k)
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height)
  return t.toDataURL('image/png')
}
