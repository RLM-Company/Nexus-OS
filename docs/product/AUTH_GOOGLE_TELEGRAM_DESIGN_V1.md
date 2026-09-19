# Cosmora Google + Telegram authentication design v1

## Goal

Provide one Cosmora account that can be verified through Google or Telegram and then issue a Cosmora-owned session. External provider tokens must never become the application session.

## Provider flows

### Google

Use Google Identity Services / OAuth Authorization Code flow with PKCE. The server should validate the returned ID token when one is used for sign-in, including signature, issuer, audience and expiry. Google recommends using the provider's stable subject identifier as the account key rather than email alone.

### Telegram

Use Telegram Login OIDC with Authorization Code + PKCE. Telegram documents a server-side validation step for the ID token, including signature, issuer, audience and expiry. Allowed redirect URLs must be registered with BotFather.

## Common transaction

start -> generate state/nonce/code_verifier -> redirect -> callback(code,state) -> server-side token exchange -> verify provider identity -> map/link account -> issue Cosmora session

The browser contract stores only the transaction binding values needed to complete the flow. It does not define a raw access-token field.

## Hard security requirements

- Authorization Code + PKCE; do not add the legacy implicit flow.
- Transaction-specific state and nonce.
- Exact registered redirect URI.
- TLS/HTTPS for authorization and callback paths.
- Short-lived, single-use authorization codes.
- Server-side validation of provider identity tokens.
- Do not use email alone as the durable external subject key.
- Do not put provider client secrets in the web bundle or localStorage.
- Issue a Cosmora session separately from the provider credential.
- Revoke/unlink must invalidate the corresponding Cosmora linkage and session according to the identity policy.
- Keep authentication failures generic at the UI boundary; detailed provider errors stay server-side.

## Current release boundary

This PR adds only shared contracts and design documentation. The actual OAuth endpoints, provider secrets, token exchange, session issuance and database persistence require backend/auth work and must be reviewed separately.

## Sources

- Google Identity Services / Sign in with Google documentation.
- Google OAuth 2.0 guidance and browser-based application guidance.
- Telegram Login / OIDC documentation.
- IETF RFC 9700 (OAuth 2.0 Security Best Current Practice).
- IETF RFC 7636 (PKCE).
