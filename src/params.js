// Parameter schema.
// Every control belongs to a pipeline stage:
//   source : re-renders the picture made by the code generators (only when the source is "code")
//   base   : transform / filaments / photo mix (recomputed on the current source picture)
//   post   : tone & print curves (instant)
// `forms` limits a code-generator control to certain generators (default: all).

export const FORMS = [
  ['bloom', 'Bloom — radial petals'],
  ['reliquary', 'Reliquary — bone flower on a spine'],
  ['medusa', 'Medusa — spined bell, bead/bone tentacles'],
]

const ALL = ['bloom', 'reliquary', 'medusa']

export const SECTIONS = {
  cyano: {
    title: 'Cyanotype',
    stage: 'post',
    hint: 'Non-destructive: works on the rendered artwork and never touches the geometry. Default = clean digital negative.',
  },
  code: { title: 'Code generator', stage: 'source', hint: 'Used when the source is code-made. Re-renders the picture.' },
  transform: { title: 'Transform', stage: 'base', hint: 'Reshapes the current picture.' },
  frames: {
    title: 'Overlay photos',
    stage: 'base',
    hint: 'Extra photos on top of the picture, each cut into a shape (circle, triangle…). Pick one in the list to edit its size, shape and position.',
  },
  filaments: { title: 'Filaments & light', stage: 'base', hint: 'Adds fibres and relief on top of the picture.' },
  measure: { title: 'Measurements', stage: 'base', hint: 'Numbers, ticks and a grid drawn on top. The picture is never moved or warped.' },
  effects: {
    title: 'Effects',
    stage: 'base',
    hint: 'Turns the picture into line, point-cloud or glitch art. It replaces the picture unless "Picture under the effect" is above 0.',
  },
  tone: { title: 'Tone & print', stage: 'post', hint: 'Final curves for the cyanotype negative.' },
}

export const GROUPS = [
  // ------------------------------ Code generator ------------------------------
  {
    section: 'code', title: 'Structure', open: true,
    controls: [
      { key: 'symmetry', label: 'Radial symmetry', min: 2, max: 36, step: 1, def: 11, forms: ALL, hint: 'Petals / fans / tentacles around the axis' },
      { key: 'layers', label: 'Layers', min: 1, max: 8, step: 1, def: 4, forms: ALL },
      { key: 'density', label: 'Filament density', min: 4, max: 120, step: 1, def: 26, forms: ALL, hint: 'Filaments per petal / pleats per fan / pores on the bell' },
      { key: 'depth', label: 'Depth', min: 0, max: 2.5, step: 0.01, def: 1.0, forms: ALL, hint: 'Vertical extent and layer stacking' },
    ],
  },
  {
    section: 'code', title: 'Form', open: false,
    controls: [
      { key: 'curvature', label: 'Curvature', min: -1, max: 1.8, step: 0.01, def: 0.62, forms: ALL, hint: 'Petal cup / spine hook / tentacle sweep' },
      { key: 'cupping', label: 'Edge curl', min: 0, max: 1.5, step: 0.01, def: 0.55, forms: ['bloom', 'reliquary'] },
      { key: 'petalWidth', label: 'Petal width', min: 0.3, max: 1.8, step: 0.01, def: 1.0, forms: ['bloom', 'reliquary'] },
      { key: 'petalLength', label: 'Petal length', min: 0.5, max: 1.3, step: 0.01, def: 1.0, forms: ['bloom', 'reliquary'] },
      { key: 'twist', label: 'Spiral twist', min: -2, max: 2, step: 0.01, def: 0.45, forms: ALL },
      { key: 'organic', label: 'Organic irregularity', min: 0, max: 1.5, step: 0.01, def: 0.45, forms: ALL },
      { key: 'noiseScale', label: 'Irregularity scale', min: 0.3, max: 3, step: 0.01, def: 1.1, forms: ALL },
    ],
  },
  {
    section: 'code', title: 'Skeleton & tentacles', open: false,
    controls: [
      { key: 'segments', label: 'Vertebrae / bone joints', min: 6, max: 60, step: 1, def: 26, forms: ['reliquary', 'medusa'] },
      { key: 'spineLength', label: 'Spine / tentacle length', min: 0.3, max: 2, step: 0.01, def: 1.0, forms: ['reliquary', 'medusa'] },
      { key: 'ribSpread', label: 'Rib spread', min: 0, max: 1.6, step: 0.01, def: 0.8, forms: ['reliquary'] },
      { key: 'beads', label: 'Beads', min: 0, max: 1, step: 0.01, def: 0.7, forms: ['reliquary', 'medusa'], hint: 'Scalloped rim beads / hanging droplet chains' },
      { key: 'boneStyle', label: 'Smooth ↔ bone chain', min: 0, max: 1, step: 0.01, def: 0.0, forms: ['medusa'] },
      { key: 'spikes', label: 'Rim spikes', min: 0, max: 48, step: 1, def: 22, forms: ['medusa'] },
      { key: 'cluster', label: 'Cluster size', min: 1, max: 5, step: 1, def: 1, forms: ['medusa'], hint: 'Number of jellyfish' },
    ],
  },
  {
    section: 'code', title: 'Detail', open: false,
    controls: [
      { key: 'ribs', label: 'Cross ribs', min: 0, max: 14, step: 1, def: 5, forms: ['bloom', 'reliquary'], hint: 'Segmented bands across each petal' },
      { key: 'nodes', label: 'Vein nodes / sparks', min: 0, max: 1, step: 0.01, def: 0.4, forms: ['bloom'] },
      { key: 'core', label: 'Core filaments', min: 0, max: 400, step: 1, def: 110, forms: ['bloom', 'reliquary'] },
    ],
  },
  {
    section: 'code', title: 'Camera', open: false,
    controls: [
      { key: 'pitch', label: 'Tilt', min: -90, max: 90, step: 0.5, def: 52, unit: '°' },
      { key: 'yaw', label: 'Yaw', min: -180, max: 180, step: 0.5, def: -18, unit: '°' },
      { key: 'spin', label: 'Spin (axis)', min: -180, max: 180, step: 0.5, def: 0, unit: '°' },
      { key: 'zoom', label: 'Zoom', min: 0.4, max: 2.5, step: 0.01, def: 1.0 },
      { key: 'perspective', label: 'Perspective', min: 0.2, max: 2, step: 0.01, def: 1.0, hint: 'Lower = flatter, higher = more dramatic' },
    ],
  },
  {
    section: 'code', title: 'Light & tissue', open: false,
    controls: [
      { key: 'lineWidth', label: 'Filament width', min: 0.3, max: 4, step: 0.01, def: 1.0 },
      { key: 'genExposure', label: 'Generator exposure', min: 0.1, max: 4, step: 0.01, def: 1.0 },
      { key: 'membrane', label: 'Translucent tissue', min: 0, max: 2, step: 0.01, def: 0.55 },
      { key: 'fog', label: 'Depth fade', min: 0, max: 1, step: 0.01, def: 0.55 },
      { key: 'focus', label: 'Depth of field', min: 0, max: 1, step: 0.01, def: 0.25, hint: 'Soften filaments away from the focal plane' },
      { key: 'focusDepth', label: 'Focal depth', min: -1, max: 1, step: 0.01, def: 0.0 },
    ],
  },

  // ------------------------------ Transform ------------------------------
  {
    section: 'transform', title: 'Geometry', open: true,
    controls: [
      { key: 'xRotate', label: 'Rotation', min: -180, max: 180, step: 0.5, def: 0, unit: '°' },
      { key: 'xZoom', label: 'Zoom', min: 0.4, max: 3, step: 0.01, def: 1.0 },
      { key: 'xPanX', label: 'Move X', min: -2, max: 2, step: 0.001, def: 0, hint: 'Slide the picture left / right. Also: Hand tool (H) and drag on the preview' },
      { key: 'xPanY', label: 'Move Y', min: -2, max: 2, step: 0.001, def: 0, hint: 'Slide the picture up / down. 1 unit = half the frame height' },
      { key: 'xFolds', label: 'Radial symmetry (folds)', min: 0, max: 36, step: 1, def: 0, hint: 'Kaleidoscope. 0 = off' },
    ],
    toggles: [{ key: 'xMirror', label: 'Mirror each fold', def: true }],
  },
  {
    section: 'transform', title: 'Curvature & deformation', open: true,
    controls: [
      { key: 'xBend', label: 'Curvature / amount', min: -2, max: 2, step: 0.01, def: 0.0, hint: 'Twirl, bulge, wave or flow strength (negative reverses)' },
      { key: 'xOrganic', label: 'Organic irregularity', min: 0, max: 2, step: 0.01, def: 0.0 },
      { key: 'imgMorph', label: 'Morph A ↔ B', min: 0, max: 1, step: 0.005, def: 0.5, hint: 'Needs two pictures (slot B)' },
    ],
    selects: ['imgWarpType'],
  },

  // ------------------------------ Effects ------------------------------
  {
    section: 'effects', title: 'Effect', open: true,
    controls: [
      { key: 'effKeep', label: 'Picture under the effect', min: 0, max: 1, step: 0.01, def: 0, hint: 'Mixes the original picture back in under the lines, points or glitch' },
    ],
    selects: ['effect'],
  },
  {
    section: 'effects', title: 'Lines', open: true,
    controls: [
      { key: 'effLines', label: 'Line count', min: 20, max: 300, step: 1, def: 120, hint: 'Jelly lines: number of contour lines' },
      { key: 'effAmp', label: 'Line bulge', min: 0, max: 3, step: 0.01, def: 1.0, hint: 'How far bright areas push the lines (the bell shape) and how much they ripple' },
      { key: 'effWidth', label: 'Line width', min: 0.2, max: 5, step: 0.01, def: 1.0 },
    ],
  },
  {
    section: 'effects', title: 'Points & glitch', open: true,
    controls: [
      { key: 'effCells', label: 'Point density', min: 20, max: 220, step: 1, def: 90, hint: 'Point cloud: dots across the short side' },
      { key: 'effSize', label: 'Dot size', min: 0.2, max: 3, step: 0.01, def: 1.0 },
      { key: 'effSpread', label: 'Dispersion', min: 0, max: 2, step: 0.01, def: 0.4, hint: 'Point cloud: how far the dots drift off the form' },
      { key: 'effGlitch', label: 'Glitch amount', min: 0, max: 1, step: 0.01, def: 0.5, hint: 'Glitch: displaced bands and bright streaks' },
    ],
  },

  // ------------------------------ Filaments ------------------------------
  {
    section: 'filaments', title: 'Filaments', open: true,
    controls: [
      { key: 'strands', label: 'Filament density', min: 0, max: 9000, step: 50, def: 0, hint: 'Extra fibres traced over the picture. 0 = none (clean)' },
      { key: 'strandLen', label: 'Filament length', min: 10, max: 260, step: 1, def: 80 },
      { key: 'strandFollow', label: 'Follow picture contours', min: 0, max: 1, step: 0.01, def: 0.55, hint: '0 = free organic fibres, 1 = hug the edges' },
      { key: 'strandWidth', label: 'Filament width', min: 0.3, max: 4, step: 0.01, def: 1.0 },
      { key: 'strandGain', label: 'Filament brightness', min: 0, max: 3, step: 0.01, def: 1.0 },
    ],
  },
  {
    section: 'filaments', title: 'Picture & depth', open: true,
    controls: [
      { key: 'photoMix', label: 'Picture amount', min: 0, max: 1.5, step: 0.01, def: 1.0, hint: 'How much of the source picture shows beneath the fibres' },
      { key: 'xDepth', label: 'Depth / relief', min: 0, max: 2.5, step: 0.01, def: 0.0, hint: 'Embossed relief and fibre parallax' },
      { key: 'xLight', label: 'Light direction', min: -180, max: 180, step: 1, def: -135, unit: '°' },
      { key: 'xTilt', label: 'Tilt (parallax)', min: -60, max: 60, step: 0.5, def: 18, unit: '°' },
      { key: 'xYaw', label: 'Yaw (parallax)', min: -60, max: 60, step: 0.5, def: -12, unit: '°' },
      { key: 'glow', label: 'Glow', min: 0, max: 1.5, step: 0.01, def: 0.0 },
      { key: 'imgContrast', label: 'Picture contrast', min: 0.4, max: 3, step: 0.01, def: 1.0 },
      { key: 'imgThreshold', label: 'Dark cut-off', min: 0, max: 0.6, step: 0.01, def: 0.0 },
    ],
    toggles: [{ key: 'imgInvert', label: 'Invert picture', def: false }],
  },

  // ------------------------------ Measurements (overlay, never warps) ------------------------------
  {
    section: 'measure', title: 'Overlay', open: true,
    controls: [
      { key: 'measure', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0, hint: 'How strong the numbers and lines are. 0 = off' },
      { key: 'measureDensity', label: 'Number density', min: 0, max: 1, step: 0.01, def: 0.35, hint: 'How many readings are written across the picture' },
    ],
    toggles: [
      { key: 'measureGrid', label: 'Fine grid', def: true },
      { key: 'measureDims', label: 'Dimension lines', def: true },
    ],
  },

  // ------------------------------ Tone & print ------------------------------
  {
    section: 'tone', title: 'Curves', open: true,
    controls: [
      { key: 'exposure', label: 'Exposure', min: 0.2, max: 3, step: 0.01, def: 1.0 },
      { key: 'blackPoint', label: 'Black point', min: 0, max: 0.6, step: 0.005, def: 0.0 },
      { key: 'whitePoint', label: 'White point', min: 0.3, max: 1, step: 0.005, def: 1.0 },
      { key: 'gamma', label: 'Gamma', min: 0.4, max: 2.5, step: 0.01, def: 1.0 },
      { key: 'contrast', label: 'Contrast curve', min: 0, max: 1, step: 0.01, def: 0.0, hint: 'S-curve to separate silvery mid-tones from deep exposure' },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0.0 },
      { key: 'grain', label: 'Dither / grain', min: 0, max: 0.1, step: 0.001, def: 0.0, hint: 'Breaks up banding in smooth gradients' },
    ],
    toggles: [
      { key: 'mirror', label: 'Mirror horizontally (artwork, before cyanotype)', def: false },
      { key: 'shoulder', label: 'Soft highlight shoulder (keeps detail where filaments overlap)', def: false },
    ],
  },

  // ------------------------------ Cyanotype (post-processing on the rendered artwork) ------------------------------
  {
    section: 'cyano', title: 'Adjustments', open: true,
    controls: [
      { key: 'cyBrightness', label: 'Brightness', min: -100, max: 100, step: 1, def: 0 },
      { key: 'cyContrast', label: 'Contrast', min: 0, max: 200, step: 1, def: 100, unit: '%' },
      { key: 'cyGamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01, def: 1.0, hint: 'Applied to the artwork before inversion (>1 brightens the artwork = lighter print)' },
      { key: 'cyBlack', label: 'Black point', min: 0, max: 90, step: 0.5, def: 0, unit: '%', hint: 'Artwork values below this become pure black (= pure white on the negative)' },
      { key: 'cyWhite', label: 'White point', min: 10, max: 100, step: 0.5, def: 100, unit: '%' },
      { key: 'cySharpen', label: 'Sharpening', min: 0, max: 200, step: 1, def: 0, unit: '%', hint: 'Unsharp mask scaled to the image size: brings out filaments and fine texture' },
      { key: 'cyThreshold', label: 'Threshold (optional)', min: 0, max: 100, step: 0.5, def: 0, unit: '%', zero: 'off', hint: 'Binary black/white cut. Off keeps all grey levels (recommended)' },
    ],
    toggles: [
      { key: 'cyInvert', label: 'Invert → digital negative', def: true },
      { key: 'cyMirror', label: 'Mirror horizontally (emulsion-side printing)', def: false },
    ],
  },
]

export const SELECTS = {
  form: { label: 'Code generator', options: FORMS, def: 'bloom' },
  effect: {
    label: 'Effect',
    options: [
      ['none', 'Off'],
      ['lines', 'Jelly lines: flowing contour lines'],
      ['points', 'Point cloud: dispersed dots'],
      ['glitch', 'Glitch: displaced bands & streaks'],
    ],
    def: 'none',
  },
  imgWarpType: {
    label: 'Deformation',
    options: [
      ['twirl', 'Twirl'],
      ['bulge', 'Bulge'],
      ['wave', 'Wave'],
      ['flow', 'Organic flow'],
    ],
    def: 'twirl',
  },
  output: {
    label: 'Export content',
    options: [
      ['negative', 'Digital negative (printable on film)'],
      ['positive', 'Original artwork (unmodified)'],
      ['simulation', 'Cyanotype simulation (preview only, not for film)'],
    ],
    def: 'negative',
  },
  preview: {
    label: 'Preview',
    options: [
      ['mono', 'Original', 'Unmodified artwork'],
      ['negative', 'Digital negative', 'Inverted grayscale on pure white, ready to print on film'],
      ['cyanotype', 'Cyanotype simulation', 'Simulated final Prussian-blue print'],
    ],
    def: 'negative',
  },
  size: {
    label: 'Format preset',
    options: [
      ['custom', 'Custom (cm)'],
      ['2551x1949', 'Medio oficio (21.6 × 16.5 cm)'],
      ['2480x3508', 'A4 (21 × 29.7 cm)'],
      ['2048x2048', '2048 × 2048 (1:1)'],
      ['4096x4096', '4096 × 4096 (1:1)'],
      ['3600x3600', '12 × 12 in @ 300 dpi'],
      ['2400x3000', '8 × 10 in @ 300 dpi (4:5)'],
      ['3300x4200', '11 × 14 in @ 300 dpi'],
      ['3508x4961', 'A3 @ 300 dpi'],
      ['4961x7016', 'A2 @ 300 dpi'],
      ['6000x6000', '6000 × 6000 (1:1, 36 MP)'],
      ['3840x2160', '3840 × 2160 (16:9)'],
    ],
    def: '2551x1949',
  },
  dpi: {
    label: 'Resolution',
    options: [
      ['300', '300 dpi'],
      ['600', '600 dpi'],
      ['360', '360 dpi'],
      ['720', '720 dpi'],
    ],
    def: '300',
  },
  bitDepth: {
    label: 'Grayscale bit depth',
    options: [
      ['16', '16-bit (smoothest gradients)'],
      ['8', '8-bit (most compatible)'],
    ],
    def: '16',
  },
}

// Physical size. The size presets are pixel sizes at the 300 dpi reference; the real export pixels are cm × dpi.
export const REF_DPI = 300
export const sizeToCm = (size) => size.split('x').map((n) => +((Number(n) / REF_DPI) * 2.54).toFixed(2))
export const cmToPx = (cm, dpi) => Math.max(64, Math.round((Number(cm) / 2.54) * Number(dpi)))
export function sizeKeyFromCm(w, h) {
  const key = `${Math.round((w / 2.54) * REF_DPI)}x${Math.round((h / 2.54) * REF_DPI)}`
  return SELECTS.size.options.some(([v]) => v === key) ? key : 'custom'
}

// Controls restored by "Clean setup": everything that filters the artwork (no transform / generator geometry).
export const CLEAN_SECTIONS = ['effects', 'filaments', 'measure', 'tone', 'cyano']
export const CLEAN_KEYS = GROUPS.filter((g) => CLEAN_SECTIONS.includes(g.section)).flatMap((g) => [
  ...g.controls.map((c) => c.key),
  ...(g.toggles || []).map((t) => t.key),
  ...(g.selects || []),
])
// Everything that shapes / filters the picture (transform, effects, filaments, tone, cyanotype). Not the code geometry, print size or export settings.
export const ADJUST_SECTIONS = ['transform', 'effects', 'filaments', 'measure', 'tone', 'cyano']
export const ADJUST_KEYS = [
  ...GROUPS.filter((g) => ADJUST_SECTIONS.includes(g.section)).flatMap((g) => [
    ...g.controls.map((c) => c.key),
    ...(g.toggles || []).map((t) => t.key),
    ...(g.selects || []),
  ]),
  'preview',
]
export const CYANO_KEYS = GROUPS.filter((g) => g.section === 'cyano').flatMap((g) => [
  ...g.controls.map((c) => c.key),
  ...(g.toggles || []).map((t) => t.key),
])

export function defaults() {
  const p = { seed: 7, frames: [] } // frames: photo frames, see frames.js
  ;[p.printW, p.printH] = sizeToCm(SELECTS.size.def)
  for (const g of GROUPS) for (const c of g.controls) p[c.key] = c.def
  for (const [k, s] of Object.entries(SELECTS)) p[k] = s.def
  for (const g of GROUPS) for (const t of g.toggles || []) p[t.key] = t.def
  return p
}

// Every preset sets `form`; the rest overrides defaults.
export const PRESETS = {
  'Lotus bloom': {
    form: 'bloom', seed: 7, symmetry: 11, layers: 4, density: 26, depth: 1.0, curvature: 0.62, cupping: 0.55, petalWidth: 1.0,
    petalLength: 1.0, twist: 0.45, organic: 0.45, noiseScale: 1.1, ribs: 5, nodes: 0.4, core: 110,
    pitch: 52, yaw: -18, zoom: 1.0, genExposure: 1.0,
  },
  'Sea anemone': {
    form: 'bloom', seed: 31, symmetry: 24, layers: 3, density: 40, depth: 1.5, curvature: -0.35, cupping: 0.2, petalWidth: 0.55,
    petalLength: 1.1, twist: 0.9, organic: 1.0, noiseScale: 1.8, ribs: 0, nodes: 0.2, core: 240,
    pitch: 62, yaw: -18, zoom: 1.25, genExposure: 1.5,
  },
  'Thorn chalice': {
    form: 'bloom', seed: 112, symmetry: 7, layers: 4, density: 18, depth: 1.5, curvature: 0.95, cupping: 0.9, petalWidth: 0.8,
    petalLength: 1.0, twist: -0.35, organic: 0.25, noiseScale: 0.7, ribs: 11, nodes: 1.0, core: 60,
    pitch: 40, yaw: -18, zoom: 1.0, genExposure: 1.0,
  },
  'Flat mandala': {
    form: 'bloom', seed: 5, symmetry: 18, layers: 6, density: 34, depth: 0.15, curvature: 0.1, cupping: 0.1, petalWidth: 0.9,
    petalLength: 1.0, twist: 0.2, organic: 0.2, noiseScale: 1.3, ribs: 8, nodes: 0.8, core: 200,
    pitch: 35, yaw: -18, zoom: 1.15, genExposure: 1.0,
  },
  'Bone orchid': {
    form: 'reliquary', seed: 21, symmetry: 5, layers: 2, density: 34, depth: 0.7, curvature: 0.5, cupping: 0.5, petalWidth: 1.0,
    petalLength: 1.0, twist: 0.0, organic: 0.3, noiseScale: 1.0, ribs: 0, nodes: 0, core: 90,
    segments: 28, spineLength: 1.0, ribSpread: 0.9, beads: 0.8,
    pitch: 4, yaw: 0, spin: 0, zoom: 1.0, genExposure: 1.1,
  },
  'Spined chrysanthemum': {
    form: 'reliquary', seed: 64, symmetry: 14, layers: 3, density: 16, depth: 1.2, curvature: 1.1, cupping: 0.9, petalWidth: 0.55,
    petalLength: 0.95, twist: 0.5, organic: 0.5, noiseScale: 1.2, ribs: 0, nodes: 0, core: 180,
    segments: 22, spineLength: 0.9, ribSpread: 0.45, beads: 0.3,
    pitch: 10, yaw: 0, spin: 0, zoom: 1.0, genExposure: 1.1,
  },
  'Glass medusa': {
    form: 'medusa', seed: 3, symmetry: 7, layers: 4, density: 30, depth: 1.0, curvature: 0.5, twist: 0.3, organic: 0.45, noiseScale: 1.0,
    segments: 22, spineLength: 1.0, beads: 0.8, boneStyle: 0, spikes: 24, cluster: 1,
    pitch: 8, yaw: 0, spin: 0, zoom: 1.0, genExposure: 1.1,
  },
  'Bone jellyfish': {
    form: 'medusa', seed: 12, symmetry: 8, layers: 2, density: 14, depth: 1.0, curvature: 0.8, twist: 0.5, organic: 0.6, noiseScale: 1.2,
    segments: 26, spineLength: 1.25, beads: 0.1, boneStyle: 1, spikes: 8, cluster: 1,
    pitch: 8, yaw: 0, spin: 0, zoom: 1.0, genExposure: 1.1,
  },
  'Medusa colony': {
    form: 'medusa', seed: 9, symmetry: 4, layers: 3, density: 22, depth: 1.0, curvature: 0.6, twist: 0.2, organic: 0.5, noiseScale: 1.0,
    segments: 20, spineLength: 0.8, beads: 0.9, boneStyle: 0.15, spikes: 22, cluster: 3,
    pitch: 6, yaw: 0, spin: 0, zoom: 0.85, genExposure: 1.1,
  },
}

export const FORM_DEFAULT_PRESET = {
  bloom: 'Lotus bloom',
  reliquary: 'Bone orchid',
  medusa: 'Glass medusa',
}

export function randomPreset(rand, form = 'bloom') {
  const r = (lo, hi) => lo + (hi - lo) * rand()
  const ri = (lo, hi) => Math.round(r(lo, hi))
  const f2 = (lo, hi) => +r(lo, hi).toFixed(2)
  const common = { seed: ri(1, 9999), organic: f2(0.1, 1.1), noiseScale: f2(0.6, 2.2) }
  switch (form) {
    case 'reliquary':
      return {
        ...common, symmetry: ri(4, 16), layers: ri(1, 3), density: ri(12, 44), depth: f2(0.3, 1.6), curvature: f2(-0.2, 1.4),
        cupping: f2(0, 1.2), petalWidth: f2(0.5, 1.3), petalLength: f2(0.8, 1.15), twist: f2(-0.6, 0.8), ribs: ri(0, 6),
        core: ri(0, 220), segments: ri(14, 40), spineLength: f2(0.6, 1.5), ribSpread: f2(0.2, 1.4), beads: f2(0, 1),
      }
    case 'medusa':
      return {
        ...common, symmetry: ri(3, 14), layers: ri(1, 5), density: ri(10, 50), depth: f2(0.6, 1.5), curvature: f2(-0.2, 1.2),
        twist: f2(-0.8, 0.8), segments: ri(14, 40), spineLength: f2(0.6, 1.5), beads: f2(0, 1), boneStyle: Math.random() < 0.5 ? 0 : f2(0.4, 1),
        spikes: ri(0, 36), cluster: ri(1, 3),
      }
    default:
      return {
        ...common, symmetry: ri(5, 24), layers: ri(2, 6), density: ri(14, 50), depth: f2(0.3, 2.0), curvature: f2(-0.5, 1.4),
        cupping: f2(0, 1.2), petalWidth: f2(0.55, 1.4), petalLength: f2(0.8, 1.2), twist: f2(-1.2, 1.2), ribs: ri(0, 12),
        nodes: f2(0, 1), core: ri(0, 260),
      }
  }
}

// Random variation of the transform stage, for pictures that are not code-made.
export function randomTransform(rand) {
  const r = (lo, hi) => lo + (hi - lo) * rand()
  const f2 = (lo, hi) => +r(lo, hi).toFixed(2)
  const types = ['twirl', 'bulge', 'wave', 'flow']
  return {
    seed: Math.round(r(1, 9999)),
    xRotate: Math.round(r(-180, 180)),
    xFolds: rand() < 0.55 ? Math.round(r(3, 14)) : 0,
    xBend: f2(-1.4, 1.4),
    xOrganic: f2(0, 1.2),
    imgWarpType: types[Math.floor(rand() * types.length)],
    xZoom: f2(0.8, 1.6),
  }
}
