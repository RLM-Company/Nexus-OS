# Hosted owner access verification — 2026-10-01

This records the original utility installation. See the
[integrated alpha checkpoint](COSMORA_INTEGRATED_ALPHA_2026-10-01.md) for the active deployment.

[Draft PR #273](https://github.com/RLM-Company/Nexus-OS/pull/273) adds a manual HTTPS access
verifier at implementation revision `d0eecb4fca828d6ba3b50a95a11ffc09a1ff7738`, stacked on
[PR #272](https://github.com/RLM-Company/Nexus-OS/pull/272). No PR was merged.

The API health endpoint intentionally does not resolve an owner session. Therefore healthy
containers and a 200 health response cannot prove usable authenticated application access.
The verifier checks both layers through Caddy, including the current session and its expiry.

## Installed command

Run `/opt/cosmora/runtime/verify-owner-access` on the VPS during manual maintenance. It invokes
the current Compose wrapper with a temporary API-image container and read-only mounts for the
private password and exact committed verifier. No application rebuild or database migration was
needed; at installation the application remained at `ba5d4eb` and was not restarted for this utility.
The verifier source is `/opt/cosmora/operations/d0eecb4/deploy/alpha/verify-access.mjs`.

- Transferred source archive SHA-256:
  `8195b81b8e86a7d5c48b7226deb20dafa28bb268ae43617413d8a33def0f8c9b`.
- Verifier file SHA-256: `eff21698f9c44ca48d30c68f4d416cd4d713c169619dfd1c4926f7fab5eea98a`.
- Both hashes matched on Windows and the VPS before execution.
- All seven verifier scenarios passed in the deployed Linux image with `--network none`.
- All 13 deployment tests passed on Windows; formatting, syntax and secret scan passed.
- The actual trusted-HTTPS edge check exited 0: unauthenticated UI/health protected, authenticated
  UI available, SQLite healthy, current hosted owner session valid, global model stop active.
- The reported session expiry remains `2026-10-07T21:02:42.963Z`.

The command fails when the session has 24 hours or less remaining. It never follows redirects,
prints credentials/private response bodies, calls a model, rotates sessions or clears stops.
Authenticated GETs can update the session's normal last-seen timestamp. No scheduler was installed.
Rotate manually before expiry and recreate edge to load the new bearer token, then rerun this
command. A PASS establishes access rather than a verified live-model response.

GitHub CI run 963 (`36784896290`) failed with no job steps or available log URL; cause unestablished.
See the [current application checkpoint](COSMORA_MODEL_STATUS_2026-10-01.md) and
[deployment runbook](../../deploy/alpha/README.md) for remaining gates and rotation instructions.
