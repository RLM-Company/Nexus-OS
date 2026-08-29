# Agent Studio owner catalog write API review

**Date:** 2026-08-29  
**Scope:** owner-only, project-bound catalog creation and immutable versioning  
**Runtime status:** not activated

## Implemented

- Request contracts for project functions, behavior patterns and inert blueprints.
- Owner-only creation routes for those three catalog object types.
- Immutable version routes with transactional optimistic concurrency.
- Idempotent pattern archival through a terminal appended version.
- Generic typed errors for invalid, missing and stale Agent Studio objects.

## Verified invariants

- Project identity comes only from the authenticated path, not the request body.
- Cross-owner project writes return the same `PROJECT_NOT_FOUND` response as unknown projects.
- Cross-project object IDs cannot be versioned or archived through another owned project path.
- Agent identities remain rejected by the owner API boundary.
- Stale expected versions return `409 CONFLICT` without appending a record.
- Pattern request bodies cannot carry tools, capabilities, budgets or other authority fields.
- Blueprint request bodies cannot carry project identity, instance status or activation fields.
- Blueprint grants and model-profile references remain inert declarations.

## Deliberately absent

- durable idempotency for fresh object creation (implemented in the following isolated increment);
- root or delegated proposal writes;
- instance activation and lifecycle transitions;
- Decision Trace integration beyond immutable authorship and timestamps;
- executable prompt composition;
- provider/model routing, paid calls, tools and external actions;
- UI and production deployment.

At the time of this review, an automated client could not safely retry a timed-out creation
request. The following isolated idempotency increment closes that limitation. This control-plane
API alone cannot start or execute an agent.
