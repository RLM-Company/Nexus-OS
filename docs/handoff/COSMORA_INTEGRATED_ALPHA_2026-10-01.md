# Integrated hosted alpha — 2026-10-01

The private VPS at `https://13.141.51.16` now runs implementation revision
`f265d59e82362895a50e40505469bfd8c03ccd8f` from draft
[PR #276](https://github.com/RLM-Company/Nexus-OS/pull/276). The stack is #263 → #270 → #271 →
#272 → #273 → #274 → #275 → #276. No PR was merged. Intelligence Graph development remains separate.

Control Center now shows the global emergency stop and owner runtime counters before a project
is selected, including on an empty installation. It identifies server-configured stops, supports
refresh, rejects missing/invalid status, and does not offer unscoped mutations or claim live AI
readiness. Project autonomy, limits, confirmations and recovery remain scoped to a selected project.

Manager work now also checks the global and selected-project stops before enabling task creation,
resume or plan approval. Missing, malformed or unavailable evidence holds those controls disabled.
Unrelated project stops do not disable the selected project. History/downloads and cancellation
remain available. The server remains authoritative between these three-second UI snapshots.

Model/execution status reads now have six-second deadlines in Model Status, the runtime overview
and Manager stop checks. A stalled endpoint no longer leaves an endless loading state. Deadline
failure retains the generic error or unavailable gate and supports manual/scheduled retry;
work mutation requests are unchanged. The initial browser regression reproduced the missing
error after nine seconds before the fix.

## Verification

The complete `pnpm check` passed at `11e3412` in the integrated Windows checkout: formatting, secret scan,
lint, strict TypeScript, 417 unit/API test results, 13 deployment tests, nine production package
builds and all 103 Chromium scenarios. Unchanged package tasks can use Turbo results; browser and
deployment scenarios executed. All 15 focused Control Center scenarios also passed. After the
Manager stop change at `974fbd0`, web lint, strict TypeScript, formatting, secret scan, production
build and all **107** Chromium scenarios passed. This includes five focused Manager cases covering
clearance, unavailable/malformed evidence, guarded resume/approval, retained cancellation and real
downloads from saved tasks after a stop.

After the read-deadline change at `f265d59`, web lint, strict TypeScript, formatting, secret scan,
production build and all **110** Chromium scenarios passed. All 21 focused status/stop scenarios
passed, including three stalled-response/recovery checks. The source still contains the previously
verified unit/API and deployment foundations; no backend source changed after the full gate.

Source archive SHA-256: `8ae885b063d80c8d4a8061d40555e11cfdc391f68949dfaa3b40ca037c54c79a`.
Image: `cosmora-alpha-app:f265d59`.
Image ID: `sha256:a014c7b54836188adad83166bbab80a0bf56863f2ed9a3276835f2addf50cf9d`.

All nine packages built on the VPS. The exact image passed all 13 deployment tests with
`--network none` and contains no private config directory. Compose `up --no-build --wait`
completed successfully; API and web containers are healthy. The actual trusted-HTTPS owner access
verifier exited 0, checking password protection, SQLite, current owner identity, expiry and global
stop. Control Center returned authenticated HTTPS 200. Existing database and certificate volumes,
session and owner password were preserved; previous releases remain available.

A fresh online SQLite snapshot was verified before this update:
`cosmora-2026-09-30T22-57-29-110Z-56e0e886-8ad3-44f7-892e-9e3be979b61d.sqlite`, with its matching
manifest. Both were copied into the protected Windows backup directory and passed checksum and
integrity verification there. Their inherited ACL grants only the current user and SYSTEM access.

GitHub CI run 969 (`36788229858`) failed with no job steps or available log URL; cause remains
unestablished. The separate browser is signed out of GitHub and cannot display this private run's
annotation. A hosted interactive application walkthrough remains unverified because the in-app
client blocks IP navigation. These limitations were not bypassed.

## Operations and remaining gates

- Source: `/opt/cosmora/releases/f265d59`.
- Current Compose wrapper: `/opt/cosmora/runtime/deployctl`.
- Previous wrapper: `/opt/cosmora/runtime/deployctl-974fbd0`.
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
