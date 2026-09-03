# Control Center emergency-stop clearance review

**Date:** 2026-09-03  
**Scope:** owner-facing guarded recovery and append-only clearance history  
**Boundary:** no production route, provider call, autonomous effect or environment-stop override

## Outcome

The Control Center now exposes the audited recovery contract for a selected-project or process
emergency stop. An active stop reveals a separate guarded form rather than a generic resume action.
The form requires a recovery reason, explicit acknowledgement and one-time step-up proof, and sends
the exact displayed `activated_at` as the compare-and-swap boundary.

Project and process stops are selected independently. A process stop no longer masks the selected
project's own stop state, so the owner can inspect the exact scope being managed without weakening
either server-side stop.

## Safety properties

- The browser cannot choose or rewrite the activation timestamp; it comes from the active API state.
- The literal `CLEAR EMERGENCY STOP` acknowledgement is fixed by the client contract and revalidated
  by the API.
- The step-up token is held only in component state and is discarded after success or failure.
- Stop cards and clearance history reload from server-confirmed endpoints after a successful clear.
- If any post-clear refresh fails, the confirmed audit event is retained, conservative stop state is
  preserved where its endpoint is unknown, and further runtime stop actions stay disabled until the
  Control Center is reloaded.
- A `system:environment` process stop exposes offline-recovery guidance and no clearance controls.
- The backend remains authoritative if runtime configuration locks a process stop not identifiable
  from its displayed actor.
- Recent events expose recovery and activation reasons, exact scope, timestamps and actors from the
  owner-bound append-only audit endpoint.

## Browser coverage

- durable project-stop activation and reload;
- disabled clearance until reason, acknowledgement and step-up proof are all present;
- exact project, activation timestamp, literal acknowledgement and proof header on submission;
- server-confirmed clear state and rendered clearance event;
- process-scoped activation without a project ID and guarded recovery controls;
- environment-triggered process stop locked to offline recovery.

## Operational boundary

The Control Center accepts a proof but does not issue one. Production step-up provider selection,
operator enrollment and recovery runbooks remain owner/operations decisions. No production provider
or model route was selected or exercised in this increment.
