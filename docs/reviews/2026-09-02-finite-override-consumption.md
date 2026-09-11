# Atomic finite-use point-override consumption

**Date:** 2026-09-02  
**Status:** `IMPLEMENTED / ATOMIC / FAIL-CLOSED / NO REPLAY DOUBLE-CONSUME`  
**Boundary:** Policy Engine → Policy Store → Tool Runtime

## Outcome

Tool Runtime now binds every allowed reservation to the exact capability-profile version used by
Policy Engine and the exact active point overrides selected for the intent. When a selected
override has `remaining_uses`, the same `BEGIN IMMEDIATE` transaction that reserves the operation
decrements it. A last use removes the override because the strict profile schema does not represent
zero remaining uses.

An idempotent operation is resolved before authority consumption. A stored success returns its
result, and a stored reservation returns `RECOVERY_REQUIRED`; neither path consumes another use.

## Atomic boundary

Before any state mutation, Policy Store:

1. resolves an existing idempotent operation;
2. verifies that the verdict is `ALLOW` or `ALLOW_WITH_LIMITS`;
3. requires the stored profile version to equal the evaluated authority snapshot;
4. independently recomputes the applicable override IDs from capability, exact purpose, objects,
   expiry and remaining-use state;
5. verifies the supplied IDs are unique and exact and that each selected override produced the
   verdict's final capability mode;
6. validates every one-use permission referenced by the verdict.

Only after all checks pass does one transaction update the versioned profile, consume permissions
and reserve the operation. A missing permission cannot partially decrement an override. A stale
profile or concurrent earlier consumption returns `AUTHORITY_CHANGED` and Tool Runtime pauses
without calling the external executor.

## Consumption semantics

- an infinite override (`remaining_uses: null`) is authority-bound but does not change profile
  version at reservation;
- a finite value greater than one is decremented and produces the next profile version;
- a value of one removes the override and produces the next profile version;
- a tool failure after reservation still consumes the use, because an external effect may already
  have occurred and blind retry is forbidden;
- denied, paused and waiting-confirmation outcomes do not reserve and therefore do not consume a
  finite use;
- exact replay and `RECOVERY_REQUIRED` do not consume twice.

## Evidence

Policy Engine coverage verifies the selected override IDs and excludes expired, out-of-scope and
conflicting candidates. Database coverage verifies permission-failure rollback, one decrement,
profile version progression, replay stability, stale-authority rejection and last-use removal. Tool
Runtime coverage executes one finite override, replays the stored result without another
decrement, then proves a new operation falls back to the base denial after exhaustion.

No migration, provider probe, model call or external tool integration is added. The state remains
inside the existing versioned profile JSON and policy-operation transaction.

## UI boundary

The separate Control Center slice reviewed in
`2026-09-03-control-center-finite-overrides.md` now exposes explicit finite-counter creation and
editing. It validates a positive safe integer, includes the exact before/after value in server
preview and keeps blank as `null`; this runtime review remains the enforcement evidence.
