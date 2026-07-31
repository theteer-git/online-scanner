# Private Online Scanner — Professional Workspace

This rebuild replaces the original sidebar prototype with a scanner-style application workspace.

## Included

- Full-screen editor
- Top document actions
- Dedicated crop/rotate/adjust/zoom/fit/download toolbar
- Large crop canvas with:
  - darkened outside area
  - four large draggable handles
  - rule-of-thirds grid
  - pan
  - mouse-wheel zoom
- Bottom thumbnail rail
- Multiple pages
- Rotation
- Local image enhancement
- Perspective-corrected JPG/PNG export
- No uploads, no document storage, no paid APIs

## Run locally

```bash
python -m http.server 8080
```

Open `http://localhost:8080`.

## Deploy

This is a static Cloudflare Pages or GitHub Pages project.

For Cloudflare Pages:
- Framework preset: None
- Build command: empty
- Output directory: `/`

## Privacy

Documents remain in browser memory. The project has no document upload endpoint and no storage binding.

## Next development stage

- Automatic document detection
- Touch pinch zoom
- Live magnifier near corner handles
- Multi-page PDF export
- Web Worker processing
- Mobile memory limits


## Committed editing workflow

Crop, Rotate, and Adjust now commit their output into browser memory as the new page base. Each later operation begins from the latest committed image. Up to 10 undo snapshots are retained per page in memory only.


## Effects

The Effects panel now provides exactly five presets:

- Original
- Better
- Super
- Simple
- B & W

Effects are previewed live but only become the new in-memory page after **Apply effect** is pressed. Undo restores the previous committed state.


## Simple post-apply flow

After Crop, Rotate, or Effect is applied:

- Crop handles and editing overlays disappear.
- The user sees the clean committed page.
- A small action bar offers only:
  - Crop
  - Effects
  - Rotate
  - Download

This keeps the UI simple and prevents the user from feeling trapped inside the editor.


## Professional Scan Engine v1

The effect engine is now modular and uses document-oriented processing rather than simple cosmetic filters.

Modules:

```text
assets/js/core/background.js
assets/js/core/enhance.js
assets/js/core/threshold.js
assets/js/core/profiles.js
assets/js/core/scanner-engine.js
assets/js/utils/image-data.js
```

Profiles:

- **Original** — no processing.
- **Better** — auto levels, mild illumination correction, paper whitening, balanced contrast and sharpening.
- **Super** — stronger shadow removal, background normalization, text contrast and sharpening.
- **Simple** — neutral low-colour scan with clean paper.
- **B & W** — adaptive local thresholding, denoise, illumination correction and midtone preservation.

All processing remains local in browser memory.


## Background Remover V1
Open `/background-remover.html`. Browser-side AI removal, transparent PNG, colour/image/blur replacement, and no image upload endpoint.
