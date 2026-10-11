# Third-party notices

The game code and content of Ren logikk / Czysta logika / Pure Logic are © 2026 Stop60, all rights reserved (see `LICENSE`).
The game is a single self-contained `index.html` without external requests (the public build additionally loads the
self-hosted, cookie-free GoatCounter script `count.js`). Puzzles are generated in the browser; icons are inline SVG; sounds use the Web Audio API.

Embedded components (inlined as base64 / minified source inside `index.html`):

| Component | Use | Licence | Copyright |
|---|---|---|---|
| IBM Plex Sans (Latin + Latin Extended) | body text | SIL Open Font License 1.1 | © IBM Corp. |
| Oswald (Latin + Latin Extended, weights 500/600) | headings, digits, buttons | SIL Open Font License 1.1 | © The Oswald Project Authors |
| qrcode-generator (minified, unmodified) | in-page QR code for "Share the game" | MIT | © 2009 Kazuhiko Arase |
| GoatCounter count.js (public build only) | cookie-free visit statistics | ISC | © Martin Tournoij |

Full licence texts: `OFL-IBMPlexSans.txt`, `OFL-Oswald.txt`, `LICENSE-qrcode-generator.txt`.

## QR code

The QR code is generated in the browser (no external QR service, no tracking) and encodes only the game's own address.
QR Code is a registered trademark of DENSO WAVE INCORPORATED.
