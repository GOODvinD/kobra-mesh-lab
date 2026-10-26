# Kobra Mesh Lab v1.2.14

Privacy-focused, static client-side Anycubic Kobra X bed mesh visualizer.

## Open or publish

- **Single-file offline:** open `kobra-mesh-lab-v1.2.14-standalone.html` in a modern browser. In-app preview tools may disable interactive JavaScript.
- **GitHub Pages:** upload `index.html`, `style.css`, `app.js`, `surface3d.js`, `plate-assets.js`, and `vendor/pako_inflate.min.js` preserving directory paths, to repository root. Enable Pages from `main / (root)`.
- **Don't publish** `AC_LOG*.pack` or any other diagnostics from real printers: they can contain identifying data.

## Included functions

- Adaptive and full-bed 7×7 matrices from Anycubic encrypted `.pack` exports.
- 2D heatmap and interactive 3D surface, XY-aligned comparison and PNG/CSV export.
- Independently enabled by default: **Show Build Plate (2D)** and **Show Build Plate (3D)**, using the supplied `assets/pei-kobra-x.svg`; the measured bed uses 0–265 mm XY and the lower label tab is visual only. Physical orientation assumptions should be checked on printer before mechanical adjustments.
- Runs locally, no server or account needed. Selected file data is processed in memory.

## Prevent CSP regressions

- **Never hand-inline or edit the standalone file**. Edit source files and run `python build.py` after *every* change to CSS or JS.
- The build regenerates CSP SHA-256 hashes for every script and style block from exact final HTML bytes. `connect-src 'none'` remains enforced. It does not use `unsafe-inline`.
- Verify with `node --check app.js && node --check surface3d.js` and `python tests/smoke_test.py` (requires Playwright and Chromium).
- Full local regression (with private, local files that are never bundled):
  `python tests/smoke_test.py '/path/to/baseline.pack' '/path/to/comparison.pack'`.
- For the hosted version, CSP uses same-origin `script-src 'self'` and `style-src 'self'` because JS/CSS files are separate and therefore do not need inline hashes. The standalone version uses hashes.

## Security limitations

Browser CSP blocks application network communication and there are no explicit upload/analytics calls. This is not an external penetration test. A malicious extension, compromised browser/OS or compromised site hosting can still access files selected by the user. See `SECURITY.md`.

## v1.2.14 changes
- The full Kobra X leveling workflow reads: **Control → Smart assist → Calibration → Auto levelling → tick the checkbox → Start**.
- All three map PNG exports (A, B, difference) render natively at 1120 × 960 pixels (2× per dimension) while the live canvas remains 560 × 480.
- All PNG exports remain 1120 × 960 pixels, but the buttons no longer show “(2×)”. Browser smoke tests verify PNG dimensions, file loading, comparison, CSP, and no application network requests.
