// Image encoders for print export. They write only pixels (+ the dpi tag): no borders, UI or watermark.
//   encodePNG  : 8/16-bit grayscale (optionally + alpha) or 8-bit RGB(A), pHYs dpi, zlib via CompressionStream
//   encodeTIFF : 8/16-bit grayscale or 8-bit RGB, uncompressed baseline TIFF, dpi in the tags

import { clamp } from './math.js'

/** Float map (0..1) -> 8-bit grayscale. */
export function toGray8(f) {
  const out = new Uint8Array(f.length)
  for (let i = 0; i < f.length; i++) out[i] = Math.round(clamp(f[i], 0, 1) * 255)
  return out
}

/** Float map (0..1) -> 16-bit grayscale (native endianness). */
export function toGray16(f) {
  const out = new Uint16Array(f.length)
  for (let i = 0; i < f.length; i++) out[i] = Math.round(clamp(f[i], 0, 1) * 65535)
  return out
}

/**
 * Float map (0..1) -> 8-bit gray + alpha (interleaved) with the main background removed.
 * The map is "ink on a background": bright strokes on black (invert = false, ink drawn white) or dark strokes on white
 * (invert = true, the digital negative, ink drawn black). The distance from the background becomes the alpha, so over the
 * original background the result looks exactly like the source and everywhere else the background is see-through.
 * `cut` (0..0.9) makes the faintest tones fully transparent, to clean a noisy background.
 */
export function toInkAlpha8(f, { invert = false, cut = 0 } = {}) {
  const out = new Uint8Array(f.length * 2)
  const ink = invert ? 0 : 255
  const c = clamp(cut, 0, 0.9)
  const k = 1 / (1 - c)
  for (let i = 0, o = 0; i < f.length; i++, o += 2) {
    const v = clamp(invert ? 1 - f[i] : f[i], 0, 1)
    out[o] = ink
    out[o + 1] = Math.round(clamp((v - c) * k, 0, 1) * 255)
  }
  return out
}

// ---------------------------------------------------------------------------------------------- PNG
let crcTable = null
function crc32(bytes, crc = 0xffffffff) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return crc
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crc = crc32(out.subarray(4, 8 + data.length))
  dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0)
  return out
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser has no CompressionStream; use Export TIFF or a current Chrome / Safari / Firefox.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * data: Uint8Array (depth 8) or Uint16Array (depth 16), row-major, channels interleaved.
 * channels: 1 (gray), 2 (gray + alpha), 3 (RGB) or 4 (RGBA).
 */
export async function encodePNG({ data, width, height, channels, depth, dpi }) {
  const bytesPerSample = depth / 8
  const bpp = channels * bytesPerSample
  const rowBytes = width * bpp
  const raw = new Uint8Array(height * (rowBytes + 1))
  const line = new Uint8Array(rowBytes)
  const perRow = width * channels
  for (let y = 0; y < height; y++) {
    if (depth === 8) {
      line.set(data.subarray(y * perRow, (y + 1) * perRow))
    } else {
      const base = y * perRow
      for (let i = 0, o = 0; i < perRow; i++, o += 2) {
        const v = data[base + i]
        line[o] = v >> 8
        line[o + 1] = v & 255
      }
    }
    // filter type 1 (Sub): compresses smooth tonal gradients much better than none
    const o = y * (rowBytes + 1)
    raw[o] = 1
    for (let i = 0; i < rowBytes; i++) raw[o + 1 + i] = (line[i] - (i >= bpp ? line[i - bpp] : 0)) & 255
  }
  const idat = await deflate(raw)

  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = depth
  ihdr[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels] // gray, gray + alpha, RGB, RGBA
  const phys = new Uint8Array(9)
  const pv = new DataView(phys.buffer)
  const ppm = Math.round(dpi / 0.0254)
  pv.setUint32(0, ppm)
  pv.setUint32(4, ppm)
  phys[8] = 1

  return new Blob(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))],
    { type: 'image/png' },
  )
}

// ---------------------------------------------------------------------------------------------- TIFF
const LITTLE_ENDIAN_HOST = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/** Same input as encodePNG. Uncompressed, little-endian, baseline TIFF (opens in Photoshop, Affinity, GIMP, RIP software). */
export function encodeTIFF({ data, width, height, channels, depth, dpi }) {
  let bytes
  if (depth === 8) {
    bytes = data
  } else if (LITTLE_ENDIAN_HOST) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } else {
    bytes = new Uint8Array(data.length * 2)
    for (let i = 0; i < data.length; i++) {
      bytes[i * 2] = data[i] & 255
      bytes[i * 2 + 1] = data[i] >> 8
    }
  }
  const rowBytes = width * channels * (depth / 8)
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(262144 / rowBytes)))
  const strips = Math.ceil(height / rowsPerStrip)

  const dataStart = 8
  const dataEnd = dataStart + bytes.length
  const pad = dataEnd & 1
  const extraStart = dataEnd + pad

  // Extra (out-of-line) values, then the IFD.
  const bitsOff = extraStart
  const bitsLen = channels === 3 ? 6 : 0
  const xresOff = bitsOff + bitsLen
  const yresOff = xresOff + 8
  const stripOffOff = yresOff + 8
  const stripCntOff = stripOffOff + strips * 4
  const ifdOff = stripCntOff + strips * 4
  const entries = 13
  const total = ifdOff + 2 + entries * 12 + 4 - extraStart
  const meta = new ArrayBuffer(total)
  const dv = new DataView(meta)
  const at = (abs) => abs - extraStart

  if (channels === 3) for (let i = 0; i < 3; i++) dv.setUint16(at(bitsOff) + i * 2, depth, true)
  dv.setUint32(at(xresOff), Math.round(dpi), true)
  dv.setUint32(at(xresOff) + 4, 1, true)
  dv.setUint32(at(yresOff), Math.round(dpi), true)
  dv.setUint32(at(yresOff) + 4, 1, true)
  for (let s = 0; s < strips; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip)
    dv.setUint32(at(stripOffOff) + s * 4, dataStart + s * rowsPerStrip * rowBytes, true)
    dv.setUint32(at(stripCntOff) + s * 4, rows * rowBytes, true)
  }

  let o = at(ifdOff)
  dv.setUint16(o, entries, true)
  o += 2
  const entry = (tag, type, count, value) => {
    dv.setUint16(o, tag, true)
    dv.setUint16(o + 2, type, true)
    dv.setUint32(o + 4, count, true)
    if (type === 3 && count === 1) dv.setUint16(o + 8, value, true)
    else dv.setUint32(o + 8, value, true)
    o += 12
  }
  const SHORT = 3
  const LONG = 4
  const RATIONAL = 5
  entry(256, LONG, 1, width)
  entry(257, LONG, 1, height)
  if (channels === 3) entry(258, SHORT, 3, bitsOff)
  else entry(258, SHORT, 1, depth)
  entry(259, SHORT, 1, 1) // no compression
  entry(262, SHORT, 1, channels === 3 ? 2 : 1) // RGB / BlackIsZero
  if (strips === 1) entry(273, LONG, 1, dataStart)
  else entry(273, LONG, strips, stripOffOff)
  entry(277, SHORT, 1, channels)
  entry(278, LONG, 1, rowsPerStrip)
  if (strips === 1) entry(279, LONG, 1, rowBytes * height)
  else entry(279, LONG, strips, stripCntOff)
  entry(282, RATIONAL, 1, xresOff)
  entry(283, RATIONAL, 1, yresOff)
  entry(284, SHORT, 1, 1) // chunky
  entry(296, SHORT, 1, 2) // inches
  dv.setUint32(o, 0, true) // no next IFD

  const header = new Uint8Array(8)
  const hv = new DataView(header.buffer)
  header[0] = 0x49
  header[1] = 0x49
  hv.setUint16(2, 42, true)
  hv.setUint32(4, ifdOff, true)

  return new Blob([header, bytes, new Uint8Array(pad), meta], { type: 'image/tiff' })
}
