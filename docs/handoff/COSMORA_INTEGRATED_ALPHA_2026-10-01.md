# Integrated hosted alpha — 2026-10-01

The private VPS at `https://13.141.51.16` now runs implementation revision
`974fbd0a91394e092cc5ef8c6f6ba72c7a031bd4` from draft
[PR #275](https://github.com/RLM-Company/Nexus-OS/pull/275). The stack is #263 → #270 → #271 →
#272 → #273 → #274 → #275. No PR was merged. Intelligence Graph development remains separate.

Control Center now shows the global emergency stop and owner runtime counters before a project
is selected, including on an empty installation. It identifies server-configured stops, supports
refresh, rejects missing/invalid status, and does not offer unscoped mutations or claim live AI
readiness. Project autonomy, limits, confirmations and recovery remain scoped to a selected project.

Manager work now also checks the global and selected-project stops before enabling task creation,
resume or plan approval. Missing, malformed or unavailable evidence holds those controls disabled.
Unrelated project stops do not disable the selected project. History/downloads and cancellation
remain available. The server remains authoritative between these three-second UI snapshots.

## Verification

The complete `pnpm check` passed at `11e3412` in the integrated Windows checkout: formatting, secret scan,
lint, strict TypeScript, 417 unit/API test results, 13 deployment tests, nine production package
builds and all 103 Chromium scenarios. Unchanged package tasks can use Turbo results; browser and
deployment scenarios executed. All 15 focused Control Center scenarios also passed. After the
Manager stop change at `974fbd0`, web lint, strict TypeScript, formatting, secret scan, production
build and all **107** Chromium scenarios passed. This includes five focused Manager cases covering
clearance, unavailable/malformed evidence, guarded resume/approval, retained cancellation and real
downloads from saved tasks after a stop.

Source archive SHA-256: `89d38d7ce5f13dfff5f9b707efe669e91c3b181c86e58a51966e6c672fb8e151`.
Image: `cosmora-alpha-app:974fbd0`.
Image ID: `sha256:9b2660734c78f537d8c0f42343338c783b0ff2f7da447eb758ef3f660a214c0a`.

All nine packages built on the VPS. The exact image passed all 13 deployment tests with
`--network none` and contains no private config directory. Compose `up --no-build --wait`
completed successfully; API and web containers are healthy. The actual trusted-HTTPS owner access
verifier exited 0, checking password protection, SQLite, current owner identity, expiry and global
stop. Control Center returned authenticated HTTPS 200. Existing database and certificate volumes,
session and owner password were preserved; previous releases remain available.

A fresh online SQLite snapshot was verified before this update:
`cosmora-2026-09-30T22-44-02-544Z-04f49c29-6eb1-4d6e-b637-d54014bb7be3.sqlite`, with its matching
manifest. Both were copied into the protected Windows backup directory and passed checksum and
integrity verification there. Their inherited ACL grants only the current user and SYSTEM access.

GitHub CI run 967 (`36786951788`) failed with no job steps or available log URL; cause remains
unestablished. The separate browser is signed out of GitHub and cannot display this private run's
annotation. A hosted interactive application walkthrough remains unverified because the in-app
client blocks IP navigation. These limitations were not bypassed.

## Operations and remaining gates

- Source: `/opt/cosmora/releases/974fbd0`.
- Current Compose wrapper: `/opt/cosmora/runtime/deployctl`.
- Previous wrapper: `/opt/cosmora/runtime/deployctl-11e3412`.
- Manual owner-access command: `/opt/cosmora/runtime/verify-owner-access`.
- Protected configuration: `/opt/cosmora/private`; database backups: `/opt/cosmora/backups`.
- Owner session expiry: `2026-10-07T21:02:42.963Z`. Rotate before expiry and recreate edge.

Model execution remains globally stopped, with no live key and no paid request. Clear stop state
does not itself establish reviewed provider routes, sufficient project budgets or a successful
model response. Privately configure the provider, run no-cost preflight and obtain authorization
for a capped live trial before that gate can be completed. Successful GitHub CI and owner merge
review remain separate gates. Certificate renewal has not yet been observed.

See the [deployment runbook](../../deploy/alpha/README.md),
[backup/recovery checkpoint](COSMORA_ALPHA_OPERATIONS_2026-10-01.md),
[Model Status change](COSMORA_MODEL_STATUS_2026-10-01.md) and
[owner-access utility](COSMORA_OWNER_ACCESS_2026-10-01.md) for detailed evidence.
