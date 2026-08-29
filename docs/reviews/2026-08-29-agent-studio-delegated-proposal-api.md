# Agent Studio delegated proposal API review

**Date:** 2026-08-29  
**Scope:** owner-only, Policy Engine-gated child proposal creation  
**Runtime status:** not activated

## Implemented

- Strict request contract with only parent instance ID and exact child blueprint reference.
- Explicit `validateAgentDelegation` wiring in the production server composition root.
- Required durable `Idempotency-Key` with exact replay of the original child proposal.
- Atomic child persistence, idempotency ledger and content-free Decision Trace event.
- Generic `POLICY_DENIED` response that does not expose internals across the owner boundary.

## Verified invariants

- Parent and child belong to the same owner and project and both grants remain unexpired.
- Child capabilities, tools, data scopes and object IDs are subsets of the parent grant.
- Child money, token and operation budgets never exceed the parent budget and currency is unchanged.
- Child expiry is no later than the parent expiry and delegation depth is strictly lower.
- Missing validator and any denied decision fail closed without persisting a child.
- Successful and replayed responses remain `status = proposed`; replay adds no duplicate event.
- Activation routes remain absent and the database still rejects active instance state directly.

## Deliberately absent

- activation and all executable lifecycle transitions;
- permission issuance from blueprint declarations;
- executable prompt/model-message composition;
- provider/model/tool/network calls, paid calls and external actions;
- autonomous Manager-created HTTP requests and production deployment.

This route stores a reviewed team-structure candidate. It cannot make the parent or child run.
