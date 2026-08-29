# Agent Studio owner root proposal API review

**Date:** 2026-08-29  
**Scope:** owner-only, project-bound creation of an inert root agent proposal  
**Runtime status:** not activated

## Implemented

- Strict request contract containing only an exact blueprint reference.
- Required durable `Idempotency-Key` and replay of the original proposal.
- Owner/project check before blueprint resolution or instance persistence.
- Root proposal persistence through the existing proposed-only Agent Instance Store.
- Typed invalid, missing and idempotency-conflict responses.

## Verified invariants

- A successful response has `status = proposed`, `parent_instance_id = null` and no close time.
- An exact retry returns the same `instance_id` and does not add another proposal.
- The referenced blueprint must be visible in the same project and its grant must be unexpired.
- The database still rejects active state and non-null close time even for direct SQL writes.
- Agent identities remain rejected by the owner API boundary.
- Delegated proposal and activation routes remain absent.

## Deliberately absent

- delegated proposals and Policy Engine delegation over HTTP;
- activation, pause, completion, replacement, closure or failure transitions;
- permission issuance and tool access;
- executable prompt/model-message composition;
- provider/model routing, paid calls and external actions;
- UI and production deployment.

This endpoint stores a candidate assembled from an inert blueprint. It cannot make the candidate run
or expand any authority declared in that blueprint.
