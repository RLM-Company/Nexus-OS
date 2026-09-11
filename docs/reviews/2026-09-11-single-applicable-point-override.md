# Single-applicable point-override invariant

**Date:** 2026-09-11  
**Scope:** Policy Engine → atomic Policy Store reservation  
**Status:** implementation complete; full repository CI required before merge

## Finding

Two differently identified point overrides could both match the same capability, purpose and
requested objects. When their modes agreed, Policy Engine selected the first array entry and atomic
reservation consumed only that entry. The result was deterministic by storage order but ambiguous
to the owner, especially when finite counters differed.

## Resolution

- Policy Engine applies an override only when exactly one stored override matches the current
  capability and intent.
- More than one match now produces `PAUSE` with a deny grant even when every matching mode agrees.
- The public applied-ID helper returns no selected identity for the ambiguous set.
- Atomic reservation independently derives the same exact-one invariant before any profile,
  permission or operation mutation.

Distinct overrides remain valid when their capability, exact purpose or object scope prevents them
from matching the same intent. No implicit priority, counter preference or owner intent is invented.

## Regression evidence

- same-mode overlapping overrides pause Policy Engine and expose no selected override ID;
- different-mode conflicts continue to pause;
- a forged first-entry selection is rejected as `AUTHORITY_CHANGED` by Policy Store;
- neither finite counter nor an operation row changes after rejection.

## Preserved boundaries

- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance, production, public or external effect.
- No automatic recovery or blind retry.
