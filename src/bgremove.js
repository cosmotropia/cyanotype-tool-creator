// Background removal that runs in the browser (no account, no API key, the picture never leaves the computer).
// The segmentation model is downloaded once from Hugging Face and the browser caches it; the library is only loaded
// when the user asks to remove a background, so it costs nothing until then.
//
//   extractMatte(src, { onProgress })  -> { alpha, w, h }   soft subject mask 0..1 (1 = keep) at the model's working size
//   refineMatte(matte, { keep, soft }) -> Float32Array      the mask the user tunes with the two sliders
//   upscaleMask(mask, w, h, W, H)      -> Float32Array      the mask at the picture's own size

import { clamp } from './math.js'

// RMBG-1.4 (Bria): very good general-purpose cut-outs and a small download (44 MB, once). It is free for personal and
// non-commercial use. For commercial work swap it for an MIT / Apache model that works with this same code path
// (for example 'onnx-community/BiRefNet_lite-ONNX', MIT, with dtype 'fp32' and ImageNet mean / std below).
export const BG_MODEL = {
  id: 'briaai/RMBG-1.4',
  dtype: 'q8',
  size: 1024, // the model works at this size, a bigger picture is shrunk for it only
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1],
}

let loading = null

function load(onProgress) {
  if (loading) return loading
  loading = (async () => {
    const { AutoModel, AutoProcessor, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    // Progress of the one-time download: sum the bytes of every file being fetched.
    const files = new Map()
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, { loaded: p.loaded, total: p.total })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        onProgress?.({ phase: 'download', loaded, total })
      }
    }
    const model = await AutoModel.from_pretrained(BG_MODEL.id, {
      config: { model_type: 'custom' },
      dtype: BG_MODEL.dtype,
      progress_callback,
    })
    const processor = await AutoProcessor.from_pretrained(BG_MODEL.id, {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: BG_MODEL.mean,
        image_std: BG_MODEL.std,
        feature_extractor_type: 'ImageFeatureExtractor',
        resample: 2,
        rescale_factor: 1 / 255,
        size: { width: BG_MODEL.size, height: BG_MODEL.size },
      },
    })
    const { RawImage } = await import('@huggingface/transformers')
    return { model, processor, RawImage }
  })().catch((err) => {
    loading = null // let the next try start over (offline, blocked download…)
    throw err
  })
  return loading
}

/** Gray source -> PNG blob (the model only needs it as an RGB image). */
async function grayBlob(src) {
  const c = document.createElement('canvas')
  c.width = src.w
  c.height = src.h
  const img = new ImageData(src.w, src.h)
  for (let i = 0, o = 0; i < src.gray.length; i++, o += 4) {
    const v = Math.round(clamp(src.gray[i], 0, 1) * 255)
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v
    img.data[o + 3] = 255
  }
  c.getContext('2d').putImageData(img, 0, 0)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

/** Subject mask of a gray source, at the model's working size (BG_MODEL.size square, stretched back by upscaleMask). */
export async function extractMatte(src, { onProgress } = {}) {
  const { model, processor, RawImage } = await load(onProgress)
  onProgress?.({ phase: 'segment' })
  const image = await RawImage.fromBlob(await grayBlob(src))
  const { pixel_values } = await processor(image)
  const { output } = await model({ input: pixel_values })
  const t = output[0] // [1, H, W] (or [H, W]) with values 0..1
  const dims = t.dims.slice(-2)
  const data = t.data
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lo) lo = data[i]
    if (data[i] > hi) hi = data[i]
  }
  const span = Math.max(1e-6, hi - lo) // the mask is stretched to the full 0..1 range
  const alpha = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) alpha[i] = (data[i] - lo) / span
  return { alpha, w: dims[1], h: dims[0] }
}

/**
 * The two sliders: `keep` (0..1) is how much of the picture is kept (higher keeps more, including faint parts) and
 * `soft` (0..1) is how soft the cut-out edge is. Cheap, so the preview follows the sliders live.
 */
export function refineMatte(matte, { keep = 0.5, soft = 0.3 } = {}) {
  const t = 1 - clamp(keep, 0, 1) // mask level that counts as "half kept"
  const s = 0.02 + clamp(soft, 0, 1) * 0.48 // half-width of the transition
  const out = new Float32Array(matte.length)
  const lo = t - s
  const span = 2 * s
  for (let i = 0; i < matte.length; i++) {
    const x = clamp((matte[i] - lo) / span, 0, 1)
    out[i] = x * x * (3 - 2 * x)
  }
  return out
}

/** Bilinear resize of a 0..1 mask. */
export function upscaleMask(mask, w, h, W, H) {
  if (w === W && h === H) return mask
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1.001, Math.max(0, ((y + 0.5) * h) / H - 0.5))
    const y0 = Math.floor(fy)
    const ty = fy - y0
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1.001, Math.max(0, ((x + 0.5) * w) / W - 0.5))
      const x0 = Math.floor(fx)
      const tx = fx - x0
      const i = y0 * w + x0
      const top = mask[i] + (mask[i + 1] - mask[i]) * tx
      const bot = mask[i + w] + (mask[i + w + 1] - mask[i + w]) * tx
      out[y * W + x] = top + (bot - top) * ty
    }
  }
  return out
}
