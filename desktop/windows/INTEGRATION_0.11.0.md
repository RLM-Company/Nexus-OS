# Kosmora 0.11.0 Windows desktop handoff

**Base:** `b15912d23ab15a99e38370e22e472faf28c99961`. Paths changed are within `desktop/windows/` only. Merge into the same existing Windows Electron project, **not** a new app. Preserve existing `connection.json` and `persist:cosmora` browser data; do not migrate the remembered login into desktop secrets.

## Changes

- Native persisted preference store in `desktop-state.cjs`: window bounds/maximized, last permitted route, download folder, Save As preference, explicit tray/notification/update-check options. Schema filtering, atomic writes, display-clamped bounds, no remembered query/auth URL.
- `kosmora://open?path=%2Fgithub` deep links with allowlisted UI routes `/`, `/github`, `/github/preview`, `/control-center`, `/agent-studio`, `/model-status`, `/skills`. Installer protocol association and second-instance handling are in the existing app. For unrecognized routes, open the app normally; there is no arbitrary path or origin injection.
- Existing remote web file uploads remain in the hosted UI. The desktop itself adds only native download directory selection and Save As; `will-download` accepts only the active main webContents and existing full-chain same-origin/blob policy.
- The runtime remains sandboxed, context-isolated and without remote privileged preload IPC. The browser login still owns the cookie's 30-day lifetime. `setPermissionRequestHandler` continues to deny permissions to remote pages.
- Updates use owner-pinned Ed25519 public-key verification of a canonical signed JSON manifest, expiry and fixed schema, followed by streamed same-origin download with size and SHA-256 verification. No auto-install, code execution or automatic unsigned fallback. Stage index holds up to ten verified release records; the rollback menu rechecks an older file's bytes before revealing it for **manual** installation.

## Integration in main checkout

1. Confirm base and any intervening desktop changes; apply `kosmora-windows-0.11.0.patch` from repo root (`git apply --check ...`, then `git apply ...`) or copy the changed files from the ZIP while preserving subpaths. `desktop/windows/package.json` is the only edited package file; no root lockfile/dependency change, no server app/schema/migration change.
2. Run `cd desktop/windows && npm run check` (Node 22+). The offline tests use temporary fixtures and ephemeral Ed25519 keys. No provider, GitHub, or VPS request occurs.
3. Build on a disposable **Windows x64** environment: set `CSC_IDENTITY_AUTO_DISCOVERY=false`, then `npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never`. Expected path: `desktop/windows/dist/Kosmora-Setup-0.11.0-x64.exe`. The packaged files list and `kosmora://` protocol registration are in `desktop/windows/package.json`; existing NSIS per-user and preserve-user-data settings remain. Windows CI's current `Fresh` and `Upgrade` lifecycle scripts should be run; do not install automatically on the owner's device.
4. On a consenting test machine: check remembered 0.10.0 browser sign-in after upgrade, window/monitor resize restore, every `kosmora://` route, file input upload from the hosted paperclip, same-origin blob download and foreign/file URL denials, folder picker, native Save dialog, opt-in tray and explicit quit. Also validate Windows protocol registration and uninstall preservation.

## Owner-managed updates (not enabled by default)

**There is no release signing key or Windows Authenticode certificate in this archive.** Keep `desktop/windows/update-trust.json` with `publicKeyPem: null` until the release owner securely provisions an Ed25519 key pair. Never commit the private key. Embed only the public key (PEM string) into `update-trust.json` in a future approved, rebuilt desktop release. This is an **application-level signature**, not Authenticode.

Example offline key-generation procedure in a secure, owner-controlled environment (not part of this patch): `node -e "const c=require('crypto'),f=require('fs'); const k=c.generateKeyPairSync('ed25519'); f.writeFileSync('release-private.pem',k.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600}); f.writeFileSync('release-public.pem',k.publicKey.export({format:'pem',type:'spki'}));"`. Secure or remove the private PEM outside the repository. Configure the public PEM as a JSON string in `update-trust.json`, then build the new desktop with that pinned trust anchor.

After an approved release binary exists, use the included offline manifest signer (no credentials or downloads required):

```
node desktop/windows/ci/create-signed-update.cjs \
  /secure/path/Kosmora-Setup-0.12.0-x64.exe \
  0.12.0 /releases/Kosmora-Setup-0.12.0-x64.exe \
  2030-01-01T00:00:00Z /secure/path/release-private.pem \
  > windows-update.json
```

Publish the exact installer at that **same Kosmora HTTPS origin** and the JSON at `/.well-known/kosmora/windows-update.json`. The hosted login may protect both; Chromium's existing authenticated session is reused. The manifest is signed using Ed25519 over UTF-8 `canonicalJson(payload)` (alphabetically sorted object keys, no whitespace, signature field omitted). Manifest fields: `schemaVersion:1`, `version`, `platform:"win32"`, `arch:"x64"`, `assetPath` (absolute path on same origin), `sha256` (lowercase), `size` (bytes, up to 300 MiB), `expiresAt` (ISO 8601 UTC seconds), and Base64 `signature`. Redirects, expired/modified manifests, foreign installer URLs, oversize or hash-mismatched bytes are rejected. The trusted key never comes from the server or user profile.

**Policy:** Even a valid application-level manifest must not trigger automatic `.exe` execution. After download the client only opens Explorer for manual publisher inspection and owner-controlled installation. Windows Authenticode signing, pinning the Authenticode publisher, automatic rollback and public update hosting require independent work/authorization. A staged older signed release is eligible for the rollback menu only after SHA-256 revalidation. It may be absent if no earlier signed package was downloaded.

## Verification and limitations

- `npm run check`: syntax checks and local policy tests, including cryptographic verification, incorrect hash rejection, expired/unsigned manifests, deep-link URL filtering, window geometry and preferences. Actual Windows NSIS, GUI, signed installer, protocol registration, upgrade/uninstall cycle, URL/file chooser behavior on Windows **must be validated in a Windows runner**.
- No production deployment, GitHub branch/PR, installation, AI call, server bearer, application secret, external publication or spending was performed by this worktree.
