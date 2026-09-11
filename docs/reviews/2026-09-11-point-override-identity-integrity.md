# Point-override identity integrity

**Date:** 2026-09-11  
**Scope:** Contracts → profile API → PolicyStore → Policy Engine  
**Status:** implementation complete; full repository CI required before merge

## Finding

`override_id` is the stable identity used by Control Center previews, policy selection and atomic
finite-use consumption. The strict object schema validated each override but did not require IDs to
be unique inside one capability profile. Duplicate identities could therefore make the displayed
profile and consumption behaviour ambiguous.

## Resolution

- Contracts expose one canonical uniqueness predicate for profile overrides.
- Preview and apply reject duplicate IDs with the canonical `VALIDATION_ERROR` before step-up proof
  can be consumed.
- Policy Store independently refuses direct persistence of a duplicate-ID profile.
- Policy Engine pauses the entire evaluation if a legacy or corrupted stored profile contains
  duplicate override identities.
- Atomic reservation inherits that fail-closed verdict through its complete in-transaction policy
  re-evaluation.

Semantic overlap between different, uniquely identified overrides remains visible to the existing
conflict rules. This change does not invent precedence or silently merge owner inputs.

## Regression evidence

- the shared contracts predicate distinguishes unique and duplicate identity sets;
- both HTTP preview and apply reject a duplicate ID, and apply does not consume the supplied
  one-time step-up proof;
- direct database persistence leaves the existing profile and version unchanged;
- Policy Engine returns `PAUSE` with deny grants for a corrupted duplicate-ID profile.

## Preserved boundaries

- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance, production, public or external effect.
- No automatic recovery or blind retry.
