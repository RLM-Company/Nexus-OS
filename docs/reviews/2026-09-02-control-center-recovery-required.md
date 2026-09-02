# Control Center recovery-required visibility

**Date:** 2026-09-02  
**Status:** `IMPLEMENTED / OWNER-ONLY / READ-ONLY / NO BLIND REPLAY`  
**Roadmap:** Step 5 — explicit `RECOVERY_REQUIRED` handling

## Outcome

The Autonomy Control Center now lists policy tool operations whose durable state is still
`RESERVED`. Such a record means the local runtime has no durable completion outcome; it does not
prove whether the external side effect happened. The UI therefore labels the operation
`RECOVERY_REQUIRED` and tells the owner to reconcile it with the external system.

This increment adds visibility only. It does not retry, replay, resume, mark successful, mark
failed or otherwise resolve an operation.

## Runtime boundary

- the list is derived only from persisted `policy_operations` rows with status `RESERVED`;
- the existing idempotency guard still returns `RECOVERY_REQUIRED` for a duplicate reservation and
  does not call the tool executor again;
- no inference is made about the external outcome;
- no provider probe, model call, external API call or hidden retry is added;
- a future resolution workflow requires a separate audited design with explicit owner intent and
  evidence of the external outcome.

## Owner and disclosure boundary

The endpoint is bound to the authenticated owner and selected project. Another owner's project
returns project-not-found. Its strict response includes only operation, project and actor IDs,
capability and object references, policy reasons/version and the reservation timestamp.

Purpose, idempotency key, request and result payloads, prompts, secrets, raw evaluated scopes,
permission IDs and provider details are excluded. The UI selects only the strict public fields even
if an unexpected upstream response contains additional properties.

## Evidence

Contract coverage rejects additional replay material. Database coverage verifies that a reserved
operation appears as a content-minimized record, invalid limits fail, and a completed operation
leaves the queue. API coverage verifies owner binding, limit validation and nondisclosure. The
browser scenario injects purpose, idempotency, result and provider fields and proves they are not
rendered; it also proves that the recovery region exposes no retry, replay, resume or completion
button. Existing Tool Runtime coverage verifies that a duplicate reserved operation returns
`RECOVERY_REQUIRED` while the executor is called only once.

## Step 5 status

Point-override editing is implemented and reviewed separately in
`2026-09-02-control-center-point-overrides.md`. All Step 5 owner-facing slices are now present.
