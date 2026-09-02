# Control Center project hard limits

**Date:** 2026-09-02  
**Status:** `IMPLEMENTED / OWNER-ONLY / FAIL-CLOSED`  
**Roadmap:** Step 5 — costs and limits, enforcement slice

## Outcome

The project Usage Ledger now has an owner-configured, versioned cumulative ceiling for total tokens
and/or cost in one explicit currency. The Control Center loads the stored values, accepts blank
fields only as an explicit disabled ceiling, obtains a server preview and applies the exact preview
with optimistic version checking.

No default amount is invented. Creating a project records version 1 with both ceilings disabled.
Setting or lowering a finite ceiling does not require step-up; increasing, removing or changing the
currency of an existing ceiling does.

## Enforcement boundary

- the check and reservation insert share one `BEGIN IMMEDIATE` transaction, so concurrent attempts
  cannot both pass the same remaining allowance;
- committed usage and active reservations are accumulated before every new route reservation;
- a token ceiling requires complete non-negative token evidence;
- a cost ceiling requires complete non-negative price evidence in the configured currency;
- missing evidence, mixed currency or an exceeded ceiling fails the run before provider output and
  creates no reservation;
- an exact replay of an already persisted attempt remains idempotent;
- limit failures are non-retryable and reported with a specific project limit code;
- no provider probe, model call, automatic top-up, currency conversion or hidden retry is added.

## Owner and disclosure boundary

Reads, previews and writes are bound to the authenticated owner and selected project. Cross-owner
requests return project-not-found. The limit contract contains only the project ID, version, token
ceiling, cost ceiling, currency and timestamps. It does not expose provider, model, Registry route,
run, prompt, message or raw ledger rows.

## Evidence

Contract coverage rejects zero and malformed ceilings. Database coverage verifies initialization,
owner isolation, optimistic conflicts, replay idempotency, atomic token/cost denial and fail-closed
unknown price evidence. API coverage verifies preview/apply, step-up on expansion, stale versions,
cross-owner nondisclosure and a run that fails before any message delta. The browser scenario proves
that empty values are not replaced with invented defaults, a restrictive ceiling can be previewed
and applied, and expansion exposes the step-up boundary.

## Step 5 status

Explicit `RECOVERY_REQUIRED` visibility is now implemented and reviewed separately in
`2026-09-02-control-center-recovery-required.md`. Point-override editing is implemented and
reviewed in `2026-09-02-control-center-point-overrides.md`; all Step 5 owner-facing slices are now
present.
