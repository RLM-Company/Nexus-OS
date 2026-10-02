# Integrated hosted alpha — 2026-10-01

The private VPS at `https://13.141.51.16` now runs implementation revision
`8851cea1858dbaf4cdf2ad984831b61de3067643` from draft
[PR #277](https://github.com/RLM-Company/Nexus-OS/pull/277). The stack is #263 → #270 → #271 →
#272 → #273 → #274 → #275 → #276 → #277. No PR was merged. Intelligence Graph development remains separate.

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

Ordinary and project chat now use the same execution gate as Manager. Send, Enter submission and
project promotion require valid clearance for the global and selected-project stops. Drafts remain
editable and retained while paused or unavailable; recovery enables controls without sending the
draft automatically. Switching to ordinary chat removes the selected-project scope. Polling and
read deadlines remain three and six seconds, respectively.

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

After the shared chat gate at `8851cea`, web lint, strict TypeScript, formatting, secret scan,
production build and all **114** Chromium scenarios passed. Ten focused chat/Manager scenarios
also passed. This adds four chat regressions for draft retention, selected-project scope,
stalled-status recovery and guarded project promotion. Backend source remains unchanged.

Source archive SHA-256: `4567d248946229fadab665212f61f62440b16ea34466b5c2812e5fd52d6a87ba`.
Image: `cosmora-alpha-app:8851cea`.
Image ID: `sha256:90fef57047a53a9444fab7a5494310e511b451b1dc9842ada07caa0b41ba431b`.

All nine packages built on the VPS. The exact image passed all 13 deployment tests with
`--network none` and contains no private config directory. Compose `up --no-build --wait`
completed successfully; API and web containers are healthy. The actual trusted-HTTPS owner access
verifier exited 0, checking password protection, SQLite, current owner identity, expiry and global
stop. The interface, Control Center and Model Status returned authenticated HTTPS 200.
Existing database and certificate volumes,
session and owner password were preserved; previous releases remain available.

A fresh online SQLite snapshot was verified before this update:
`cosmora-2026-09-30T23-19-55-766Z-4d4e6476-a553-4f65-bc64-0af0de643f34.sqlite`, with its matching
manifest. Both were copied into the protected Windows backup directory and passed checksum and
integrity verification there. Their inherited ACL grants only the current user and SYSTEM access.

GitHub CI run 971 (`36790400174`) originally failed with no job steps or available log URL.
That symptom was later reproduced by run 972 before a diagnostic retry received an actual hosted
runner. Run 972 attempt 2 then completed the full workflow successfully on #277 head `04aa300`,
including all 114 Chromium scenarios. The follow-up owner-session Settings change in draft #278
also passed its complete hosted gate in run 1002 on `13e2c0d`, including 13 deployment test files
and all 116 Chromium scenarios. The earlier no-step failures are therefore treated as runner
allocation failures rather than evidence of a product-test failure. #278 remains source-only and
has not replaced the deployed `8851cea` image.

A hosted interactive application walkthrough remains unverified because the in-app client blocks
IP navigation. That limitation was not bypassed.

## Operations and remaining gates

- Source: `/opt/cosmora/releases/8851cea`.
- Current Compose wrapper: `/opt/cosmora/runtime/deployctl`.
- Previous wrapper: `/opt/cosmora/runtime/deployctl-f265d59`.
- Manual owner-access command: `/opt/cosmora/runtime/verify-owner-access`.
- Protected configuration: `/opt/cosmora/private`; database backups: `/opt/cosmora/backups`.
- Owner session expiry: `2026-10-07T21:02:42.963Z`. Rotate before expiry and recreate edge.

Model execution remains globally stopped, with no live key and no paid request. Clear stop state
does not itself establish reviewed provider routes, sufficient project budgets or a successful
model response. Privately configure the provider, run no-cost preflight and obtain authorization
for a capped live trial before that gate can be completed. Hosted GitHub CI is now established for
the release stack through draft #278; owner merge review remains separate. Certificate renewal has
not yet been observed. Draft #280 adds a read-only certificate lifetime gate and expiry reporting,
but that verifier is not deployed until its own CI and an explicit VPS update are completed.

See the [deployment runbook](../../deploy/alpha/README.md),
[backup/recovery checkpoint](COSMORA_ALPHA_OPERATIONS_2026-10-01.md),
[Model Status change](COSMORA_MODEL_STATUS_2026-10-01.md) and
[owner-access utility](COSMORA_OWNER_ACCESS_2026-10-01.md) for detailed evidence.
