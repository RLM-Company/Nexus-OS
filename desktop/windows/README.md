# Cosmora for Windows

Cosmora for Windows is a thin Electron shell around the existing hosted Cosmora web application. It does not implement a second UI or duplicate the API, authentication, project storage, Manager runtime or AI provider.

## Runtime and security model

- First launch asks only for the Cosmora server origin. Remote servers must use HTTPS; plain HTTP is accepted only for loopback development.
- The selected origin is stored in Electron `userData/connection.json`. A replacement origin is saved only after a successful health check, so a failed edit does not destroy the last working choice.
- After the server is reachable, the shell loads the existing Cosmora web UI. Owner authentication happens in Cosmora's ordinary web login. The desktop shell does not collect, store or inject HTTP Basic credentials, passwords or tokens.
- TLS verification is Electron/Chromium's normal verification. There is no certificate-error bypass.
- Remote content runs with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. The preload bridge exposes connection controls only to the local `file:` connection screen.
- Navigation remains on the selected Cosmora origin. Ordinary external HTTP(S) and `mailto:` links are delegated to the OS browser/client; dangerous/local schemes are ignored.
- Permission requests from hosted content are denied by the shell. Add a narrowly scoped policy only if a future feature genuinely requires one.
- Downloads are accepted only when the complete redirect chain remains on the active Cosmora origin. Filenames are sanitized and existing files are not overwritten.
- A second launch focuses the existing window instead of creating a second independent desktop session.

## First run and recovery

1. Launch Cosmora and enter the HTTPS origin.
2. The app performs a bounded `/api/v1/health` request. A failed TLS certificate is treated as a failed connection; it is never bypassed.
3. On success, the origin is saved and the hosted Cosmora UI opens. Sign in with the normal owner login shown by Cosmora.
4. If the server later becomes unavailable, the connection screen offers **Повторить** and **Сменить адрес**. The saved origin remains intact while retrying and while an unverified replacement address is being edited.
5. Use **Cosmora → Сменить сервер…** (`Ctrl+Shift+K`) to return to the local connection screen.

## Local checks

From `desktop/windows`:

```powershell
npm run check
```

This performs syntax checks for packaged JavaScript entry points and the Node policy tests. These tests are free and do not contact Cosmora or any AI provider.

## Build the Windows installer

The reproducible unsigned build command is:

```powershell
cd desktop/windows
npm run check
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

The expected artifact is `desktop/windows/dist/Cosmora-Setup-0.9.0-x64.exe`. `CSC_IDENTITY_AUTO_DISCOVERY=false` is used in CI so the ordinary build does not accidentally discover a signing identity. No code-signing success is claimed by this module. The Windows mark is a native ICO, rendered from the supplied SVG by `node scripts/render-windows-icon.mjs` at the repository root.

The NSIS installer is per-user, creates Start Menu/Desktop shortcuts and explicitly keeps Electron user data on uninstall (`deleteAppDataOnUninstall: false`). That preserves the selected server and the persistent Chromium session across upgrade/uninstall according to the existing Windows policy.

The Windows workflow uses verified Windows 0.8.0 from PR #292 (`266c1868`) as the upgrade baseline, and checks byte-identical connection/session sentinels through upgrade and uninstall. Version 0.9.0 uses web authentication. The previous desktop credential store, diagnostics/update runtime and signed-release stack remain available in the separate PR #292 and are outside this personal form-login runtime.

## Installation boundary

Do not install the package automatically as part of tests. After a Windows CI/local build succeeds, the owner may manually run the generated installer. The current build is unsigned unless a separately authorized signing workflow is used, so Windows may show an unknown-publisher warning.

## Personal-install connection flow (2026-10-06)

The Windows package is a thin shell over the hosted Cosmora UI. On first launch it asks only for the
Cosmora server origin, requires HTTPS for non-loopback hosts, performs a bounded health check, and
then opens the normal hosted login page. The desktop shell does not collect or inject HTTP Basic
credentials. The selected origin is written to `connection.json` only after the remote UI loads
successfully.

If the saved server is unavailable, Cosmora shows a local recovery page. Retry keeps the same saved
origin; changing the address does not replace the saved value until the new server has passed the
check and loaded. Concurrent connection attempts are generation-gated so an older late response
cannot overwrite a newer choice.

Remote pages run with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. The IPC
bridge is exposed only on the packaged local connection page, and main-process connection handlers
also reject callers whose frame is not that page. Same-origin navigation remains in-app. Ordinary
HTTP(S)/mailto external links open in the system browser/mail client; file/javascript/custom schemes
are blocked. Downloads are accepted only when every URL in the redirect chain remains on the active
Cosmora origin.

## Installer lifecycle

`ci/nsis-lifecycle.ps1` provides two modes used by the Windows workflow:

- `Fresh` installs the generated NSIS package, starts the installed application in no-network smoke
  mode, validates packaged paths/version/user-data metadata, uninstalls, and requires the application
  directory to disappear.
- `Upgrade` first installs the verified Windows 0.8.0 package, seeds `connection.json` and a deterministic
  Chromium-session sentinel in the real app user-data directory, installs the current package over
  it, validates the current packaged application, requires both sentinels to remain byte-identical,
  then uninstalls and verifies that user data is preserved.

The smoke mode executes before normal server startup and never contacts Cosmora. No real password,
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
