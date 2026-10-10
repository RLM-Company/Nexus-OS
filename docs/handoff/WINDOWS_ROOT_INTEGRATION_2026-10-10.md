# Kosmora Windows 0.11.2 — local integration and unsigned installer

Completed on Windows 10.0.26200 on 10 October 2026 in
`C:\Users\Александр\Documents\Codex\2026-10-09\kosmora-integrated-v3`.
The desktop remains a thin shell for the hosted workspace; this work did not deploy the web/API.

## Actual local artifact

- Installer: `desktop/windows/dist/Kosmora-Setup-0.11.2-x64.exe`
- Absolute path: `C:\Users\Александр\Documents\Codex\2026-10-09\kosmora-integrated-v3\desktop\windows\dist\Kosmora-Setup-0.11.2-x64.exe`
- Size: **120,196,043 bytes**.
- SHA-256: **`7fd8945aa146e872a3437e4b204430061b04c4897eec06ccf410ecfc286aae56`**.
- Checksum file: `desktop/windows/dist/SHA256SUMS.txt`.
- Windows Authenticode status: **NotSigned**.
- Installer and embedded application resource metadata: **Kosmora 0.11.2**.
- Embedded application PE architecture: **x64 / 0x8664**.

The final installer was built successfully, with exit code 0. It has not been installed,
published, or run for native UI acceptance. The local blockmap is a build sidecar, not a
published update. `update-trust.json` still contains `publicKeyPem: null`: updates remain OFF.

## Integration

The 0.11.1/0.11.2 source increment is integrated in `desktop/windows/**`. The web composer
uses the optional bounded native text bridge, removes unscoped legacy browser drafts in
Electron, keeps attachment bytes out of native storage, and routes file drops through the
existing attachment picker. Ordinary browser/PWA use keeps its browser draft path.

Both successful POST branches in shared `page.tsx` now record the **raw composer draft**
in `acceptedDraftRef`. This fixes the discovered leading/trailing-whitespace case: the
pagehide/autosave guard compares the raw field text and cannot restore an acknowledged
message before React commits the empty composer. The root integrator made this point edit;
this finishing task reviewed `page.tsx` read-only.

Stable inputs are retained: `com.cosmora.desktop`, the existing
`cosmora-windows-desktop` profile, `persist:cosmora`, per-user assisted NSIS, and
`deleteAppDataOnUninstall: false`. No release key, credential, update verification bypass,
API/DB/VPS change, or GitHub publication was introduced here.

## Checks actually repeated on this Windows host

| Check                                     | Result                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` in `desktop/windows`      | PASS: syntax checks and **33/33 Node tests**, 0 fail/skip                                                                          |
| `node ci/verify-unsigned-policy.cjs`      | PASS: correct package inputs, NSIS x64, updates OFF, no auto-install                                                               |
| Web bridge/drop synthetic checks          | PASS: **3/3**; normal-browser fallback, scope rejection, legacy purge, file-only/disabled/reading/text-only drop cases             |
| Packaged `app.asar`                       | PASS: version 0.11.2; **all 17** configured file inputs byte-match final source                                                    |
| Embedded installer payload                | PASS: `resources/app.asar` and `Kosmora.exe` extracted without executing the installer and byte-match `win-unpacked`               |
| Embedded 7z integrity                     | PASS: all 73 payload files verified, tool exit 0; the expected wrapper/tail produces a “data after the end of archive” warning     |
| PE metadata/architecture and Authenticode | PASS: application/installer Kosmora 0.11.2, application x64; installer **NotSigned**                                               |
| Update crypto/trust source comparison     | PASS: no diff from checkout HEAD for `update-policy.cjs`, `update-service.cjs`, `update-trust.json`, `ci/create-signed-update.cjs` |

ASAR SHA-256:
`5208dd2794a9363683312c7c8501eb5790bc3aefd48dff01a71e62df79ad138c`.
The ad hoc web check is saved locally as
`desktop/windows/dist/verify-web-bridge-2026-10-10.mjs`; rerun from the repository root with
`node --experimental-strip-types --test desktop/windows/dist/verify-web-bridge-2026-10-10.mjs`.

The first Node run in the sandbox-provided OS temp directory failed five atomic renames
with EPERM. Repeating unchanged sources with TEMP/TMP below the writable workspace passed
all 33 checks. This is an environment limitation, not evidence of native DPAPI acceptance.
The old Linux source-only 32-pass/1-skip matrix in `ACCEPTANCE_0.11.2.md` is prior evidence;
the table above records the fresh Windows checks.

## Build inputs and environment limits

Used existing local Node **24.19.0**, Electron **44.5.1**, electron-builder **26.17.0** and
the sibling `windows-build-tools/node_modules` installation. No new package installation
or network download completed. The first cache lookup failed with `ENOTFOUND github.com`;
the final build used explicit local tool paths.

The cached NSIS archives were re-extracted into `desktop/windows/dist/build-temp` only
after matching electron-builder's pinned SHA-256:

- `nsis-3.0.4.1.7z`: `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`
- `nsis-resources-3.4.1.7z`: `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`

The pre-existing unpacked executable still had stock Electron resource metadata. The
already-installed `electron-winstaller/vendor/rcedit.exe` applied the Kosmora ICO and
0.11.2 metadata via Windows short paths. Its original bytes and the original 119,615,418-byte
NSIS archive remain in `desktop/windows/dist/build-temp/prior-package`.

The final packaging command used the verified unpacked package:

```powershell
node <windows-build-tools>/node_modules/electron-builder/out/cli/cli.js `
  --win nsis --x64 --publish never --prepackaged dist/win-unpacked `
  --config.npmRebuild=false --config.nodeGypRebuild=false `
  --config.win.signExecutable=false
```

`CSC_IDENTITY_AUTO_DISCOVERY=false`, and signing-credential environment variables were
checked to be absent. `ELECTRON_BUILDER_NSIS_DIR`, `ELECTRON_BUILDER_NSIS_RESOURCES_DIR`
and `ELECTRON_BUILDER_7ZIP_PATH` pointed to local verified/existing tools; TEMP/TMP pointed
to `dist/build-temp`. Root/desktop dependency declarations and lockfiles were not altered.

NSIS 3.04 failed to start inside the sandbox with `STATUS_ILLEGAL_DLL_RELOCATION`, including
a simple `-VERSION` command from both cache and fresh extraction. The scoped version check
and final packaging succeeded outside the sandbox. Electron-builder's normal silent helper
generated the uninstaller during packaging; no Kosmora application installation was performed.
Successful build log: `desktop/windows/dist/build-unsigned-offline-native-2026-10-10.log`.

## Remaining acceptance

Actual installed Electron GUI, DPAPI encryption, cookie-authorized owner identity,
account A/B isolation, remembered login, real drag/drop/download, offline/reconnect,
single instance/protocol registration, install/upgrade/uninstall and signing/hosted
update/rollback remain **unverified**. The lifecycle refusal guard passed; this does not
mean the lifecycle itself ran. Do not bypass `ci/nsis-lifecycle.ps1`'s disposable-runner
guard on the owner's profile. No paid-model POST was used for these checks.

Root-wide lint, typecheck, build and browser acceptance are tracked by the main integrator;
this handoff does not claim them from desktop-only checks. Byte-identical builds across
different hosts/toolchains are not asserted.
