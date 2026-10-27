# Cosmora alpha operations — 2026-10-01

This is the historical operations checkpoint for #271. See the
[integrated alpha checkpoint](COSMORA_INTEGRATED_ALPHA_2026-10-01.md) for the active release.

## Verified deployment revision

The VPS was verified at `8ade62fa77eeee1837a51413787c4c68846acebd` from draft
[PR #271](https://github.com/RLM-Company/Nexus-OS/pull/271), stacked on
[PR #270](https://github.com/RLM-Company/Nexus-OS/pull/270). This replaces the initial
[VPS boot](COSMORA_VPS_BOOT_2026-10-01.md). No PR was merged and the Intelligence Graph remains separate.

Source archive SHA-256: `a6bbb7cf4cfa335df2f27cb37004f17b22fbc42cef6b053ea39b6c94f1922508`.
Docker image: `cosmora-alpha-app:8ade62f`.
Image ID: `sha256:b6f7ff3b562d126c54fff53ef490d60639da61132a6cf06e53b697ac5fb98724`.
All nine production package builds completed. The image contains no private credential directory.

The runtime uses the committed base Compose file, committed IP overlay and an image override.
Caddy's domain and IP configurations import the same owner authentication and API proxy rules.
API and Next have health checks; Caddy waits for both to be healthy before startup.
Compose completed `up --wait` successfully and both application containers report healthy.

## Maintenance paths

- Source at this checkpoint: `/opt/cosmora/releases/8ade62f`.
- Shared private configuration: `/opt/cosmora/private`, mode 0700; files mode 0600. Both release
  directories link to it so rollback continues to use current credentials and sessions.
- Current Compose wrapper: `/opt/cosmora/runtime/deployctl`.
- Previous release wrapper: `/opt/cosmora/runtime/deployctl-7960579`; its image and source remain.
- Protected database backups: `/opt/cosmora/backups`.
- Restore rehearsal copy: `/opt/cosmora/restore-drill-20261001`; the rehearsal container was stopped.

Use the current wrapper for `ps`, `logs`, `exec`, `restart`, `run` and `up`. It fixes the Compose
project name to `cosmora-alpha`, keeping database and certificate volumes stable. An application
rollback must still be compatible with the database schema; it is not a database restore.
The [deployment runbook](../../deploy/alpha/README.md) describes backup and recovery requirements.

## Evidence

- Six deployment checks passed on Windows and in the newly built Linux image with `--network none`:
  committed WAL recovery, independent snapshots, tampering, missing source, directory boundaries,
  private Linux permissions, and degraded/redirected health responses.
- The exact new image passed the production-auth Manager fixture with `--network none`: project
  chat plus three streamed work stages, Critic PASS and download, using a temporary database.
- Both Caddy configurations validated with Caddy 2.11.4. Base plus IP Compose configuration validated.
- After updating, authenticated external HTTPS checks returned 200 for the interface, Control
  Center, SQLite health, identity sessions and operations status. Unauthenticated interface and
  health requests returned 401. Certificate validation stayed enabled.
- API and Next expose no host ports. The web container has no model key, owner-session token or
  Basic authentication hash in its environment.
- The live SQLite volume was backed up through its online backup API while mounted read-only.
  The snapshot and manifest are mode 0600 and passed hash/integrity verification.
- That snapshot started a separate production API with `--network none` and no published ports.
  SQLite was healthy, the owner session resolved, and the emergency stop remained active with
  zero route attempts. The active database volume was not replaced.
- A matching protected copy of both backup files was transferred to the owner's Windows computer
  and verified there. This provides a copy outside the VPS.
- Formatting, secret scan, JavaScript syntax, lint and TypeScript passed; unchanged application
  lint/type checks used existing Turbo results. Application source behavior was not changed here.

GitHub run 959 (`36781605351`) failed with `steps: null` and no job log URL. Its cause remains
unestablished; do not label the local/container verification as a successful GitHub runner result.

## Remaining gates

The interface remains at `https://13.141.51.16` behind the existing separate owner password.
Model execution remains stopped by `RUNTIME_EMERGENCY_STOP=true`; no live credential is configured
and the hosted process reports zero route attempts. No paid request was sent.

The owner session expires `2026-10-07T21:02:42.963Z`; rotate it using the runbook and recreate edge
to load the replacement token. Caddy manages the IP certificate automatically; future renewal has
not yet been observed. A hosted interactive browser walkthrough remains unverified because the
Codex in-app client blocked IP navigation. No browser restriction was bypassed.

Before live AI, configure and review the provider route privately, run the no-cost preflight,
clear both environment and persisted stops deliberately, and authorize a capped live trial.
Successful GitHub CI and owner merge review remain separate gates.
