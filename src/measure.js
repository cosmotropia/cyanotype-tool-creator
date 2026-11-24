// Measurement overlay. Drawn on top of the finished picture; it never moves or warps it.
//
// With data loaded, every small number is one of those readings. Without data, every number is the
// distance of that point from the subject, so the field still reads as measurements rather than decoration.
// Light marks on the artwork: they turn dark on the digital negative and print as blue.

const SUBJECT = 0.07 // low, so faint edges still count and the dimension lines sit outside the form

function subjectOf(G, W, H) {
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  let sx = 0
  let sy = 0
  let m = 0
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const v = G[row + x]
      if (v <= SUBJECT) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      sx += x * v
      sy += y * v
      m += v
    }
  }
  if (x1 < 0) return null
  return { x0, y0, x1, y1, cx: sx / m, cy: sy / m }
}

// Compact, so a field of them reads as a column of readings and not as captions.
function fmt(v) {
  const a = Math.abs(v)
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

/**
 * Adds the overlay into `acc` (light, 0..). `readings` is { values: Float32Array, label, features } or null.
 * No-op when the amount is zero.
 */
export function applyMeasures(acc, G, p, readings, W, H) {
  const amount = p.measure || 0
  if (amount < 0.005) return

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  const S = Math.min(W, H)
  const px = Math.max(1, Math.round(S / 700)) // line weight that survives print scaling
  const sub = subjectOf(G, W, H)
  const cx = sub ? sub.cx : W / 2
  const cy = sub ? sub.cy : H / 2

  if (p.measureGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = px
    const g = Math.round(S / 18)
    ctx.beginPath()
    for (let x = g; x < W; x += g) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, H)
    }
    for (let y = g; y < H; y += g) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(W, y + 0.5)
    }
    ctx.stroke()
  }

  // A loose field of readings. Sized so a number always fits its cell, and only where the
  // picture is empty, so the subject stays readable.
  const cols = Math.max(3, Math.round(3 + (p.measureDensity || 0) * 8))
  const step = W / cols
  const font = Math.max(8, Math.round(step * 0.2))
  ctx.font = `${font}px ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  const reach = Math.hypot(W, H) / 2
  const values = readings?.values
  const box = sub && {
    x0: sub.x0 - step * 0.2,
    y0: sub.y0 - step * 0.2,
    x1: sub.x1 + step * 0.2,
    y1: sub.y1 + step * 0.2,
  }
  let k = 0
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      if (box && x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) continue
      const v = values?.length ? values[k % values.length] : Math.hypot(x - cx, y - cy) / reach
      ctx.fillText(fmt(v), x, y)
      k++
    }
  }

  if (p.measureDims && sub) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = px
    const gap = Math.round(S * 0.035)
    const tick = Math.round(S * 0.012)
    const label = Math.max(10, Math.round(S / 62))
    ctx.font = `${label}px ui-monospace, Menlo, monospace`

    // Width, drawn just above the subject.
    const yL = Math.max(label, sub.y0 - gap)
    ctx.beginPath()
    ctx.moveTo(sub.x0, yL)
    ctx.lineTo(sub.x1, yL)
    ctx.moveTo(sub.x0, yL - tick)
    ctx.lineTo(sub.x0, yL + tick)
    ctx.moveTo(sub.x1, yL - tick)
    ctx.lineTo(sub.x1, yL + tick)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('W ' + fmt((sub.x1 - sub.x0) / W), (sub.x0 + sub.x1) / 2, yL - tick)

    // Height, drawn just left of the subject.
    const xL = Math.max(0, sub.x0 - gap)
    ctx.beginPath()
    ctx.moveTo(xL, sub.y0)
    ctx.lineTo(xL, sub.y1)
    ctx.moveTo(xL - tick, sub.y0)
    ctx.lineTo(xL + tick, sub.y0)
    ctx.moveTo(xL - tick, sub.y1)
    ctx.lineTo(xL + tick, sub.y1)
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('H ' + fmt((sub.y1 - sub.y0) / H), xL - tick, sub.y0 + tick)

    // Small cross at the centre of mass.
    const arm = Math.round(S * 0.018)
    ctx.beginPath()
    ctx.moveTo(cx - arm, cy)
    ctx.lineTo(cx + arm, cy)
    ctx.moveTo(cx, cy - arm)
    ctx.lineTo(cx, cy + arm)
    ctx.stroke()
  }

  const img = ctx.getImageData(0, 0, W, H).data
  for (let i = 0, o = 3; i < acc.length; i++, o += 4) acc[i] += (img[o] / 255) * amount
}
