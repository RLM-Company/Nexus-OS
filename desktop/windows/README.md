# Cosmora for Windows

Cosmora for Windows is a thin Electron shell around the existing hosted Cosmora web application.
It deliberately reuses the current API, authentication, project storage, Manager runtime and result
download endpoints instead of duplicating backend logic inside the desktop package.

Version **1.0.0** adds native progress and cancellation controls to the verified update downloader.
An explicit update download now reports progress in the Windows taskbar and window title, exposes a
menu command to cancel the active transfer, and still requires the exact manifest size and SHA-256
before an installer is allowed into Downloads.

## Runtime model

The desktop client:

- connects only to an explicit Cosmora origin;
- requires HTTPS for remote servers and allows plain HTTP only for loopback development;
- uses a persistent Chromium session for Cosmora cookies and localStorage;
- automatically reopens the saved server on startup;
- performs a health heartbeat every 30 seconds after connection;
- uses bounded reconnect backoff after repeated health failures, renderer loss or main-frame load
  failures;
- restores the most recent same-origin route after reconnecting;
- keeps cross-origin navigation outside the embedded app and rejects cross-origin server redirects;
- refuses external browser URLs that contain embedded credentials;
- tracks an explicit connection state: disconnected, connecting, online, degraded, recovering,
  offline or auth-required;
- reacts to renderer online/offline events and Windows suspend/resume without exposing a new web API;
- runs an immediate recovery probe after resume or network restoration instead of waiting for the
  next periodic heartbeat;
- exposes a manual **Check for updates…** action and an **About Cosmora** version dialog.

The global server-side AI emergency stop is not modified by the desktop client.

## Credentials

Credentials are never embedded in source code, the installer, the connection URL or diagnostics.

By default Basic Auth credentials exist only in process memory. The connection screen also offers an
explicit **remember credentials** option. When enabled on Windows, Electron `safeStorage` encrypts the
credential payload using the operating-system protected storage before an encrypted blob is written
under Electron user data.

The encrypted credential record is scoped to the exact selected origin. If the user changes the
server, the existing record is not reused. Clearing the remember option removes the encrypted record
after a successful connection.

If protected storage is unavailable, persistent credential storage fails closed and the UI asks the
user to continue without remembering credentials.

## Recovery protocol

After a successful connection the client probes `/api/v1/health` every 30 seconds.

Transient failures do not immediately discard the current page. After repeated failures, the client
starts reconnect attempts with a bounded delay sequence:

`1s → 2s → 5s → 10s → 30s`

Further retries remain capped at 30 seconds. A successful probe restores the last same-origin route
and restarts the heartbeat.

Authentication or authorization failures stop automatic retries and return to the connection screen.
An invalid remembered credential record is cleared before the next manual attempt.

Composer drafts remain persisted by the existing web client, so a desktop reload or reconnect does
not intentionally discard an unsent draft.

## Windows lifecycle

The desktop shell records connection state independently from the hosted UI. Sleep, resume and
network transitions do not alter server-side project state.

On Windows suspend the client stops heartbeat/recovery timers. On resume it runs an immediate
health probe and, if the server is reachable, restores the most recent same-origin route. The same
recovery path is used when Chromium reports that the network has returned.

Network-loss events move the desktop client into an explicit offline state and pause heartbeat work
until Chromium reports connectivity again. Recovery is ignored while a manual/startup connection is
already in progress, preventing two connection flows from racing each other.

## Update protocol

The Windows client does **not** use Electron autoUpdater and does not silently download, execute or
install code.

**Cosmora → Check for updates…** requests this same-origin endpoint from the currently connected
Cosmora server:

`/api/v1/desktop/windows/update.json`

The request uses the existing persistent Chromium session and, when applicable, the current
in-memory Basic Auth credentials. Redirects are disabled. The response must be JSON and is capped at
64 KiB before parsing.

The manifest contract is versioned and fail-closed. Version 1 requires:

- `schemaVersion: 1`;
- `platform: "win32"`, `arch: "x64"`, `channel: "stable"`;
- a strict semantic `version` and ISO-compatible `publishedAt`;
- an HTTPS `releasePageUrl` without embedded credentials;
- optional installer metadata consisting of an HTTPS `.exe` `downloadUrl`, a 64-hex SHA-256
  digest and a positive installer size capped at 512 MiB.

A reference payload lives at `desktop/windows/update-manifest.example.json`.

When a newer version is announced, the client shows its version/date/notes. If the manifest contains
installer metadata, the user may explicitly choose **Download and verify**. The client downloads with
redirects disabled, sends Basic Auth only when the installer URL has the exact same origin as the
connected Cosmora server, streams into the operating-system temp directory, and requires both exact
byte size and SHA-256 before copying the EXE into Downloads.

Progress is shown through the native Windows taskbar progress indicator and the Cosmora window title.
While a transfer is active, **Cosmora → Cancel update download** is enabled and **Check for updates**
is disabled. Cancellation aborts the network request and removes the staged partial file.

A failed, cancelled, truncated, oversized or hash-mismatched download is deleted and never appears as
a final installer in Downloads. Existing installer files are never overwritten; a collision-safe filename is
chosen instead. After success the client can reveal the file in Explorer, but it never executes the
installer. The release page remains available as a separate user action. Equal or older versions are
treated as no update.

A 404 response is treated as an unconfigured update channel rather than a client failure. Redirects,
wrong content types, oversized payloads, invalid JSON, malformed versions, credential-bearing URLs
and invalid installer metadata are rejected.

This remains a manual update protocol. Verified download is not equivalent to automatic update:
Cosmora does not execute the installer and does not elevate privileges. Production signing remains a
separate protected release step.

## Release chain

The ordinary `Windows desktop` pull-request workflow remains intentionally unsigned. After NSIS
finishes, it derives a release bundle directly from the produced EXE:

- `release-metadata.json` records schema, version, platform, architecture, filename, byte size,
  SHA-256 and the source Git SHA;
- `SHA256SUMS.txt` contains the exact installer digest;
- the release-chain verifier re-hashes the installer and fails if the filename, size or digest no
  longer matches the metadata.

The metadata generator refuses an installer whose filename disagrees with
`desktop/windows/package.json`, preventing a versioned artifact from being published under stale
metadata.

For a production signed release, the separate manual `Windows signed release` workflow uses the
protected `windows-release` environment. It requires explicit `SIGNED_RELEASE` confirmation,
validates the requested package version, verifies Authenticode after signing, pins the expected
certificate thumbprint and subject, requires Code Signing and Time Stamping EKUs, then generates
`signature-metadata.json` bound to the signed EXE's filename/size/SHA-256. The final verifier must
match that identity against `release-metadata.json` before the signed bundle can be uploaded. The resulting manifest is verified
against the signed installer's version, filename, byte size and SHA-256 before upload.

PR workflows never receive signing credentials. See `desktop/windows/SIGNING.md` for the release
contract.

## Installer lifecycle smoke test

The ordinary Windows workflow validates more than the existence of an NSIS file. After the installer
is built, CI:

1. performs a silent install into an isolated temporary directory;
2. requires the installed `Cosmora.exe` and NSIS uninstaller to exist;
3. launches the installed executable with the explicit `--cosmora-smoke-test` argument;
4. requires the process to report the exact package version, `win32/x64`, packaged mode, installed
   executable path, resources directory and packaged `app.asar` path;
5. performs a silent uninstall;
6. waits for NSIS cleanup and fails if the installation directory remains.

Smoke mode executes before BrowserWindow/session creation. It does not perform the normal startup
health probe and does not connect to Cosmora. The marker path is supplied through
`COSMORA_SMOKE_OUTPUT` and is accepted only inside the operating-system temporary directory with a
restricted `cosmora-smoke-*.json` filename.

## Upgrade lifecycle

For pull requests, the Windows workflow checks out the PR base commit into an isolated baseline
workspace and builds its NSIS installer separately. The shared
`desktop/windows/ci/nsis-lifecycle.ps1` script then:

1. silently installs the baseline version into a temporary installation directory;
2. launches the installed baseline executable in no-network smoke mode;
3. clears the app-specific user-data directory inside the ephemeral GitHub-hosted runner profile,
   then creates persistence sentinels under Cosmora's actual Windows user-data directory:
   `connection.json`, `credentials.bin`, and a `persist:cosmora` session sentinel;
4. records SHA-256 for each sentinel;
5. installs the current installer over the same installation directory;
6. launches the upgraded installed executable and requires its reported version and packaged paths
   to match the current build;
7. verifies Electron reports the expected isolated `userDataPath`;
8. requires every persistence sentinel to remain present and byte-identical;
9. silently uninstalls the upgraded application and requires the installation directory to
   disappear;
10. requires the user-data sentinels to remain after uninstall, then removes the app-specific test
    profile and temporary installation workspace.

The GitHub-hosted Windows VM is ephemeral. The test uses its real Windows Roaming AppData location
because Electron resolves that path through the Windows Known Folder API rather than the `APPDATA`
environment variable. This validates installer upgrade behavior without using real credentials or a
persistent human user profile.
The `credentials.bin` file in this test is a deterministic sentinel, not a real encrypted
credential payload.

Fresh-install and signed-release lifecycle checks reuse the same PowerShell implementation, reducing
workflow drift.

## Downloads and artifacts

Ordinary web-content downloads are still accepted only from the active Cosmora origin. The verified
update downloader is a separate path driven by the already validated update manifest and allows a
credential-free HTTPS release/CDN origin.

The desktop shell:

- sanitizes Windows-invalid filename characters;
- protects Windows reserved device names such as `CON`, `NUL`, `COM1` and `LPT1`;
- never overwrites an existing file in Downloads;
- computes SHA-256 for each completed ordinary download and records the checksum in diagnostics;
- stages update installers outside Downloads until manifest size and SHA-256 both match;
- never forwards connected-server Basic Auth to a different installer origin;
- never overwrites an existing verified installer;
- never executes a downloaded update installer.

For ordinary downloads, the checksum remains an audit value. For the explicit update-download path,
the expected digest and size come from the validated update manifest and are required before the EXE
is finalized.

## Diagnostics

The **Cosmora → Open diagnostics folder** menu opens Electron's application log directory.

The rotating JSON-lines log records lifecycle, recovery, blocked navigation, download completion and
failure state. It does not intentionally record passwords, authorization headers, URL query strings
or URL fragments. Diagnostic URLs are reduced to origin + path.

The log is capped at approximately 1 MiB and retains approximately the latest 512 KiB when rotated.

The **Cosmora → Export support bundle…** menu writes a user-selected JSON file containing app/system
versions, the current connection state, the sanitized last route and up to 200 recent diagnostic
records. A second redaction layer removes authorization headers, password/secret/token fields,
credential-bearing URLs and common sensitive query parameters even if they accidentally appear in a
future diagnostic record. The bundle contains only a boolean indicating whether protected
credentials exist; it never exports the credential values themselves.

## Desktop security boundary

- `contextIsolation: true`
- `nodeIntegration: false`
- renderer sandbox enabled
- Chromium web security enabled
- insecure content disabled
- preload bridge is exposed only on the local `file:` connection screen
- main-process connection IPC validates the sender frame
- remote HTTP rejected except localhost / loopback
- TLS certificate errors are explicitly rejected
- cross-origin redirects are blocked
- credentials in navigation URLs are rejected
- server credentials are never supplied to proxy authentication challenges
- a single application instance is enforced

## Local policy tests

From the repository root:

```powershell
node --test desktop/windows/test/*.test.cjs
```

These tests cover origin policy, navigation policy, proxy-auth isolation, external URL handling,
connection-state transitions, lifecycle recovery policy, reconnect backoff, update version/manifest
validation, release metadata/integrity verification, signer pinning/EKU/timestamp policy, packaged smoke-mode
policy, upgrade persistence across NSIS installs, verified update download size/hash/origin policy,
support-bundle redaction, diagnostic URL redaction, download filenames and protected credential
persistence. The
Windows workflow also runs Node syntax checks against every packaged JavaScript entry point before
building the installer.

The Windows workflows also cache only the large Electron and electron-builder/NSIS packaging
binaries under an exact Electron 44.5.1 / electron-builder 26.17.0 cache key. Source code,
credentials and application artifacts are not part of this cache.

## Build the Windows installer

The repository workflow `Windows desktop` uses `windows-latest`, Node 24,
`electron-builder@26.17.0` and Electron `44.5.1`.

Equivalent local commands from `desktop/windows` are:

```powershell
node --test test/*.test.cjs
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

The installer is emitted under `desktop/windows/dist/` as
`Cosmora-Setup-1.0.0-x64.exe`.

The alpha remains unsigned, so Windows SmartScreen may display an unknown-publisher warning.

## Deliberate non-goals of this hardening pass

- no VPS deployment;
- no emergency-stop clearance;
- no live AI/provider activation;
- no paid provider request;
- no automatic update download, execution or installation;
- no signing certificate is configured in this repository; signing is isolated to protected
  release-environment secrets;
- no automatic merge.
