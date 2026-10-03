# Cosmora for Windows

Cosmora for Windows is a thin Electron shell around the existing hosted Cosmora web application.
It deliberately reuses the current API, authentication, project storage, Manager runtime and result
download endpoints instead of duplicating backend logic inside the desktop package.

Version **0.3.0** adds lifecycle recovery and supportability on top of the hardened 0.2.0 client.

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
  next periodic heartbeat.

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

## Downloads and artifacts

Only downloads whose URL belongs to the active Cosmora origin are accepted.

The desktop shell:

- sanitizes Windows-invalid filename characters;
- protects Windows reserved device names such as `CON`, `NUL`, `COM1` and `LPT1`;
- never overwrites an existing file in Downloads;
- computes SHA-256 for each completed download and records the checksum in diagnostics.

The checksum is an audit value for the downloaded file. It is not presented as server-authenticated
integrity proof unless the server later supplies an expected digest through a trusted protocol.

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
connection-state transitions, lifecycle recovery policy, reconnect backoff, support-bundle
redaction, diagnostic URL redaction, download filenames and protected credential persistence. The
Windows workflow also runs Node syntax checks against every packaged JavaScript entry point before
building the installer.

## Build the Windows installer

The repository workflow `Windows desktop` uses `windows-latest`, Node 24,
`electron-builder@26.17.0` and Electron `44.5.1`.

Equivalent local commands from `desktop/windows` are:

```powershell
node --test test/*.test.cjs
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

The installer is emitted under `desktop/windows/dist/` as
`Cosmora-Setup-0.3.0-x64.exe`.

The alpha remains unsigned, so Windows SmartScreen may display an unknown-publisher warning.

## Deliberate non-goals of this hardening pass

- no VPS deployment;
- no emergency-stop clearance;
- no live AI/provider activation;
- no paid provider request;
- no auto-update feed;
- no code-signing certificate integration;
- no automatic merge.
