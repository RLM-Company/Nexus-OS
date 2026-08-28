# Agent Instance Proposal Registry review

Date: 2026-08-28  
Scope: persistence-only proposed agent instances

## Implemented

- Added owner/project-bound instance records referencing an exact immutable blueprint version.
- Root proposals require a visible blueprint whose grant remains valid at proposal time.
- Delegated proposals reference a parent instance in the same owner/project boundary.
- Delegated proposals fail closed unless an injected Policy Engine validator explicitly allows the
  exact parent and child blueprints without denial reasons.
- The database constrains every record in this increment to `proposed` with no close timestamp.

## Verified invariants

- Another owner cannot read an instance through the store.
- Unknown authority-shaped input such as `status: active` is rejected.
- A direct SQL attempt to insert `active` fails the database check constraint.
- Missing or denied delegation decisions leave no child record behind.
- Expired blueprint grants cannot produce new proposals.
- Blueprint and parent foreign keys preserve exact owner/project binding.

## Not activated

There is no lifecycle transition, activation, pause, close, replacement, handoff, instruction
composer, Manager prompt, provider route selection, permission issuance, model/tool call, API
endpoint or runtime execution in this increment.
