# Model status and VPS update — 2026-10-01

This is the historical Model Status checkpoint. See the
[integrated alpha checkpoint](COSMORA_INTEGRATED_ALPHA_2026-10-01.md) for the active release.

The VPS was verified at `ba5d4eb48ef520fbe3dbbcb72226d5e37f8cb121` from draft
[PR #272](https://github.com/RLM-Company/Nexus-OS/pull/272), stacked on
[PR #271](https://github.com/RLM-Company/Nexus-OS/pull/271). No PR was merged.

Model Status now reads both provider configuration and global execution status. An active
emergency stop takes precedence; unavailable or malformed execution status produces an error.
Configured credentials no longer produce “Готово к запуску”. The page distinguishes provider
configuration from a verified response and lets the owner refresh both states. Private stop
reasons and unknown metadata fields are not rendered.

## Deployment evidence

- Source archive SHA-256: `896262e0b6b67318a0bb31f7db9ef18edcd24bf5986804d517af05434e496448`.
- Image: `cosmora-alpha-app:ba5d4eb`.
- Image ID: `sha256:08978ebf03b76a807aef79e02b753cb8c2e3260e75738c419798c8133abfe331`.
- All nine production packages built on the VPS; the image contains no private config directory.
- Compose `up --no-build --wait` completed successfully. API and web containers are healthy.
- Authenticated HTTPS returned 200 for the interface, Model Status, Control Center, SQLite
  health, identity sessions and operations status; unauthenticated health returned 401.
- The previous database, owner session, Basic password and certificate volumes were preserved.
- Only edge publishes host ports. Model requests remain globally stopped, with zero route
  attempts after deployment. No live model credential or paid request was introduced.

At this checkpoint the source was `/opt/cosmora/releases/ba5d4eb`; the Compose wrapper was
`/opt/cosmora/runtime/deployctl`, with `/opt/cosmora/runtime/deployctl-8ade62f` retained for rollback.
See the [operations checkpoint](COSMORA_ALPHA_OPERATIONS_2026-10-01.md) for protected configuration,
backup and recovery evidence. Both previous releases remain available.

## Validation and remaining gates

All nine focused Model Status Chromium scenarios passed, including stop activation/clearance,
unavailable/malformed status and responsive layout. The updated secret-field audit passed.
Web lint, strict TypeScript, production build, formatting and secret scan passed.

GitHub CI run 961 (`36783953524`) failed with no job steps or available log URL. Its cause remains
unestablished. A hosted interactive browser walkthrough remains unverified because the Codex
in-app client blocked IP navigation. Local browser tests and HTTPS checks establish different
parts of the evidence; neither is claimed as a hosted walkthrough.

The owner session still expires `2026-10-07T21:02:42.963Z`. Rotation and certificate renewal
observation remain operational gates. Live AI requires a privately configured and reviewed
provider, a no-cost preflight and explicit authorization for a capped trial.
