# Kosmora Windows — Download Center handoff (2026-10-17)

Integration update (2026-10-20): integrated into the current PR #360 tree, preserving the latest main-process code. Windows source checks and all 48 Node tests passed, including two added async-identity/instant-completion cases; unsigned policy passed. Recovery initialization now follows the single-instance lock and excludes smoke mode. No installer or native GUI acceptance is claimed. See `docs/handoff/KOSMORA_FEATURES_2026-10-20_RU.md` for current status; the rest is the original delivery record.

**Exact GitHub base:** `RLM-Company/Nexus-OS` / `codex/studio-excel-export-20261017` / `1314280a429273ea3f46208c31847eb78efb9491`. The connected GitHub read confirmed `desktop/windows/main.cjs` blob `14f3df77e508d17a06b0373f0944900472a9af6e` and `desktop/windows/package.json` blob `26448618195bfdcbab34f6edbfd1265c6bef320f`. The local Linux container cannot reach github.com for a checkout. The main integration hunk was generated from exact GitHub excerpts; no local full-current-tree `git apply --check` was possible.

## Apply

```powershell
# Run in an actual checkout containing the exact base commit, no dirty overlapping paths.
git switch -c codex/delegated-windows-downloads-20261017 1314280a429273ea3f46208c31847eb78efb9491
git apply --check path/to/kosmora-windows-download-center-full.patch
git apply path/to/kosmora-windows-download-center-full.patch
cd desktop/windows
npm run check
npm run verify:unsigned
```

The full patch includes **only** `desktop/windows/` files. To isolate wiring, apply `core.patch` (new source/tests/docs) and then `integration.patch` (only `main.cjs` and `package.json`) instead. Do not apply both the full patch and the split patches. The delivered ZIP also includes the completed module sources and `package.json`; patching is preferred to copying old root files over your current tree.

## Behaviour

- Open **Файлы → Центр загрузок…** (`Ctrl+J`). The existing `will-download` trust chain, save-dialog/preset-directory logic, active download map, cancellation menu, and update guards are preserved.
- Per-download UUID is generated only in Electron main. Download names are sanitized/redacted; public list carries name, actual received bytes, known total (or `null`), state (`active`, `completed`, `interrupted`, `cancelled`) and timestamps. There is **no fabricated percentage** when total is unknown.
- The local downloads window is sandboxed and context-isolated with its **own preload**. IPC is validated against its exact `webContents` and main-frame `file:` URL, current origin, identity epoch, and freshly checked verified owner. The remote web client never receives shell or filesystem capabilities.
- Only active records owned by the current scope can be cancelled by ID. `showItemInFolder` is invoked only on the exact existing path of a completed download; no file is opened or executed. Clearing removes _finished_ history, not current active transfers.
- History (at most **50 total records**) is atomic, user-data-local `download-history.json` with restrictive file permissions, opaque owner+origin scope hashes, bounded names/byte counters, and a private saved-file path for reveal. It stores no file payloads, source URLs, query, headers or bearer tokens. Any stale `active` records become `interrupted` on restart; no automatic retry/resume.
- Explicit logout/origin switch closes the center, cancels active transfers and removes known active-owner metadata. Silent owner change/401 blocks previous owner actions, cancels old operations and isolates other scope history. At a cold offline restart, history is intentionally inaccessible until a server-verified owner is known; during the same process an unexpired owner cache may serve offline actions.
- Package `build.files` includes all six download-center files; Electron client version and server/API versions are **unchanged**.

## Focused checks on Linux

- `node --test` for new download tests: 13 tests PASS (owner/origin isolation, stale IPC window/frame, live bytes, owned cancellation, exact-file reveal, restart interruption, 50-entry cap, corrupt metadata, filename token redaction, package assets and update OFF).
- Locally assembled Windows test tree using available v0.11.2 sources and the checked-in base: `npm run check`: **45 PASS, 1 SKIP, 0 FAIL**. This is _not_ a compile/test of a full exact-HEAD Git checkout. `npm run verify:unsigned`: PASS with public key `null`, no network fetch.
- A synthetic replay of main integration hunks passed `git apply --check` against reconstructed exact hunk contexts, **not** an actual exact-HEAD checkout.

## Native gates not run

No Windows GUI, DPAPI, NSIS installer, install/upgrade/uninstall, Electron actual `DownloadItem` events, login gateway acceptance, portable offline profile migration, Authenticode, full monorepo build, or paid/remote AI calls were run. The container has Node 22 while the supported unsigned build script requires **Windows + Node 24+**, reviewed dependencies and a separate native acceptance cycle. On a Windows builder run `npm run pack:unsigned:win` (never enable signing/env keys). `update-trust.json` remains `publicKeyPem:null`: no signed updater, no auto-install, no invented EXE. Validate native download prompt/complete/interrupted/cancel/reveal and owner swap before release.

## Rollback

Revert the download-center commit, remove the new files from `build.files`, and discard `download-history.json` if desired. The former `will-download` / destination / cancellation behaviour remains unchanged; no backend, shared web page, CSS/global layout, migrations, budget ledger, secrets or server version were touched.
