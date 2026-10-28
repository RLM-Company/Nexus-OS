# Kosmora Windows v0.11.2 — final acceptance matrix

| Категория | Статус | Основание |
| :--- | :--- | :--- |
| Exact base (`4b54bdef1f5c29d84d566c3eb1ecc21214bf8dd9`) + update guards | PASS | `appId: com.cosmora.desktop`, `cosmora-windows-desktop`, `persist:cosmora`, `publicKeyPem: null` (updates OFF) |
| Node syntax + deterministic policy & fixture tests | PASS | `npm run check`: 20 syntax checks + 42 Node tests (`41 passed, 1 skipped on Linux, 0 failed`) |
| Unsigned packaging preflight | PASS | `npm run verify:unsigned`: all 24 packaged files verified, NSIS per-user x64, `deleteAppDataOnUninstall: false`, no auto-install |
| Connection, login, route preservation & stale-attempt gate | PASS | `connection-policy.test.cjs`, `desktop-state.test.cjs`, `gui-acceptance.test.cjs`; intermediate `/` after login no longer clobbers `deferredRoute` |
| Owner/session & DPAPI draft isolation | PASS | `owner-session.test.cjs`, `draft-store.test.cjs`, `draft-isolation.test.cjs`, `draft-session-gate.test.cjs` |
| Download Center, filename sanitization & URL chain policy | PASS | `download-history.test.cjs`, `download-center.test.cjs`, `download-package.test.cjs`; unsafe extensions blocked from `openItem` |
| Packaged GUI acceptance harness (`--cosmora-gui-acceptance`) | PASS (fixture + CI) | `gui-acceptance.cjs` + `ci/gui-acceptance-fixture.cjs` wired into `ci/nsis-lifecycle.ps1` (`Fresh` mode) and `.github/workflows/windows-desktop.yml` |
| Real Windows GUI / DPAPI / NSIS `Fresh` & `Upgrade` execution | WINDOWS CI | Requires disposable GitHub-hosted `windows-latest` runner (`.github/workflows/windows-desktop.yml`); unverified on Linux host |
| Release signing / Authenticode / published update channel | OFF BY DESIGN | Unsigned build (`CSC_IDENTITY_AUTO_DISCOVERY=false`); `publicKeyPem: null` in `update-trust.json` |
