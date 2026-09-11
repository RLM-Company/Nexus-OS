# Confirmation permission operation binding

**Date:** 2026-09-11  
**Scope:** confirmation-derived Permission Contract → Tool Runtime → atomic reservation  
**Status:** implementation complete; full repository CI required before merge

## Finding

A confirmation card is bound to an exact `operation_id`, but active Permission Contract lookup used
only project, actor, capability, purpose, objects and time. A different operation with otherwise
identical fields could therefore consume the approved one-use permission before the confirmed
operation did.

## Resolution

- Policy-facing permission lookup now receives the current operation ID.
- A permission derived from a confirmation is returned only when the joined confirmation names that
  exact operation.
- Atomic reservation independently performs the same operation-bound lookup.
- A future general permission with no `confirmation_id` remains eligible by its normal scope; this
  change narrows only confirmation-derived one-use authority.
- Administrative calls that omit an operation ID can still list active permissions for owner
  visibility.

## Regression evidence

- Policy Store exposes the approved permission for its original operation and not for another ID.
- Tool Runtime sends an otherwise identical second operation back to `WAITING_CONFIRMATION` without
  invoking the tool.
- The original confirmed operation still executes once and idempotent replay remains unchanged.

## Preserved boundaries

- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance execution, production, public or external effect.
- No automatic retry or recovery decision.
