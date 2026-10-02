# Cosmora for Windows

This is a thin Electron shell around the existing hosted Cosmora web application. It deliberately
does not duplicate the API, authentication model, project storage, Manager runtime or AI provider.

## Why this architecture

The current web UI already implements the first-release journey: project creation, Manager task
submission, progress polling, persisted task history and downloadable files. A thin desktop shell
therefore minimizes new state and security surface while providing a normal Windows installer,
desktop shortcut, persistent browser storage and connection handling.

The shell:

- accepts an HTTPS Cosmora origin (or loopback HTTP for local development);
- stores only the selected server origin in Electron user data;
- keeps Basic Auth credentials in memory only until the app exits;
- uses a persistent Chromium session for the existing cookies and localStorage;
- keeps navigation inside the selected Cosmora origin and sends external links to the default
  browser;
- refuses TLS bypasses and remote plain HTTP;
- saves same-origin downloads into the Windows Downloads folder without overwriting an existing
  file.

The default connection field is `https://13.141.51.16`. The app does not contain credentials.

## Local policy tests

From the repository root:

```powershell
node --test desktop/windows/test/*.test.cjs
```

## Build the Windows installer

The repository workflow `Windows desktop` uses a Windows GitHub-hosted runner and
`electron-builder@26.17.0` to package Electron `44.5.1` as an unsigned NSIS x64 installer.

Equivalent local commands, from `desktop/windows`, are:

```powershell
node --test test/*.test.cjs
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

The installer is written under `desktop/windows/dist/`. It creates Start Menu and desktop
shortcuts. Because this alpha is not code-signed, Windows SmartScreen may show an unknown-publisher
warning.

## First-run flow

1. Install and launch Cosmora.
2. Confirm the server address.
3. Enter edge credentials if the server requires HTTP Basic authentication.
4. The existing Cosmora interface opens in the desktop window.
5. Create/open a project, open **План**, submit a Manager task and watch its server-persisted stages.
6. When the task is complete, click a result filename. The desktop shell saves it in Downloads.

The hosted alpha currently has model execution globally stopped. The desktop client does not clear
that stop, enable a provider, or fake live model output.
