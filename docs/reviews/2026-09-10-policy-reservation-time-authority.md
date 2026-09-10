# Policy reservation-time authority hardening

**Date:** 2026-09-10  
**Scope:** Policy Engine and PolicyStore atomic reservation boundary  
**Status:** implementation complete; full repository CI required before merge

## Finding

Policy evaluation correctly ignored expired overrides and permission contracts at its evaluation
timestamp. Atomic reservation did not repeat the same time-window checks consistently:

- point overrides were re-derived from the older `verdict.evaluated_at` value;
- permission contracts were checked only for active state and remaining operations;
- a reservation timestamp could precede the verdict or the active profile timestamp;
- `GuardedToolRuntime` accepted an invocation-supplied evaluation timestamp, so an untrusted caller
  could ask the policy layer to evaluate an old authority window;
- a permission ID was not defensively rebound to the approved project, actor, purpose, object scope
  and requested capability at reservation.

An override or permission could therefore expire after evaluation but before reservation and still
be consumed. A caller capable of presenting an inconsistent internal verdict could also attempt to
reuse a one-operation permission for a different purpose. Both cases violate the fail-closed
time-of-check/time-of-use boundary.

## Resolution

`PolicyStore.reserveAllowed` now performs all authority checks inside its existing
`BEGIN IMMEDIATE` transaction:

1. Tool Runtime obtains evaluation time only from its server-owned clock; deterministic tests inject
   that clock at runtime construction rather than through an invocation field;
2. the verdict operation ID must match the intent;
3. the reservation, verdict and profile timestamps must parse, and reservation time cannot precede
   either source of authority;
4. point overrides are re-derived at reservation time, so expiry between evaluation and
   reservation returns `AUTHORITY_CHANGED` without consuming an override;
5. permission contracts must still be inside their validity window and retain an available
   operation;
6. each permission is rebound to the same project, actor, purpose, object scope and at least one
   requested capability before it can be consumed;
7. the final atomic permission update repeats the project, actor, validity and usage predicates.

The Policy Engine now also excludes a permission whose approved purpose differs from the current
intent, preventing it from producing an elevated verdict for that mismatch.

## Regression evidence

Tests cover:

- override expiry between evaluation and reservation;
- backwards reservation chronology;
- permission expiry between evaluation and reservation;
- attempted permission reuse for another purpose;
- ignored invocation-supplied timestamps and trusted clock injection;
- unchanged profile counters and absent operation rows after rejected reservations;
- the existing one-use, idempotent replay and recovery-required behavior.

Targeted test, lint and strict TypeScript gates pass for `@cosmora/policy-engine`, `@cosmora/db` and
`@cosmora/tool-runtime`. The branch must still pass the repository's complete `pnpm check`,
including browser acceptance, before merge.

## Preserved boundaries

- No provider, model route, secret, paid probe or external effect is introduced.
- No recovery action, blind retry or inferred external outcome is introduced.
- No Manager Console/runtime-flow code or Manager system prompt is changed.
- A6 remains inactive; this change only narrows authority at the reservation boundary.
