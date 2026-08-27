# B0.3 review: provider-neutral Identity Core

**Date:** 2026-08-27  
**Status:** implementation candidate

## Delivered

- shared owner, actor, session, assurance, and audit contracts;
- durable owner-bound actors and sessions in SQLite;
- opaque 256-bit session tokens whose raw value is returned once and never persisted;
- SHA-256 token lookup, explicit expiry, single-session revocation, owner-wide revocation, and actor
  disablement;
- audit-safe lifecycle events without prompts, project content, credentials, or raw tokens;
- fail-closed resolution for unknown, expired, revoked, or disabled identities;
- deterministic clock injection and owner-isolation tests.

## Boundary

This increment is intentionally independent of any production identity vendor. It does not choose
passkeys, OAuth/OIDC, email delivery, 2FA transport, cookie policy, or deployment environment. It
establishes the server-side persistence and contracts that those adapters must use.

Existing HTTP routes are not authenticated by this increment. The next increment must introduce a
request identity resolver, propagate its owner and actor IDs into every store call and audit field,
and reject production startup when no verified resolver is configured.
