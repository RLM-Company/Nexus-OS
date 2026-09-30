# Integrated hosted alpha — 2026-10-01

The private VPS at `https://13.141.51.16` now runs implementation revision
`11e34128d8cc9115cc0a1a78964ea29046e36530` from draft
[PR #274](https://github.com/RLM-Company/Nexus-OS/pull/274). The stack is #263 → #270 → #271 →
#272 → #273 → #274. No PR was merged. Intelligence Graph development remains separate.

Control Center now shows the global emergency stop and owner runtime counters before a project
is selected, including on an empty installation. It identifies server-configured stops, supports
refresh, rejects missing/invalid status, and does not offer unscoped mutations or claim live AI
readiness. Project autonomy, limits, confirmations and recovery remain scoped to a selected project.

## Verification

The complete `pnpm check` passed in the integrated Windows checkout: formatting, secret scan,
lint, strict TypeScript, 417 unit/API test results, 13 deployment tests, nine production package
builds and all 103 Chromium scenarios. Unchanged package tasks can use Turbo results; browser and
deployment scenarios executed. All 15 focused Control Center scenarios also passed.

Source archive SHA-256: `2984e4758c7a845715f2c9dbac78a9b45911f46252a3b293e61773a3e44c5bcc`.
Image: `cosmora-alpha-app:11e3412`.
Image ID: `sha256:7068d969dbbe22fc3a0849f3c3be8482e4462b783ab64a82b9339a5423a183f1`.

All nine packages built on the VPS. The exact image passed all 13 deployment tests with
`--network none` and contains no private config directory. Compose `up --no-build --wait`
completed successfully; API and web containers are healthy. The actual trusted-HTTPS owner access
verifier exited 0, checking password protection, SQLite, current owner identity, expiry and global
stop. Control Center returned authenticated HTTPS 200. Existing database and certificate volumes,
session and owner password were preserved; previous releases remain available.

GitHub CI run 965 (`36785594872`) failed with no job steps or available log URL; cause remains
unestablished. The separate browser is signed out of GitHub and cannot display this private run's
annotation. A hosted interactive application walkthrough remains unverified because the in-app
client blocks IP navigation. These limitations were not bypassed.

## Operations and remaining gates

- Source: `/opt/cosmora/releases/11e3412`.
- Current Compose wrapper: `/opt/cosmora/runtime/deployctl`.
- Previous wrapper: `/opt/cosmora/runtime/deployctl-ba5d4eb`.
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
