# Confirmation decision time integrity

**Date:** 2026-09-11  
**Scope:** Policy Store confirmation state machine  
**Status:** implementation complete; full repository CI required before merge

## Finding

`PolicyStore.decideConfirmation` accepted an optional internal `decidedAt` value without requiring
it to be parseable or at least as recent as `requested_at`. The current HTTP route supplies server
time, but another internal caller could backdate approval and create a permission whose validity
and audit chronology began before the owner confirmation request.

## Resolution

- Decision, request and expiry timestamps must all parse successfully.
- A decision earlier than the confirmation request throws a store conflict inside the existing
  transaction.
- Expiry comparison reuses the validated numeric timestamps.
- Rejection happens before permission, confirmation, operation or Decision Trace mutation.

## Regression evidence

Both a malformed timestamp and a time immediately before the request are rejected. The
confirmation remains `PENDING`, the operation remains `WAITING_CONFIRMATION`, no permission exists
and Decision Trace contains only the original confirmation-required verdict.

## Preserved boundaries

- No client-controlled decision timestamp is added.
- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance execution, production, public or external effect.
