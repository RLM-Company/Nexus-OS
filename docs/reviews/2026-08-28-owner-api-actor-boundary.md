# B0.3 review — owner API actor boundary

Date: 2026-08-28  
Scope: external request authorization after verified identity resolution

## Decision

The current external `/api/v1` surface is the owner's control plane. Only an authenticated actor
with `actor_kind = owner` may pass the common request boundary. Valid `agent` and `system`
sessions are authenticated first and then rejected with HTTP 403 / `FORBIDDEN`.

`GET /api/v1/health` remains public and does not resolve identity.

## Why this is fail-closed

Identity proves who the caller is; it does not grant owner authority. Before this change, every
active actor session inherited the same owner-scoped project view and could reach confirmation,
autonomy-profile, run and emergency-stop endpoints. That would let an agent cross the separation
between execution and owner approval.

The common hook now enforces both gates in order:

1. missing, malformed, expired or revoked session -> 401 `UNAUTHORIZED`;
2. verified non-owner actor -> 403 `FORBIDDEN`;
3. verified owner actor -> request-scoped `IdentityContext` is made available to routes.

The denial log contains request ID, actor ID and actor kind, but not the bearer token, step-up token,
prompt or response content.

## Agent Studio boundary

This does not remove `agent` and `system` actors from Identity Core. It prevents their bearer
sessions from using the owner-facing control plane. Agent execution will be added behind a separate
internal contract that requires explicit project membership, capability grants, Tool Runtime policy
checks and auditable delegation. An agent must never approve its own confirmation, raise autonomy,
or inherit all projects merely because it belongs to the same owner.

## Verification

The API identity tests cover:

- health without authentication remains 200;
- missing or malformed bearer credentials remain 401;
- valid agent and system sessions receive 403;
- the denial body does not disclose their raw session token;
- a valid owner session continues to access the owner API;
- revoked owner sessions remain rejected immediately.

Production identity/MFA provider selection and external step-up proof issuance remain separate
owner decisions. This increment does not add login, enrollment or proof-issuance endpoints.
