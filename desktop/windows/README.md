# Kosmora for Windows

Kosmora for Windows is a thin Electron shell around the existing hosted Kosmora web application. It does not implement a second UI or duplicate the API, authentication, project storage, Manager runtime or AI provider.

## Runtime and security model

- First launch asks only for the Kosmora server origin. Remote servers must use HTTPS; plain HTTP is accepted only for loopback development.
- The selected origin is stored in Electron `userData/connection.json`. A replacement origin is saved only after a successful health check, so a failed edit does not destroy the last working choice.
- After the server is reachable, the shell loads the existing Kosmora web UI. Owner authentication happens in Kosmora's ordinary web login. The desktop shell does not collect, store or inject HTTP Basic credentials, passwords or tokens.
- TLS verification is Electron/Chromium's normal verification. There is no certificate-error bypass.
- Remote content runs with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. The preload bridge exposes connection controls only to the local `file:` connection screen.
- Navigation remains on the selected Kosmora origin. Ordinary external HTTP(S) and `mailto:` links are delegated to the OS browser/client; dangerous/local schemes are ignored.
- Permission requests from hosted content are denied by the shell. Add a narrowly scoped policy only if a future feature genuinely requires one.
- Downloads are accepted only when the complete redirect chain remains on the active Kosmora origin. Filenames are sanitized and existing files are not overwritten.
- A second launch focuses the existing window instead of creating a second independent desktop session.

## First run and recovery

1. Launch Kosmora and enter the HTTPS origin.
2. The app performs a bounded `/api/v1/health` request. If the owner gateway requires sign-in (HTTP 401), it checks the public `/login` page within the same timeout before opening the ordinary login flow. A failed TLS certificate is treated as a failed connection; it is never bypassed.
3. On success, the origin is saved and the hosted Kosmora UI opens. Sign in with the normal owner login shown by Kosmora.
4. If the server later becomes unavailable, the connection screen offers **Повторить** and **Сменить адрес**. The saved origin remains intact while retrying and while an unverified replacement address is being edited.
5. Use **Kosmora → Сменить сервер…** (`Ctrl+Shift+K`) to return to the local connection screen.

## Local checks

From `desktop/windows`:

```powershell
npm run check
```

This performs syntax checks for packaged JavaScript entry points and the Node policy tests. These tests are free and do not contact Kosmora or any AI provider.

## Build the Windows installer

The reproducible unsigned build command is:

```powershell
cd desktop/windows
npm run check
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

The expected artifact is `desktop/windows/dist/Kosmora-Setup-0.10.0-x64.exe`. `CSC_IDENTITY_AUTO_DISCOVERY=false` is used in CI so the ordinary build does not accidentally discover a signing identity. No code-signing success is claimed by this module. The Windows mark is a native ICO generated from the selected helmet PNG by `node scripts/render-windows-icon.mjs` at the repository root; its SVG preview embeds raster artwork.

The NSIS installer is per-user, creates Start Menu/Desktop shortcuts and explicitly keeps Electron user data on uninstall (`deleteAppDataOnUninstall: false`). That preserves the selected server and the persistent Chromium session across upgrade/uninstall according to the existing Windows policy.

The Windows workflow uses verified Windows 0.8.0 from PR #292 (`266c1868`) as the upgrade baseline, and checks byte-identical connection/session sentinels through upgrade and uninstall. Version 0.9.0 uses web authentication. The previous desktop credential store, diagnostics/update runtime and signed-release stack remain available in the separate PR #292 and are outside this personal form-login runtime.

Version 0.10.0 renames the product to Kosmora and uses the owner's white helmet
logo. The existing application ID, `cosmora-windows-desktop` profile directory
and `persist:cosmora` session partition are kept for upgrade compatibility.

The hosted login now defaults to “Запомнить меня на 30 дней”. Its secure HttpOnly cookie is kept
in the existing Chromium partition, so reopening the installed app retains sign-in until
expiry or explicit logout. The owner gateway also persists session digests across restarts.
Unchecking the option uses an eight-hour session. No password is stored or injected by the app,
and the 0.10.0 installer does not need rebuilding for this server-side change.

## Installation boundary

Do not install the package automatically as part of tests. After a Windows CI/local build succeeds, the owner may manually run the generated installer. The current build is unsigned unless a separately authorized signing workflow is used, so Windows may show an unknown-publisher warning.

## Personal-install connection flow (2026-10-06)

The Windows package is a thin shell over the hosted Kosmora UI. On first launch it asks only for the
Kosmora server origin, requires HTTPS for non-loopback hosts, performs a bounded health check, and
then opens the normal hosted login page. The desktop shell does not collect or inject HTTP Basic
credentials. The selected origin is written to `connection.json` only after the remote UI loads
successfully.

If the saved server is unavailable, Kosmora shows a local recovery page. Retry keeps the same saved
origin; changing the address does not replace the saved value until the new server has passed the
check and loaded. Concurrent connection attempts are generation-gated so an older late response
cannot overwrite a newer choice.

Remote pages run with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. The IPC
bridge is exposed only on the packaged local connection page, and main-process connection handlers
also reject callers whose frame is not that page. Same-origin navigation remains in-app. Ordinary
HTTP(S)/mailto external links open in the system browser/mail client; file/javascript/custom schemes
are blocked. Downloads are accepted only when every URL in the redirect chain remains on the active
Kosmora origin.

## Installer lifecycle

`ci/nsis-lifecycle.ps1` provides two modes used by the Windows workflow:

- `Fresh` installs the generated NSIS package, starts the installed application in no-network smoke
  mode, validates packaged paths/version/user-data metadata, uninstalls, and requires the application
  directory to disappear.
- `Upgrade` first installs the verified Windows 0.8.0 package, seeds `connection.json` and a deterministic
  Chromium-session sentinel in the real app user-data directory, installs the current package over
  it, validates the current packaged application, requires both sentinels to remain byte-identical,
  then uninstalls and verifies that user data is preserved.

The smoke mode executes before normal server startup and never contacts Kosmora. No real password,
token or AI request is used by the lifecycle test. `deleteAppDataOnUninstall` remains `false`.

The lifecycle script refuses ordinary local machines and requires a disposable GitHub-hosted
Windows runner with its work directory below `RUNNER_TEMP`. It verifies executable metadata,
Desktop/Start Menu shortcuts, uninstall registry cleanup and byte-identical preserved user data.
Do not set CI variables manually to bypass this guard on a developer machine.

Local policy/syntax validation:

```powershell
cd desktop/windows
npm run check
```

Unsigned local Windows build:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

Do not treat an unsigned build as code-signed. Installation on the owner's real machine is a separate
manual acceptance step and is not performed by these tests.

## Desktop release 0.11.0 (blocks 17–19)

The 0.11.0 **feature sources** are integrated into the same existing Electron shell. No second Electron app, Electron updater dependency, API routes, server bearer, or production data changes are involved. See [INTEGRATION_0.11.0.md](./INTEGRATION_0.11.0.md) for a complete main-chat handoff and signing protocol.

- **Window/session:** Native window position, size and maximized state persist in `desktop-preferences.json`; off-screen bounds reset safely after monitor changes. Only a known UI path without a query, token or fragment can be remembered. The existing profile `cosmora-windows-desktop`, persistent `persist:cosmora` Chromium cookie partition, and 30-day server-controlled browser login are unchanged.
- **Deep links:** The installer registers `kosmora://`. Only `kosmora://open?path=%2Fgithub` and the other statically allowlisted local UI paths are recognized. Untrusted external URLs, server overrides, deep-linked credentials and arbitrary routes cannot be opened by deep link. Startup/second-instance routing is supported without storing query strings.
- **Files:** The hosted web UI's existing native file input/upload continues working; no binary file is sent through privileged desktop IPC. Native **Файлы → Выбрать папку загрузок…** selects the destination, and **Спрашивать, куда сохранить** switches to an OS Save dialog. Existing same-origin URL/redirect-chain/blob enforcement and filename collision checks remain; foreign origins and local schemes cannot download through the Electron session policy.
- **Tray:** Disabled by default. When enabled via **Настройки**, closing the window hides it; use the tray menu or double-click to restore it, and explicit **Выход** to stop the process.
- **Updates:** Checks-on-start and OS notifications are **opt-in**. The built-in Ed25519 verification requires a release public key pinned in the packaged `update-trust.json`. This source snapshot ships **without a configured key**, so the updater is disabled until an owner-configured publisher key is supplied. The release manifest must be same-origin, unexpired and signed; the installer stream must match its signed SHA-256 and size. The application never executes downloaded installers. The rollback menu reveals an earlier *previously staged and re-verified* release for **manual** installation; it cannot conjure an installer for the installed 0.10.0 or automatically roll back Windows.

Nothing in 0.11.0 asserts Authenticode signature, Windows SmartScreen trust, an installed certificate, a published release endpoint, a successful NSIS install, or a deployed server change. The CI workflow continues to build **unsigned** NSIS installers pending a separate owner-managed signing process.

### Recovery and daily startup (0.11.1 candidate)

See `INTEGRATION_0.11.1.md` for incremental patch/Windows GUI smoke. On an authenticated owner session the desktop stores **only encrypted text drafts** under the existing application profile, isolated by server-confirmed owner ID, origin and chat/project scope. The app never retries a paid Send on reconnect; reconnect is manual from the monochrome offline page. Use **Kosmora → Выйти и удалить локальные черновики…** for explicit local logout/cleanup. Remote Chromium HTML remains sandboxed; upload picker is unchanged, downloads can be cancelled through **Файлы**. The web composer bridge integration is required; applying desktop files alone does not activate draft capture.
