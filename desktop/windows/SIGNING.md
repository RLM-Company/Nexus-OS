# Windows release signing contract

Cosmora's pull-request Windows build is intentionally unsigned and must never receive signing
credentials.

Signed builds are isolated in the manual GitHub Actions workflow
`.github/workflows/windows-release.yml`.

## Trust boundary

The signed workflow:

- runs only through `workflow_dispatch`;
- uses the protected GitHub environment `windows-release`;
- requires the operator to type `SIGNED_RELEASE`;
- requires the requested version to exactly match `desktop/windows/package.json`;
- reads certificate material only from environment secrets;
- builds first, then verifies Windows Authenticode status is `Valid`;
- generates release metadata and SHA-256 from the signed EXE, never from the unsigned PR artifact;
- generates the update manifest from that signed artifact metadata;
- verifies version, filename, byte size and SHA-256 agreement before uploading the release bundle;
- uploads artifacts only; it does not create a GitHub Release or deploy the update manifest.

## Required environment secrets

Configure these only inside the protected `windows-release` environment:

- `WINDOWS_CSC_LINK` — electron-builder-compatible certificate source;
- `WINDOWS_CSC_KEY_PASSWORD` — password for the signing identity.

Do not expose these values to ordinary pull-request workflows.

## Required dispatch inputs

- `version` — exact version already committed in `desktop/windows/package.json`;
- `release_page_url` — HTTPS human-facing release page;
- `download_url` — final HTTPS URL whose pathname ends in the exact generated EXE filename;
- `published_at` — ISO 8601 release timestamp;
- `confirm` — exactly `SIGNED_RELEASE`.

The workflow fails closed if any validation or Authenticode verification fails.

## Release bundle

A successful signed workflow uploads:

- the signed `Cosmora-Setup-<version>-x64.exe`;
- its blockmap;
- `release-metadata.json`;
- `SHA256SUMS.txt`;
- `update-manifest.json`.

The update manifest is suitable for the manual 0.4+ update-check protocol only after the operator
confirms that its URLs are the intended production URLs.

No automatic release publication, VPS deployment, AI activation or updater execution is performed.
