# Preparing the next API update while the VPS is unavailable

This runbook prepares a release; it does not authorize or execute a server change.
The owner is restoring the VPS separately. Existing web, sidebar, logo, styles,
owner login, edge, executor, Windows installer and provider configuration stay in
their current state during this preparation.

## Source package

After the final source commit and its full CI pass, run the existing packager from
the clean checkout, with an absolute output directory outside it:

```sh
node scripts/package-feature-release.mjs /PRIVATE/release-output
```

It runs the secret scan, refuses dirty source, links/submodules, private env files,
databases and non-source directories, then writes `source.tar.gz` and `manifest.json`.
The manifest binds the commit, every source path's SHA-256/size and the migration
journal. It records `production_deployed: false`. Keep that manifest with the archive.
The package contains this runbook and `scripts/vps-preactivation-check.mjs`.

## After server access is restored

Before any activation the integrator must collect actual service/image IDs,
Compose overlays, volume mappings, database migration history and protected UI
checksums. Record the previous API image and retain it locally. Do not infer these
values from the source repository or replace private settings from examples.

Wait for active work, provider operations and GitHub publication/reconciliation
to settle using the existing idle/drain guards. Preserve unknown outcomes. Do not
clear emergency stops, auto-renew credentials or resume paid work as an update step.

Use the existing `deploy/alpha/sqlite-backup.mjs create` tool on the actual data
volume. Keep its private `.sqlite` and `.sqlite.json` files together, verify them,
and retain a protected copy independently of the VPS. This is an online SQLite
backup including committed WAL data, not a filesystem copy of a running database.

Copy the verified backup into a separate private **offline** file; keep the backup
itself immutable. Build the candidate with the locked dependencies. Then run:

```sh
node scripts/vps-preactivation-check.mjs \
  --database /PRIVATE/offline-copy.sqlite \
  --backup-manifest /PRIVATE/backups/cosmora-EXACT-NAME.sqlite.json
```

Only the exact manifest returned by the backup tool is valid. The offline copy
must have matching bytes and be a separate file, without WAL/SHM/journal sidecars.
The checker verifies history, rehearses the actual migrations in a disposable file,
checks integrity/FKs and confirms both inputs stayed unchanged. A successful report
says `OFFLINE_REHEARSAL_PASSED`; it is not a server health or live-model result.

An unknown migration hash/history gap or a legacy bridge requirement blocks the
rehearsal. Investigate the actual database and preserved upgrade tools; do not
invent migration stamps, discard accounting or run legacy bridge scripts blindly.

## Activation and rollback boundary

The future activation should update only the reviewed API image unless another
component has a separately reviewed change. Verify candidate startup against a
private migrated copy, identity boundaries, health, current stored data and public
login access before opening normal operation. No fixture data belongs in production.

Keep the old API image, configuration, service inventory and backup manifest until
acceptance. An image rollback requires verified compatibility with the resulting
schema. Database restoration is a separate maintenance operation into a new volume;
never replace a database containing newer user work with an older backup silently.
Preserve the failed volume and reconciliation evidence if recovery is required.

Only after deployment and owner access are confirmed should the explicitly bounded
live chat/Work, media and model-authored Coscode acceptance scenarios run. Windows
on the owner's laptop remains a separate deferred acceptance step.
