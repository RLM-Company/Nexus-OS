# B0.3 review — owner session inventory and revocation

Date: 2026-08-28  
Scope: provider-neutral session control on the owner API

## Contract

Authenticated owners can list their own sessions and revoke one exact session:

- `GET /api/v1/identity/sessions`;
- `POST /api/v1/identity/sessions/:sessionId/revoke`.

The response contains session ID, actor ID/kind, assurance, lifecycle timestamps, status, revocation
metadata and a `current` marker. It never contains the raw bearer token or stored token hash.
Device name, IP and user-agent are intentionally absent until their collection and retention policy
is approved.

## Security invariants

- The common owner-only API boundary runs before both routes.
- Every lookup is scoped by the verified `owner_id`.
- A missing and a cross-owner session both return 404 / `IDENTITY_SESSION_NOT_FOUND`.
- Revocation records the verified owner actor as `revoked_by`.
- Repeating a revoke is idempotent: it returns the existing terminal state and does not replace the
  original reason or duplicate the audit event.
- Revoking the current session returns one safe response; the same bearer token is rejected on the
  next request.
- Listing reconciles time-expired active rows to `expired` transactionally and writes one audit
  event. Repeated listing does not duplicate that event.

## Deferred

This increment does not issue sessions, add login/enrollment, collect device metadata, select an
identity/MFA provider or create a step-up issuance endpoint. Those require the production provider
and approved privacy/retention decisions.
