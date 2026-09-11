# Atomic policy re-evaluation before reservation

**Date:** 2026-09-11  
**Scope:** Policy Engine → PolicyStore atomic reservation boundary  
**Status:** implementation complete; full repository CI required before merge

## Finding

Atomic reservation rechecked profile version, point-override identity, permission validity and
intent bindings. It did not independently recalculate the complete verdict from the current
profile, active permissions and trusted condition snapshot. A structurally valid internal
`ALLOW` could therefore name the right operation and capability while assigning a mode that the
active A0 profile did not grant.

One recovery API fixture exposed the gap directly: it created an A0 profile and manually reserved
`external.communicate` as `AUTONOMOUS`. The old store accepted that impossible policy result.

## Resolution

`PolicyStore.reserveAllowed` now loads every currently active permission and invokes the shared
deterministic Policy Engine inside the existing `BEGIN IMMEDIATE` transaction. Reservation proceeds
only when the recalculated verdict has the same:

- verdict kind;
- complete evaluated capability grants, including scope and conditions;
- permission IDs;
- policy contract version.

Evaluation time is intentionally recalculated at reservation time. Expires-between-check-and-use
authority therefore changes the result and fails closed. Explanatory reasons are not authority and
remain outside the equality check.

The runtime now passes its server-resolved condition IDs into the reservation snapshot. Duplicate
condition IDs are rejected. Direct callers that omit the optional snapshot receive the safe empty
condition set, while condition-based runtime execution remains covered by the trusted-resolver
tests.

## Regression evidence

- a self-consistent forged A0 `external.communicate: AUTONOMOUS` verdict returns
  `AUTHORITY_CHANGED` and creates no operation;
- one-use owner permissions still reserve and consume exactly once;
- finite overrides and expiry/TOCTOU tests remain green;
- trusted conditional expansion still executes, while caller-supplied conditions remain ignored;
- recovery API fixtures now use the genuinely A0-autonomous `agent.manage` capability.

Targeted DB, API and Tool Runtime tests pass, together with lint and strict TypeScript checks. The
branch must still pass the complete GitHub `pnpm check`, including Playwright Chromium, before
merge.

## Preserved boundaries

- No Manager Console/runtime-flow or final Manager prompt change.
- No provider selection, secret, paid probe or model call.
- No A6 activation, finance, production, public or external effect.
- No automatic recovery or blind retry.
