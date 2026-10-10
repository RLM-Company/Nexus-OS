# Kosmora Windows 0.11.1 candidate — isolated acceptance (9 October 2026)

**Source baseline:** tracked snapshot `76e44320f20ae4cdc70f5202ac9e77d30c34eef7`, Windows 0.11.0 already merged. This source overlay does not touch backend, DB, migration journal, model usage budget, Studio Documents/Canvas/Data, `update-service.cjs`, `update-policy.cjs`, signing key or CI main checkout. The original v0.11.1 producer `page.tsx` was NOT overlaid because it drops Voice/Relay; merged web changes are separate.

## PASS — real local deterministic checks (Linux, Node 22.16)

- `cd desktop/windows && npm run check`: 31 passed, 1 intentionally skipped, 0 failed (Node syntax + original Ed25519/hash/rollback fixtures + desktop state + owner/session + crypto context isolation + deep link tests). These are synthetic fixtures, **not** live Electron/browser or DPAPI.
- `node --experimental-strip-types --test apps/web/src/app/test/desktop-bridge-synthetic.test.mjs`: 3 passed, 0 failed, covering no IPC in browser/PWA, scoping, legacy cleanup and DnD file routing.
- `tsc --noEmit --target ES2022 --module ESNext --lib DOM,ES2022 --skipLibCheck apps/web/src/app/desktop-draft-bridge.ts apps/web/src/app/chat-drop-policy.ts`: PASS.
- TypeScript syntax parser on the four changed web TS/TSX modules: zero parse diagnostics. **Not** full monorepo `typecheck`/Next build (dependencies absent).
- SHA-256 equality to source baseline confirmed for Ed25519 signed manifest/hash/rollback guards in `update-policy.cjs`, `update-service.cjs`, `update-trust.json`. Pinned key remains `null`; update discovery/staging UI disabled.
- `git apply --check` and patch replay against exact extracted source must be run during export verification; see generated manifest.

## Implemented, pending native GUI/E2E verification

- One `requestSingleInstanceLock` desktop instance; safe `kosmora://open?path=...` route allowlist with project/chat/view/surface; server-side owner verification before opening private restored routes.
- 30-second health signal/connection view, explicit manual retry, no paid message replay; unknown HTTP POST result stays ambiguous, text retained and user advised to inspect server history before manual retry.
- Native text drafts stored encrypted by Electron `safeStorage` only on Windows, bounded (128k UTF-16 code units, 40 scopes/owner and 30-day expiry). Owner ID comes **only** from current owner row of cookie-authenticated `/api/v1/identity/sessions`, with same-origin exact-URL/no-redirect/JSON/32 KB response guards. After successful verification, an offline renderer may save only to its already confirmed in-process owner context; no offline read without confirmation after reboot. Ciphertext contains owner/origin/scope/savedAt to prevent local file swaps; old unscoped Chromium draft keys are removed on native UI load without migration.
- Native logout explicitly clears text drafts, cookies/storage/cache and last private route; successful origin switch clears the old partition and drafts before opening the new origin. In-flight draft saves use an identity epoch fence.
- Drag/drop uses existing paperclip `useChatAttachments` decoding and validation, no extra binary IPC; native download policy keeps same-origin URL-chain and same-origin blob constraints and rejects file/data/foreign URLs. Downloads cancellable from menu.
- Browser and PWA retain their existing web composer persistence when Electron IPC is absent. Voice and English Relay source imports and UI remain in merged `page.tsx`.

## UNVERIFIED (Linux environment / unavailable dependencies)

- Real Windows Electron UI, DPAPI encryption/decryption, persistent cookies through auth gateway, native single-instance dispatch, shell route, file chooser/drop and real HTTP download.
- Windows NSIS installer byte generation and GUI install/upgrade from 0.11.0, uninstall, tray/notifications, per-user registry/shortcuts; existing lifecycle PowerShell not executed.
- Full workspace `pnpm typecheck`, React/Next build, browser/PWA Playwright, signed update CDN/rollback against live artifacts, Authenticode/SmartScreen. No key and no live signed release.
- Actual server acceptance, billing/usage, network reconnect, account switch via real login. No paid model, VPS, repository publish, secrets or private user data used.

## INTEGRATOR ACTION (Windows and authenticated test deployment)

1. Apply the full patch to exactly `76e4432`, not the v0.11.1 producer overlay as-is. Or apply desktop-only then shared patch once; keep all unrelated root-document-library/main changes for manual merge.
2. Install deps in trusted workspace and run full monorepo `pnpm` typecheck/lint, the web app's tests, and Windows syntax/policy tests. Run unsigned NSIS build with Node 24 and `CSC_IDENTITY_AUTO_DISCOVERY=false` using `electron-builder@26.17.0`, record SHA-256. Avoid using it as an automatic update.
3. With an isolated Windows owner test profile, inspect existing v0.11.0 data and perform install/upgrade/uninstall. Verify DPAPI and scope isolation A/B; test logout and origin switch, including local draft disappearance and 30-day session behavior.
4. Test offline and restart with a pending draft, manual connect/retry, second-instance malicious links, file drag/drop through paperclip, foreign and blob URLs, download cancellation, and unknown POST result handling (no silent POST/rebilling).
5. For rollback preserve the **actual previous** verified installer and hash. Manually uninstall/reinstall only after inspecting release provenance. Update channel stays OFF with `publicKeyPem: null` — never bypass Ed25519 or treat an unsigned EXE as a signed update.
