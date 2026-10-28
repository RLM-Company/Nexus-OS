# Kosmora Windows Download Center — handoff (2026-10-10)

## Summary

Adds a native Download Center (`download-center.cjs`, `download-history.cjs`, `downloads.html`, `downloads.css`, `downloads.js`, `downloads-preload.cjs`) to the Windows Electron shell (`desktop/windows`):

- Tracks active, completed, cancelled, and interrupted downloads in `download-history.json` under the existing `cosmora-windows-desktop` user profile.
- Isolates download history by `SHA-256(origin + "\0" + verifiedOwnerId)`.
- Never exposes local filesystem paths (`savePath`), owner scopes, or raw download URLs to the renderer process (`downloads.html`).
- Blocks launching executable and system file extensions (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.reg`, `.lnk`, etc.) from **Открыть**, directing the user to **Показать в папке**.
- Recovers stale `"active"` records as `"interrupted"` on startup after an unexpected exit, and delays recovery store initialization until after the single-instance lock and smoke-mode check.
- Clears scoped download history on explicit logout or server origin switch.
