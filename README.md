# Cyano Creator — digital negatives for cyanotype

A tool for making **still images** for cyanotype printing. No animation and **no WebGL required**
(everything is drawn with the 2D canvas and plain JavaScript; p5.js hosts the preview canvas).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Workflow

1. **Start from a picture** (panel section 1)
   - **Prompt → AI** (OpenAI): write a prompt (or pick a prompt idea), press *Generate → A*. The
     *Cyanotype-friendly wording* checkbox appends “high-contrast black & white, white subject on black…”.
     *Vary current result → A* sends what you see now to OpenAI as the starting point.
   - **Upload** your own picture (or drag & drop onto a slot), or use **Sample**.
   - **Code**: the built-in generators (Bloom, Reliquary, Medusa) draw the picture with no AI. This is the default
     start, and it stays *live*: the *Code generator* section re-renders it as you move the sliders.
   - Picture **B** is optional and is used for *Morph A ↔ B*.
2. **Shape it with the controls** — all of them work on whichever picture is loaded:
   - **Transform**: rotation, zoom, radial symmetry (kaleidoscope folds), curvature/deformation (twirl, bulge, wave,
     organic flow), organic irregularity, morph A ↔ B.
   - **Effects**: *Jelly lines* (flowing contour lines that bulge where the picture is bright), *Point cloud* (dispersed
     dots) or *Glitch* (displaced bands and streaks). They replace the picture; *Picture under the effect* brings it back.
   - **Filaments & light**: add traced filaments that follow the picture’s contours (density, length, width,
     brightness), picture amount, depth/relief and light direction, parallax tilt/yaw, glow, contrast, dark cut-off, invert.
   - **Tone & print**: exposure, black/white point, gamma, S-curve, vignette, dither, mirror.
   - **Code generator** (only while the source is code): symmetry, layers, density, curvature, petals, vertebrae, beads,
     bone chain, spikes, cluster, camera, tissue, depth fade, depth of field…
3. **Export** a high-resolution PNG or TIFF (digital negative by default, with dpi metadata).

Drag on the preview to change the camera (code) or the parallax (pictures); the mouse wheel zooms. `R` randomizes, `E` exports.

**Undo / copy-paste:** `⌘Z` undo, `⇧⌘Z` (or `Ctrl+Y`) redo. Every change is an undo step (a slider drag is one step).
`⌘C` copies all settings as text and `⌘V` pastes them back (also the *Copy settings* / *Paste settings* buttons).
In text fields (prompt, numbers) the browser's own undo/copy/paste is used.
The preview first draws a fast draft and then refines itself when you stop moving.

## Optional: OpenAI

1. Put your key in `.env` (copy `.env.example`): `OPENAI_API_KEY=...` (optionally `OPENAI_IMAGE_MODEL`).
2. Restart `npm run dev` (also works with `npm run preview`).

The key is only read by the local Vite server (`server/openai.js`) and never reaches the browser. `.env` is git-ignored.
Nothing calls OpenAI unless you press a *Generate* / *Vary* button.

## How it works

- `src/structure.js`, `src/forms.js` build 3D filament/tissue geometry; `src/render2d.js` projects it (`src/camera.js`)
  and paints additive light on a 2D canvas, then converts it to a grayscale float picture.
- Any picture (AI, upload or code) goes through the same float pipeline:
  `src/transform.js` (rotate / fold / warp / morph) → `src/strands.js` (filaments traced through the picture)
  → `src/pipeline.js` (relief, glow, composition, then exposure, levels, gamma, S-curve, dither).
- Parameter changes only recompute the stages they affect (tone changes are instant).

## Cyanotype mode (default)

The app starts **clean**: just the artwork as a digital negative — no filaments, glow, relief, vignette, grain or curves.
Every other control is still there; turn them on when you want them. *Clean setup* (Cyanotype panel) puts all of those
filters back to zero in one click.

The **Cyanotype** panel is non-destructive post-processing on the rendered artwork (the procedural geometry is never touched):

1. luminance grayscale → 2. brightness, contrast, black point, white point, gamma → 3. optional sharpening (scaled to the
image size, so preview = export) → 4. invert (digital negative) → 5. optional threshold (off by default) and horizontal mirror.
All intermediate grey levels are kept.

Three previews (keys `1` `2` `3`):

- **Original** — the unmodified artwork.
- **Digital negative** — inverted grayscale on pure white, to print on transparent film.
- **Cyanotype simulation** — Prussian blue for exposed areas, off-white paper for unexposed, blues in between. It is only a
  preview, visually and technically separate from the printable negative.

*Reset cyanotype settings* returns the panel to a neutral negative.

## Print export

- Set the print size in **cm** (or pick a format preset) and **300 / 600 dpi**; pixels = cm ÷ 2.54 × dpi. The image is
  rendered at that resolution (code sources are re-rendered up to 8192 px), not an enlarged preview.
- **PNG** or **TIFF**, grayscale 16-bit (default) or 8-bit; the simulation exports as 8-bit RGB. dpi is stored in the file.
  The files contain only pixels: no UI, borders or watermarks.
- Export is limited to 40 MP (e.g. A4 @ 600 dpi fits; A3 @ 600 dpi does not).
- *Export content*: digital negative (default), original artwork, or the cyanotype simulation.
- AI/uploaded pictures are limited by their own resolution (OpenAI returns ~1–1.5 K px), so large prints are upscaled
  smoothly.
