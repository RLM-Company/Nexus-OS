# Kosmora Code and Windows integration — 9 October 2026

Integrated in an isolated local clone from `7e12e12c5a95b6e29a506052115f66c2ccda78d9`, branch
`codex/integrate-code-windows-20261009`. The supplied Code and desktop archives were based on
`b15912d23ab15a99e38370e22e472faf28c99961`; the Code full patch applied without conflicts.
The shared integration checkout, VPS, credentials and production database were not modified.

## Implemented functionality

- `/code-agent` and project-bound `/api/v1/projects/:projectId/code-agent`: immutable repository
  tree and selected source files, persisted proposals, editable file selection and exact unified
  diff, reviewed snapshot checks, explicit single-use confirmation for a separate branch/draft PR,
  cancellation and read-only reconciliation of uncertain publication. A0/A1/A2 and existing policy,
  scope, permission expiry/revocation, owner/project identity and emergency-stop boundaries apply.
- Native tool transcripts in the OpenAI-compatible gateway remain capability-gated. The funded
  profile is **unchanged** (`tool_calling=false`). Its operational path uses server-validated JSON
  file selection/context and a file proposal through the existing analyst draft route.
- The OCI executor uses an operator-pinned local image, no network, non-root/read-only filesystem,
  capped output/resources/deadline and verified daemon cleanup. An unavailable executor prevents
  publication; there is no host execution fallback or automatic dependency installation.
- Windows 0.11.0 retains the existing app ID/profile and remembered browser login; adds persisted
  window bounds, allowlisted `kosmora://` routes including `/code-agent`, download preferences,
  opt-in tray/notifications and pinned-key signed release staging with manual installation.
- Fixed rollback verification: persisted mutable hashes alone are insufficient. The signed
  manifest is now stored and revalidated against the packaged Ed25519 key and current origin,
  then actual installer bytes are hashed again. Symlinks are rejected. Origin changes/manifest
  expiry are checked again before staged files are accepted. The public key remains unconfigured
  in this release, so updates are disabled rather than accepting unsigned releases.

## Verification actually performed

| Check                                                 | Result                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pinned workspace install                              | PASS (`--frozen-lockfile`); offline cache lacked metadata, normal install completed; root lockfile unchanged |
| API, gateway, tool-runtime and web TypeScript         | PASS                                                                                                         |
| Scoped source lint                                    | PASS                                                                                                         |
| Code API + existing GitHub integration fixtures       | 41/41 PASS; includes full text-only proposal/review/check/confirmed draft PR path                            |
| General chat / background Manager regression fixtures | 23/23 PASS                                                                                                   |
| Model gateway suite                                   | 89/89 PASS                                                                                                   |
| Tool runtime suite                                    | 29 PASS, 3 actual OCI tests SKIPPED without configured image/runtime                                         |
| Windows syntax/policy/crypto tests                    | 24/24 PASS                                                                                                   |
| Real Chromium Code UI                                 | 3/3 PASS using complete intercepted API fixtures on an isolated web server at port 3412                      |
| Whitespace and secret scan                            | PASS                                                                                                         |

Windows transport tests needed a test-only adaptation: Windows cannot directly spawn a shebang
fixture with `shell:false`. The test mock maps only registered fixture scripts to real Node child
processes, preserving the production runner arguments and lifecycle. Production code was not given
a mock executor or a shell fallback.

Repeat the free Code UI suite from `apps/web` with:
`node node_modules/@playwright/test/cli.js test --config playwright.code-agent.config.ts`.
This deliberately checks UI state/approval/reconciliation against intercepted API responses;
it does not claim live GitHub writes or live OCI isolation.

## Actual Windows build

Final local NSIS build succeeded with electron-builder 26.17.0 and Electron 44.5.1:
`desktop/windows/dist/Kosmora-Setup-0.11.0-x64.exe`.
SHA-256: `6a670bec53d659747674343414864b6828f6da4cb03ff19c9f2f43261f717c72`.
Windows reports `NotSigned`. The final ASAR's main/state/update-policy/update-service/trust
files match the final source bytes; its version and entry point are 0.11.0/main.cjs.
It was not installed or launched on the owner's device.

This bundled runtime has no npm. The first pnpm dlx builder also had broken global-store
resolution. Build dependencies were therefore installed in the separate sibling
`windows-build-tools` directory (not the repository), with a hoisted electron-builder 26.17.0
and real npm 11.6.0. The final build used that directory's `.bin` on PATH and
`--config.npmRebuild=false --config.nodeGypRebuild=false` because the thin shell has no native
runtime dependencies. Root/desktop dependency declarations and root lockfile did not change
for these local build tools.

## Integration boundaries

Shared files to merge carefully with the other implementation blocks:
`apps/api/src/app.ts`, `general-chat-routes.ts`, `general-chat-background-run-coordinator.ts`,
`manager-work-coordinator.ts`, `manager-background-run-coordinator.ts`,
`apps/web/src/app/workspace-sections.tsx`, `packages/contracts/src/model.ts`,
gateway adapters/gateway/types and `packages/tool-runtime/src/index.ts`.
No shared DB schema/migration or root dependency changes were introduced.

Before live Code execution, provision a dedicated immutable OCI image/executor and verify actual
cleanup/denial behavior. Do not expose a production Docker socket or production secrets to model
code. Actual paid-model proposal output and an explicitly approved live draft PR remain unverified.
Windows native GUI, protocol registration, upgrade/uninstall and Authenticode signing also remain
unverified locally; do not install on the owner's device or bypass the disposable-CI lifecycle guard.
