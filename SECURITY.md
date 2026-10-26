# Security and privacy — Kobra Mesh Lab v1.2.14

## What the site does

- Uses browser File API to read only files you explicitly select or drop.
- Parses ZIP-encrypted `AC_LOG*.pack` archives and CSV files inside the browser.
- Keeps the recovered measurement grids in JavaScript memory until the tab closes/reloads.
- Creates CSV/PNG download files only after an explicit click; downloads use `blob:` URLs.
- No login, server-side database, analytics, cookies, persistent client storage, remote scripts, or application network requests.

## Defense in depth

- Static site `index.html` enforces Content Security Policy: `connect-src 'none'`, no external images/scripts/styles, forms, frames, plugins, or workers.
- Standalone HTML uses SHA-256 CSP hashes for its exact inline JavaScript and CSS.
- Dynamic user-controlled text is set with `textContent`. The only `innerHTML` uses assign the empty string to clear UI components.
- Input limits: archive <=80 MiB, individual log <=18 MiB compressed AND while actually inflating, <=64 MiB cumulative selected log uncompressed sizes, <=50 selected log entries, CSV <=2 MiB/5000 points.
- ZIP entries are CRC-checked after decryption and decompression. Logs are not executed.

## Scope and limitations

- This is a first-party source review and Chromium functionality check, not a formal penetration test or proof of zero vulnerabilities.
- A malicious browser extension, compromised browser/OS, changed GitHub Pages content, or compromised maintainer account could access the loaded data. Keep dependencies and site ownership secure.
- GitHub Pages receives standard requests for the web page and may log visits; it does **not** receive the diagnostic file through the app.
- ZIP encryption uses a password embedded in the site; it is not a security boundary. Do not publish raw printer diagnostic archives. They may contain identifiers and operational details.
- The included pako v0.2.9 is an old version; consider a reviewed, current inflate-only implementation in a future dependency update.

## Verify in browser

1. Open GitHub Pages URL in Chrome.
2. F12 → Network, then check **Preserve log**.
3. Reload. For GitHub Pages, the page fetches same-origin HTML, CSS and JavaScript assets. The standalone HTML needs no supporting files or network requests.
4. Load a diagnostic archive and export a CSV/PNG. No new network requests should appear.
5. F12 → Console: verify no Content Security Policy violations during normal use.

## Review trace

Original v1.2.2 security tests covered a real Anycubic diagnostic archive and browser network behavior. For v1.2.14, after adopting a user-supplied SVG plate overlay and validating it for disallowed active content and external references, the CSP SHA-256 hashes were regenerated from exact script/style contents and verified, the inline scripts passed syntax checks, and a Node-based mock DOM smoke test exercised demo rendering, A/B/difference plots, plate toggling, a real 7×7 CSV, and decoding of the encrypted `AC_LOG_K4_PRO(1).pack` including a 7×7 grid. Chromium validated the strict standalone CSP, actual log parsing and 2D/Canvas 3D. The environment blocked local HTTP navigation and did not expose WebGL, so verify hosted navigation and hardware WebGL on a normal browser before public launch.
