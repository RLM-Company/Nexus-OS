# Agent Pattern Library review

Date: 2026-08-28  
Scope: immutable function and behaviour-pattern persistence

## Implemented

- Added append-only database records for versioned agent functions and behaviour patterns.
- Owner and project scopes are bound at both the database and store layers; product records remain
  readable but cannot be created through the owner store.
- Project-scoped writes require a project belonging to the same owner.
- New versions preserve old rows. Pattern archival appends a terminal version and never deletes
  instructions needed to reproduce completed work.
- A pattern may reference only functions visible in its own product/owner/project scope.
- Runtime input rejects unknown fields, including authority-shaped capability/tool fields.

## Verified invariants

- Another owner cannot read or mutate owner/project definitions.
- An owner pattern cannot reference a project-only function; a project pattern may reuse visible
  owner and product functions.
- Scope/owner/project inconsistencies fail at the SQLite CHECK boundary.
- Product definitions cannot be created or versioned through the owner-facing store.
- Stored JSON is validated on read and fails closed if corrupted.

## Not activated

No HTTP endpoint, Agent Registry, blueprint persistence, instruction composer, model selection,
permission grant, tool access, Manager prompt or agent runtime is introduced by this increment.
