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
- requires the actual signer thumbprint and subject to match protected environment pins;
- requires the signer certificate to contain the Code Signing EKU;
- requires a timestamp certificate with the Time Stamping EKU;
- emits sanitized `signature-metadata.json` only after all signature checks pass;
- binds that signature metadata to the signed installer's exact filename, byte size and SHA-256;
- requires the final release verifier to match those artifact fields against `release-metadata.json`;
- installs the signed NSIS package into an isolated temporary directory;
- verifies Desktop/Start Menu shortcuts, uninstall registry metadata and executable version
  resources before launching the installed packaged application in no-network smoke mode;
- silently uninstalls and fails if the installation directory, shell shortcuts or uninstall registry
  entry remain;
- generates release metadata and SHA-256 from the signed EXE, never from the unsigned PR artifact;
- generates the update manifest from that signed artifact metadata;
- verifies version, filename, byte size and SHA-256 agreement before uploading the release bundle;
- uploads artifacts only; it does not create a GitHub Release or deploy the update manifest.

## Required environment secrets

Configure these only inside the protected `windows-release` environment:

- `WINDOWS_CSC_LINK` — electron-builder-compatible certificate source;
- `WINDOWS_CSC_KEY_PASSWORD` — password for the signing identity;
- `WINDOWS_CSC_EXPECTED_THUMBPRINT` — pinned signer certificate thumbprint;
- `WINDOWS_CSC_EXPECTED_SUBJECT` — pinned signer certificate subject.

Do not expose these values to ordinary pull-request workflows.

## Required dispatch inputs

- `version` — exact version already committed in `desktop/windows/package.json`;
- `release_page_url` — HTTPS human-facing release page;
- `download_url` — final HTTPS URL whose pathname ends in the exact generated EXE filename;
- `published_at` — ISO 8601 release timestamp;
- `confirm` — exactly `SIGNED_RELEASE`.

The workflow fails closed if any validation, signer pin, EKU, timestamp or Authenticode verification
fails. Rotating the production certificate therefore requires an explicit update to the protected
thumbprint/subject environment secrets before the next signed release.

## Release bundle

A successful signed workflow uploads:

- the signed `Cosmora-Setup-<version>-x64.exe`;
- its blockmap;
- `release-metadata.json`;
- `SHA256SUMS.txt`;
- `signature-metadata.json` with verified signer/timestamp certificate metadata;
- `update-manifest.json`.

The update manifest is suitable for the manual 0.4+ update-check protocol only after the operator
confirms that its URLs are the intended production URLs.

No automatic release publication, VPS deployment, AI activation or updater execution is performed.
