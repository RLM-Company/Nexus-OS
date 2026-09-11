# Confirmation post-step-up expiry recheck

**Date:** 2026-09-11  
**Scope:** critical confirmation approval API  
**Status:** implementation complete; full repository CI required before merge

## Finding

The approval endpoint captured `decidedAt` before awaiting step-up proof verification. If verification
finished after the confirmation expired, the final transactional decision still received the older
pre-verification time and could approve authority that was no longer current.

## Resolution

- The endpoint keeps the initial expiry check before proof consumption so an already-expired
  request cannot burn a one-time proof.
- After successful asynchronous verification, it reads the clock again immediately before the
  synchronous transactional decision.
- `PolicyStore.decideConfirmation` remains authoritative and converts a newly expired confirmation
  into terminal `EXPIRED`/denied state instead of creating a Permission Contract.
- The API clock is injectable for deterministic boundary tests; production defaults remain the
  current canonical UTC time.

## Regression evidence

An API test begins approval before expiry, advances the injected clock past expiry inside the
step-up consumer and verifies:

- the endpoint returns `409 CONFIRMATION_EXPIRED`;
- the persisted confirmation is `EXPIRED`;
- no permission is created by the transactional decision;
- the synthetic proof consumer is called exactly once.

## Residual boundary

A proof can still be consumed when expiry happens during verification. Eliminating that liveness
cost requires one transaction-capable proof/confirmation adapter. This change closes the authority
bypass without weakening one-use proof semantics or introducing a provider decision.

## Preserved constraints

- No production step-up/MFA provider, credential or paid probe.
- No Manager Console/runtime-flow or final Manager prompt change.
- No A6 activation, finance execution, production, public or external effect.
