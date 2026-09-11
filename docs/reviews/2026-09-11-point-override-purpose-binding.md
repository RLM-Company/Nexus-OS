# Point-override purpose binding

**Date:** 2026-09-11  
**Scope:** Policy Engine → PolicyStore atomic reservation boundary  
**Status:** implementation complete; full repository CI required before merge

## Finding

Every point override has a required owner-visible `purpose`, but override selection used only its
capability, object scope, expiry and remaining-use counter. An override approved for one purpose
could therefore change authority for another intent with the same capability and covered objects.

This differed from Permission Contract behaviour, where an exact purpose match was already part of
both policy evaluation and atomic reservation.

## Resolution

Policy Engine now requires `override.purpose === intent.purpose` before an override can affect the
verdict or appear in `getAppliedOverrideIds`. Policy Store independently applies the same condition
when it recalculates applicable override IDs at reservation time. Its complete in-transaction policy
re-evaluation then rejects a stale or forged elevated verdict even when the caller supplies no
override ID.

Purpose comparison is exact and case-sensitive. The runtime does not normalize, infer or broaden
an owner's stated purpose.

## Regression evidence

- Policy Engine ignores a capability/object-matching override for a different purpose and returns
  the A0 base denial;
- atomic reservation rejects an elevated verdict for the mismatched purpose;
- the finite use remains available and no operation is created;
- existing finite-use, expiry, conflict, permission and Tool Runtime recovery cases use exact
  purpose-bound fixtures and remain covered.

## Preserved boundaries

- This only narrows existing point-override authority.
- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance, production, public or external effect.
- No automatic recovery or blind retry.
