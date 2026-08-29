# Agent Studio owner read API review

**Date:** 2026-08-29  
**Scope:** owner-only, project-bound read access to persisted Agent Studio records  
**Runtime status:** not activated

## Implemented

- Shared response contracts for function, behavior-pattern, blueprint and agent-proposal lists.
- Four authenticated `GET` endpoints below the project Agent Studio namespace.
- Project ownership verification before every store read.
- Archived behavior patterns excluded by default and available only through an explicit flag.
- Server composition of the existing Pattern Library, Blueprint Registry and Agent Instance stores.

## Verified invariants

- An owner can read only records visible inside their own project.
- Cross-owner and unknown-project reads return the same typed `PROJECT_NOT_FOUND` response.
- Agent identities are rejected by the existing owner-only API boundary.
- Proposal responses contain only the persistence layer's `proposed` instances.
- Malformed query values return a typed validation error.
- No write route exists under this increment.

## Deliberately absent

- function, pattern or blueprint creation and versioning;
- proposal creation through HTTP;
- preview or executable instruction composition;
- agent activation and lifecycle transitions;
- provider/model routing and paid calls;
- tools, external actions and production deployment.

The API is therefore a control-plane inspection surface only. It makes already-approved,
non-runtime Agent Studio records visible to their owner without expanding agent authority.
