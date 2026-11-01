# Google Drive connection activation

The connection flow is implemented; archive assembly and restore-to-chat are a
separate pending block. Enabling this connector does not migrate or automatically
upload existing user data. Do not present the folder connection as a complete backup.

## Prerequisites

- A public HTTPS **domain** in `COSMORA_DEMO_DOMAIN` / `WEB_ORIGIN`, working TLS and
  normal owner authentication. Google does not accept a public raw IP as a web
  OAuth callback host. Do not bypass TLS/authentication or use a temporary tunnel
  to silently change the destination of user data.
- A dedicated Google web OAuth client and Drive API enabled in that project.
  Keep the existing Google sign-in client separate; its scopes are unchanged.
- The owner grants Google consent in the same settings tab that starts the flow.
  Registration/app settings are operator work; the user should not need to enter
  provider keys in the product.

Register exactly:

`https://YOUR_DOMAIN/api/v1/storage/drive/callback`

The code requests only `https://www.googleapis.com/auth/drive.file`. No Drive-wide
read/write scope, Picker API key or browser-exposed Client Secret is required for
creating the Kosmora folder. Arbitrary Drive browsing is not implemented.

## API-only secrets

Use `drive.env.example` as the format for `deploy/alpha/private/drive.env`.
Compose loads this optional file into **API only**, with raw values. Nothing is
passed to Next.js, Caddy, the model, a public config endpoint, or an archive.

- `KOSMORA_DRIVE_ENABLED=1`
- `KOSMORA_DRIVE_CLIENT_ID`: dedicated web client ID.
- `KOSMORA_DRIVE_CLIENT_SECRET`: that client's secret.
- `KOSMORA_DRIVE_ENCRYPTION_KEY`: persistent random 32-byte key, canonical base64.

Create/store the key in the deployment secret store. Keep it separate from SQLite
exports and database backups. Losing/changing it requires reconnecting affected
accounts; it does not erase the user's Drive files. Never paste actual values in
issues, logs or PR descriptions. Example files intentionally contain no working key.

Enabled but incomplete/invalid configuration fails API startup. Without the flag,
the settings panel reports unavailable. Local disconnect remains possible without
Google credentials or the encryption key, so stale secrets can still be removed.
Deleting local data does not delete the user's copies on Drive.

## Flow and acceptance

1. Apply migration 0060 using the existing backup/migration runbook; deploy API and
   web together. Preserve the secret key across restarts. Do not clear emergency
   stops or bypass the deferred VPS acceptance procedure.
2. Open settings, connect Google Drive, and complete consent in that same tab.
   The callback is owner-authenticated. A temporary tab proof supplements
   owner/session-bound one-use state and server-held PKCE.
3. Check the actual folder exists in the selected Google account and settings
   reports connected. An interrupted folder operation reports needs-check; use
   read-only check, then explicit retry if needed. Retry reuses the same file ID.
4. Verify cancel, duplicate callback, missing tab proof, revoked session, disconnect
   during exchange, and reconnect. Never treat a copied link in another tab as consent.
5. Confirm token ciphertext persists, no Google token/Client Secret appears in
   HTTP responses or privacy exports, and disconnect clears local credentials.

The API scrubs Drive query parameters from request logging. If additional proxy
access logging is enabled, redact the callback query there too. The callback has
no-store/no-referrer headers; the panel immediately replaces its URL fragment.
Google credentials never enter sessionStorage; only a short-lived browser proof does.

Automated tests use real HTTP handlers, SQLite and crypto with Google HTTP fixtures;
browser tests verify the panel and tab flow. They do not replace live Google consent
and real TLS acceptance. No user files were transferred during development tests.

Sources: [Google web-server OAuth and redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[token storage](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).
