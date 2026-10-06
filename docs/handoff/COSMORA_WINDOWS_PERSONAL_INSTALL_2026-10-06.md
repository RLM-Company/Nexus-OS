# Cosmora Windows personal install handoff — 2026-10-06

## Base and scope

Prepared from the owner-supplied Windows snapshot at
`fc6a391a3f0b4d79d608d9ecbfb64d799a566a37`. Scope is limited to `desktop/windows/**` and
`.github/workflows/windows-desktop.yml`; web/API/Studio/VPS/AI stop, secrets and production settings
are untouched.

Before implementation, GitHub draft PRs #288–#292 were compared. PR #292 already proved a real NSIS
upgrade/uninstall persistence lifecycle on its older credential-based Windows stack. This module does
not reintroduce those Basic-auth credentials. Instead it ports the useful packaged smoke/lifecycle
idea to the new ordinary web-login flow and preserves only current durable state: `connection.json`
and the persistent Chromium session. Shell-integration assertions from PR #290 were folded into the
same lifecycle instead of introducing a second competing PowerShell harness.

## Implemented acceptance behavior

- First launch accepts only an HTTPS Cosmora origin for remote hosts (`http://localhost` remains a
  bounded developer exception) and saves the origin only after a successful health check and UI load.
- Hosted Cosmora supplies the ordinary owner login. The desktop shell neither requests nor injects
  HTTP Basic credentials.
- Certificate/TLS errors are not ignored or bypassed.
- Saved-server startup reconnects automatically. Failure shows a local retry/change-address screen;
  the saved origin is retained until a replacement succeeds.
- Concurrent connect/retry attempts are generation-gated. A late stale attempt cannot save or clear
  the state of a newer attempt.
- Remote pages have no Node integration or desktop IPC bridge; sandbox and context isolation remain
  enabled. Main-process connection IPC also verifies the caller is the local connection page.
- Same-origin navigation stays in-app. Safe external HTTP(S)/mailto destinations open externally;
  unsafe/local/custom schemes are blocked.
- Downloads are permitted only if the complete URL chain stays on the active Cosmora origin,
  filenames are sanitized, and existing files are not silently overwritten.
- Hosted permission requests are denied by default.
- A second launch focuses the existing window; normal last-window close quits on Windows.
- Packaged `--cosmora-smoke-test` mode executes without server/network startup and records package
  version, executable/resources/app.asar paths and the actual Electron `userDataPath` into a tightly
  constrained temp marker.
- NSIS remains per-user, retains `deleteAppDataOnUninstall: false`, and has reproducible fresh and
  upgrade lifecycle coverage. The lifecycle validates Desktop/Start Menu shortcuts, uninstall
  registry metadata and installed executable product/version metadata, rejects stale uninstall
  records from a baseline version, then requires shell artifacts to be removed on uninstall.
- Upgrade uses a deterministic `connection.json` and Chromium-session sentinel, verifies byte
  identity after upgrade and preservation after uninstall.
- A Cosmora native icon from the existing Windows work is packaged; no new brand concept was invented.

## Validation actually performed here

Linux / Node 22.16.0:

```text
npm --prefix desktop/windows run check
15 tests passed, 0 failed
```

That command includes syntax checks for `main.cjs`, `preload.cjs`, `connection-policy.cjs`,
`smoke-mode.cjs`, `connection.js`, plus all Node policy tests. Coverage includes origin and scheme
policy, complete redirect-chain download policy, saved-server recovery state, latest-attempt race
gating, packaged smoke policy, installer shell-integration coverage, and static Electron
security-boundary invariants.

## Not verified in the local Linux environment

- NSIS packaging, install, upgrade and uninstall execution on Windows.
- PowerShell parser execution for `ci/nsis-lifecycle.ps1` because `pwsh` is not installed locally.
  The GitHub Windows workflow parses the file before packaging.
- Real Electron GUI behavior on a Windows desktop.
- Live Cosmora server/login availability or certificate validity; no live/paid AI request was made.
- Code signing; no signing certificate or successful signed build is claimed.

## Integration requirements

The branch for this module is based directly on
`fc6a391a3f0b4d79d608d9ecbfb64d799a566a37`, the requested
`codex/studio-files-clean-composer-20261004` / PR #311 base.

If a newer Windows stack (#289/#292 or successors) is integrated later, preserve its validated
signing/release infrastructure while keeping this module's no-Basic-auth connection flow, trusted
IPC, generation gate, two-sentinel persistence policy and unified shell-integration lifecycle. Do
not restore `credentials.bin` merely to satisfy the old lifecycle.

On a Windows runner execute:

```powershell
cd desktop/windows
npm run check
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
```

Then run `ci/nsis-lifecycle.ps1` in `Fresh` mode and, for a PR with a buildable desktop base,
`Upgrade` mode against the base installer. Do not install on the owner's real machine as part of
automated acceptance. Do not merge or publish a release automatically.
