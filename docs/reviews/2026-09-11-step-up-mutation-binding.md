# Step-up mutation binding

**Date:** 2026-09-11  
**Scope:** critical autonomy-profile and project hard-limit mutation API  
**Status:** implementation complete; full repository CI required before merge

## Finding

Step-up challenges for autonomy-profile escalation and project hard-limit expansion named the
project and expected version, but not the proposed mutation. A proof issued for one critical change
could therefore satisfy another critical payload while the same version remained current.

## Resolution

- Each challenge now includes a SHA-256 base64url digest of an explicitly ordered canonical
  mutation payload.
- Autonomy binding covers the proposed base level and every persisted override field in array order.
- Usage-limit binding covers the proposed token ceiling and exact cost amount/currency or `null`.
- Project, mutation kind and expected version remain human-inspectable challenge prefixes.
- The digest keeps every challenge comfortably below the StepUpProofStore 512-character limit even
  when override purpose text is long.

## Regression evidence

- A6 and a bounded FULL override at the same profile version produce different challenges.
- A finite hard limit and removal of all limits at the same version produce different challenges.
- API proof-consumption assertions use the canonical challenge constructors.

## Preserved boundaries

- No step-up provider or credential is selected or requested.
- No Manager Console/runtime-flow or final Manager prompt change.
- No A6 activation, finance execution, production, public or external effect.
