# Emergency-stop clearance API review

**Date:** 2026-09-03  
**Scope:** owner-verified recovery from a durable project or process emergency stop  
**Boundary:** provider-neutral backend increment; no production route or external effect

## Outcome

The API now has one guarded recovery path:
`POST /api/v1/operations/emergency-stop/clearance`. It cannot silently turn an active stop into a
clear state. The request must bind to the exact active `activated_at`, carry the literal
`CLEAR EMERGENCY STOP`, provide a non-blank recovery reason and consume a one-time step-up proof
for purpose `emergency_stop_clearance`.

## Safety properties

- The active stop is checked before step-up consumption, so stale requests do not burn a proof.
- The proof challenge binds scope, project ID and activation timestamp.
- The database update compares the same activation timestamp under `BEGIN IMMEDIATE`.
- Clearing the stop and inserting its audit event commit atomically.
- Clearance events preserve both activation and recovery facts and are listed only for the current
  owner.
- Database triggers reject `UPDATE` and `DELETE` against the clearance audit.
- A project belonging to another owner remains indistinguishable from a missing project.
- A process stop attributed to `system:environment`, or enforced by the current environment
  switch, remains locked to offline operator recovery.

## Verification coverage

- exact-activation conflict before step-up consumption;
- missing step-up rejection;
- successful project clearance and bound challenge;
- replay rejection without a second proof consumption;
- owner-bound clearance-event listing;
- cross-owner project nondisclosure;
- environment-triggered process-stop refusal;
- durable restart test updated to use the audited store contract;
- direct SQLite verification that audit updates and deletes fail.

## Deferred surface

The Control Center still exposes activation only. The next independent increment can add a guarded
clearance form and recent-event view on top of this contract; it must not weaken step-up,
compare-and-swap or environment-lock behavior.
