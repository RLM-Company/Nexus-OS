# Founder Control: safe technical-actor moderation (phase 1)

The platform's existing `EmergencyStopStore` already supports process-wide and owner-scoped project runtime stops. This change **does not** implement a secret founder backdoor or financial account custody.

## New API

Authenticated owner-only endpoints:

- `POST /api/v1/identity/actors/:actorId/suspend`
- `POST /api/v1/identity/actors/:actorId/restore`

Body: `{"reason":"Confirmed security investigation"}` (8–256 characters).
A verified **multi-factor** session is required. There is no self-service API for escalating a session's assurance. Only same-owner non-owner technical actors (`agent` / `system`) are targets. The `owner` actor kind is explicitly protected **both at the HTTP layer and in the database disable method**.

Suspension changes actor status and revokes its sessions transactionally. Restoration re-enables the actor but **never resurrects old sessions**. Repeated requests are idempotent. Existing identity audit records log `actor.disabled` and `actor.enabled`; API logs contain the target actor and action. The audit schema does **not yet** persist the subject ID in a dedicated immutable moderation record; that is follow-up work.

## Current limitations

- This is technical-actor moderation, **not** end-user account bans. A separate end-user identity, appeal, notification and moderation lifecycle is required before offering user bans.
- Already-running jobs require their own cancellation / isolation controls. Revoking a session prevents future authenticated requests, not previously started computation.
- No hidden owner removal, financial transfer restrictions, payment holding, bank account access, bulk notifications, or founder role bypasses are introduced.
- Financial transparency requires provider/bank reconciliation and agreed information rights, not self-reported ledger values.

## Verification

A Fastify test adds cases for MFA enforcement, protected owners, cross-owner isolation, session invalidation, restoration, and audit events. Run `pnpm --filter @cosmora/api test` and `pnpm check` in CI before merge. The module is not considered production-certified without passing checks and security review.
