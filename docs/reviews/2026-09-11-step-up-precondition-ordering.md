# Step-up precondition ordering

**Date:** 2026-09-11  
**Scope:** owner-bound autonomy and confirmation API  
**Status:** implementation complete; full repository CI required before merge

## Finding

One-time step-up proof consumption preceded two business-state checks:

- a critical autonomy-profile apply could consume proof before rejecting a stale profile version;
- a repeated or expired critical confirmation could consume proof before discovering that approval
  was no longer possible.

These paths did not expand authority, but they destroyed a valid owner proof for a request that
could not commit.

## Resolution

- Critical profile apply checks the current version before step-up consumption. The store's
  compare-and-swap remains the final concurrent-write guard.
- Confirmation approval checks ownership, pending state, exact nonce and expiry before step-up
  consumption.
- An already expired confirmation is transitioned to `EXPIRED` and its operation to terminal denial
  without requiring or consuming proof.
- One timestamp is reused for the precondition and final confirmation decision.

## Regression evidence

- a stale A6 profile apply returns conflict and consumes no proof;
- replaying an already approved critical confirmation returns conflict without a second proof
  consumption;
- an expired critical confirmation becomes `EXPIRED`, returns the canonical expiry error and
  consumes no proof.

## Residual concurrency boundary

Profile mutation remains protected by database compare-and-swap after proof verification. A future
single transactional step-up/policy-store adapter can eliminate proof loss from a genuinely
concurrent writer between verification and CAS; this change closes the deterministic stale-request
paths without weakening the existing authority checks.

## Preserved boundaries

- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance execution, production, public or external effect.
