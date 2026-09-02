# Control Center project usage visibility

**Date:** 2026-09-02  
**Status:** `IMPLEMENTED / OWNER-ONLY / READ-ONLY`  
**Roadmap:** Step 5 — costs and limits, visibility slice

## Outcome

The Autonomy Control Center now reads a strict project summary from the existing atomic Model Usage
Ledger. The owner can see committed input/output tokens, the active reserved token upper bound,
attempt outcomes, committed cost and reserved estimated cost in each recorded currency.

This is an honest visibility slice. It does not claim that a project hard limit exists yet and it
does not add a budget mutation or a new execution path.

## Boundary

- every read is bound to the authenticated owner and selected project;
- another owner's project returns the same project-not-found response;
- the response contains aggregates only and excludes run IDs, provider IDs, model IDs, Registry
  versions, prompts, messages, request bodies, secrets and raw ledger entries;
- currencies are never converted or combined;
- missing token or price evidence is counted explicitly instead of being inferred;
- failed and cancelled attempts do not become committed spend;
- active reservations are shown separately from committed usage;
- no provider probe, model call, automatic top-up, retry, activation or external effect was added.

## Evidence

Coverage verifies strict contracts, exact database aggregation, owner isolation, hidden route
details, mixed attempt states and the rendered Control Center boundary. The browser scenario injects
extra private provider/model/prompt fields and proves that the UI does not render them.

## Remaining Step 5 work

The next cost increment must add an owner-configured, version-checked hard limit and fail-closed
reservation enforcement without inventing default amounts. Point-override editing and explicit
`RECOVERY_REQUIRED` handling also remain open.
